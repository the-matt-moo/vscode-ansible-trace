import * as vscode from 'vscode';
import type { ExtToWebview, WebviewToExt, TraceResult, PrecedenceResult, FlowGraph } from './types.js';

export class TracePanel {
  public static currentPanel: TracePanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposed = false;

  private _onMessage: ((msg: WebviewToExt) => void) | undefined;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtml();

    this._panel.onDidDispose(() => {
      this._disposed = true;
      TracePanel.currentPanel = undefined;
    });

    this._panel.webview.onDidReceiveMessage((msg: WebviewToExt) => {
      this._onMessage?.(msg);
    });
  }

  static createOrShow(extensionUri: vscode.Uri): TracePanel {
    if (TracePanel.currentPanel) {
      TracePanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
      return TracePanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'ansibleTrace',
      'Ansible Variable Trace',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      },
    );

    TracePanel.currentPanel = new TracePanel(panel, extensionUri);
    return TracePanel.currentPanel;
  }

  onMessage(handler: (msg: WebviewToExt) => void) {
    this._onMessage = handler;
  }

  sendTrace(data: TraceResult) {
    this._post({ type: 'setTrace', data });
  }

  sendPrecedence(data: PrecedenceResult) {
    this._post({ type: 'setPrecedence', data });
  }

  sendInventories(files: string[]) {
    this._post({ type: 'setInventories', data: files });
  }

  sendFlow(data: FlowGraph) {
    this._post({ type: 'setFlow', data });
  }

  sendVariableList(names: string[]) {
    this._post({ type: 'setVariableList', data: names });
  }

  private _post(msg: ExtToWebview) {
    if (!this._disposed) {
      this._panel.webview.postMessage(msg);
    }
  }

  private _getHtml(): string {
    const webviewUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'),
    );

    const nonce = getNonce();
    const cssUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.css'),
    );

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src 'unsafe-inline' ${this._panel.webview.cspSource};
             script-src 'nonce-${nonce}';
             font-src ${this._panel.webview.cspSource};">
  <title>Ansible Variable Trace</title>
  <link rel="stylesheet" href="${cssUri}">
  <style>
    html, body, #root {
      margin: 0; padding: 0;
      width: 100%; height: 100%;
      overflow: hidden;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${webviewUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
