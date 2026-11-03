import * as vscode from 'vscode';
import { scanWorkspace } from './scanner.js';
import { buildTraceGraph } from './graphBuilder.js';
import { resolveVariable, listAllVariables } from './resolver.js';
import { TracePanel } from './webviewPanel.js';
import { scanFlow } from './flow.js';
import type { ScanResult, WebviewToExt } from './types.js';

let scanResult: ScanResult | undefined;
let lastVariable: string | undefined; // most recent variable shown in the trace panel

export function activate(context: vscode.ExtensionContext) {
  // ── Commands ──

  context.subscriptions.push(
    vscode.commands.registerCommand('ansible-trace.traceVariable', () => traceFromCursor(context)),
    vscode.commands.registerCommand('ansible-trace.showProjectGraph', () => showGraph(context)),
    vscode.commands.registerCommand('ansible-trace.showPrecedence', () => showPrecedence(context)),
    vscode.commands.registerCommand('ansible-trace.refresh', () => refresh()),
    vscode.commands.registerCommand('ansible-trace.showFlow', () => showFlow(context)),
  );

  // ── Auto-scan on activation ──
  refresh();
}

export function deactivate() {
  scanResult = undefined;
}

// ── Ensure scan data is ready ──

async function ensureScan(): Promise<ScanResult | undefined> {
  if (scanResult) return scanResult;
  return refresh();
}

async function refresh(): Promise<ScanResult | undefined> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showWarningMessage('Ansible Trace: No workspace folder open.');
    return undefined;
  }

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning Ansible variables...' },
    async () => {
      scanResult = await scanWorkspace(root);
      const defCount = scanResult.definitions.length;
      const useCount = scanResult.usages.length;
      vscode.window.showInformationMessage(
        `Ansible Trace: Found ${defCount} definitions, ${useCount} usages.`,
      );
      return scanResult;
    },
  );
}

// ── Trace variable under cursor ──

async function traceFromCursor(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const scan = await ensureScan();
  if (!scan) return;

  // Extract variable name at cursor position
  const doc = editor.document;
  const pos = editor.selection.active;
  const varName = extractVariableAtPosition(doc, pos);

  if (!varName) {
    // Fall back to quick pick
    const allVars = listAllVariables(scan);
    const picked = await vscode.window.showQuickPick(allVars, {
      placeHolder: 'Select a variable to trace',
      matchOnDescription: true,
    });
    if (!picked) return;
    showTracePanel(context, scan, picked);
    return;
  }

  showTracePanel(context, scan, varName);
}

// ── Show graph panel ──

async function showGraph(context: vscode.ExtensionContext) {
  const scan = await ensureScan();
  if (!scan) return;

  const allVars = listAllVariables(scan);
  const picked = await vscode.window.showQuickPick(allVars, {
    placeHolder: 'Select a variable to trace (or type to search)',
    matchOnDescription: true,
  });
  if (!picked) return;

  showTracePanel(context, scan, picked);
}

// ── Show precedence simulator ──

async function showPrecedence(context: vscode.ExtensionContext) {
  const scan = await ensureScan();
  if (!scan) return;

  // Use the traced variable; ask only if nothing has been traced yet.
  const allVars = listAllVariables(scan);
  const picked = lastVariable ?? await vscode.window.showQuickPick(allVars, {
    placeHolder: 'Select a variable for precedence analysis',
  });
  if (!picked) return;

  const panel = TracePanel.createOrShow(context.extensionUri);
  setupPanelHandlers(panel, context, scan);

  // Inventory is chosen in the tab's dropdown, default all inventories.
  const result = resolveVariable(scan, picked, undefined);
  panel.sendPrecedence(result);
  panel.sendInventories(scan.inventoryFiles);
  panel.sendVariableList(allVars);
}

// ── Flow tab (playbooks -> roles -> task files) ──

function showFlow(context: vscode.ExtensionContext) {
  const panel = TracePanel.createOrShow(context.extensionUri);
  sendFlowTo(panel);
}

function sendFlowTo(panel: TracePanel) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  panel.sendFlow(scanFlow(root));
}

// ── Panel wiring ──

function showTracePanel(context: vscode.ExtensionContext, scan: ScanResult, varName: string) {
  lastVariable = varName;
  const panel = TracePanel.createOrShow(context.extensionUri);
  setupPanelHandlers(panel, context, scan);

  const trace = buildTraceGraph(scan, varName);
  panel.sendTrace(trace);
  panel.sendInventories(scan.inventoryFiles);
  panel.sendVariableList(listAllVariables(scan));
}

function setupPanelHandlers(panel: TracePanel, context: vscode.ExtensionContext, scan: ScanResult) {
  panel.onMessage(async (msg: WebviewToExt) => {
    switch (msg.type) {
      case 'jumpToSource': {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) return;
        try {
          const uri = vscode.Uri.file(`${root}/${msg.file}`);
          const doc = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
          const line = Math.max(0, msg.line - 1);
          const range = new vscode.Range(line, 0, line, 0);
          editor.selection = new vscode.Selection(range.start, range.start);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        } catch {
          vscode.window.showWarningMessage(`Ansible Trace: cannot open ${msg.file}`);
        }
        break;
      }
      case 'traceVariable': {
        const trace = buildTraceGraph(scan, msg.name);
        panel.sendTrace(trace);
        break;
      }
      case 'requestFlow': {
        sendFlowTo(panel);
        break;
      }
      case 'resolvePrecedence': {
        const inv = msg.inventory === '(all inventories)' ? undefined : msg.inventory;
        const result = resolveVariable(scan, msg.name, inv);
        panel.sendPrecedence(result);
        break;
      }
      case 'ready': {
        // Webview loaded — send theme
        const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
          || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast
          ? 'dark' : 'light';
        panel.sendVariableList(listAllVariables(scan));
        panel.sendInventories(scan.inventoryFiles);
        break;
      }
    }
  });
}

// ── Variable extraction from cursor ──

function extractVariableAtPosition(doc: vscode.TextDocument, pos: vscode.Position): string | undefined {
  const line = doc.lineAt(pos.line).text;

  // Try Jinja2 expression: {{ var.path }}
  const jinjaRe = /\{\{[\s~+-]*([a-zA-Z_]\w*(?:\.\w+)*)/g;
  let m: RegExpExecArray | null;
  while ((m = jinjaRe.exec(line))) {
    const start = m.index + m[0].length - m[1].length;
    const end = start + m[1].length;
    if (pos.character >= start && pos.character <= end) {
      return m[1];
    }
  }

  // Try YAML key: "  var_name: value"
  const keyRe = /^\s*([a-zA-Z_]\w*)\s*:/;
  const keyMatch = line.match(keyRe);
  if (keyMatch) {
    const start = line.indexOf(keyMatch[1]);
    const end = start + keyMatch[1].length;
    if (pos.character >= start && pos.character <= end) {
      return keyMatch[1];
    }
  }

  // Try word under cursor
  const wordRange = doc.getWordRangeAtPosition(pos, /[a-zA-Z_]\w*(?:\.\w+)*/);
  if (wordRange) {
    const word = doc.getText(wordRange);
    if (/^[a-zA-Z_]/.test(word)) return word;
  }

  return undefined;
}
