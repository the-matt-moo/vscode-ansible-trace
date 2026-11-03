import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { VarDefinition, VarUsage, ScanResult, SourceType } from './types.js';

// ── Jinja2 variable reference regex ──
// Captures: {{ var }}, {{ var.child }}, {{ var | filter }}, {{ var.child | filter }}
const JINJA_VAR_RE = /\{\{[\s~+-]*([a-zA-Z_]\w*(?:\.\w+)*)[\s|}.+-]/g;
// Also matches: "when: var is defined", "when: var | bool", loop references
const WHEN_VAR_RE = /\b([a-zA-Z_]\w*(?:\.\w+)*)\s*(?:is\s|==|!=|>|<|\||\bin\b)/g;

// ── File classification ──

interface FileClass {
  sourceType: SourceType;
  scope?: string;
}

function classifyFile(relPath: string): FileClass | null {
  const p = relPath.replace(/\\/g, '/');
  const parts = p.split('/');

  // roles/<name>/defaults/**
  if (p.match(/^roles\/(.+?)\/defaults\//)) {
    const roleName = extractRoleName(parts);
    return { sourceType: 'role_defaults', scope: roleName };
  }
  // roles/<name>/vars/**
  if (p.match(/^roles\/(.+?)\/vars\//)) {
    const roleName = extractRoleName(parts);
    return { sourceType: 'role_vars', scope: roleName };
  }
  // roles/<name>/tasks/**
  if (p.match(/^roles\/(.+?)\/tasks\//)) {
    const roleName = extractRoleName(parts);
    return { sourceType: 'task_usage', scope: roleName };
  }
  // roles/<name>/templates/**
  if (p.match(/^roles\/(.+?)\/templates\//)) {
    const roleName = extractRoleName(parts);
    return { sourceType: 'template_usage', scope: roleName };
  }
  // group_vars/**
  if (parts.includes('group_vars')) {
    const gvIdx = parts.indexOf('group_vars');
    const groupFile = parts[gvIdx + 1] ?? 'all';
    const scope = groupFile.replace(/\.\w+$/, '');
    return { sourceType: 'group_vars', scope };
  }
  // host_vars/**
  if (parts.includes('host_vars')) {
    const hvIdx = parts.indexOf('host_vars');
    const hostFile = parts[hvIdx + 1] ?? '';
    const scope = hostFile.replace(/\.\w+$/, '');
    return { sourceType: 'host_vars', scope };
  }
  // inventory/**
  if (parts[0] === 'inventory' && p.endsWith('.yml')) {
    return { sourceType: 'inventory_group' };
  }
  // playbooks/**
  if (parts[0] === 'playbooks' && p.endsWith('.yml')) {
    return { sourceType: 'play_vars' };
  }
  // Root-level .yml that isn't config — might be a playbook
  if (parts.length === 1 && p.endsWith('.yml') && !['galaxy.yml', 'requirements.yml', 'ansible.cfg'].includes(p)) {
    return { sourceType: 'play_vars' };
  }
  // .j2 files anywhere
  if (p.endsWith('.j2')) {
    return { sourceType: 'template_usage' };
  }
  return null;
}

function extractRoleName(parts: string[]): string {
  const rolesIdx = parts.indexOf('roles');
  if (rolesIdx < 0) return '';
  // Role name may be nested: roles/network/frontend → "network/frontend"
  const specialDirs = ['defaults', 'vars', 'tasks', 'handlers', 'templates', 'files', 'meta', 'tests'];
  const nameParts: string[] = [];
  for (let i = rolesIdx + 1; i < parts.length; i++) {
    if (specialDirs.includes(parts[i])) break;
    nameParts.push(parts[i]);
  }
  return nameParts.join('/');
}

// ── File discovery ──

function findYamlFiles(root: string): string[] {
  const results: string[] = [];
  const ignore = new Set(['.git', 'node_modules', '.tox', '__pycache__', 'collections', 'ansible_collections']);

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (ignore.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (/\.(ya?ml|j2)$/.test(e.name)) {
        results.push(full);
      }
    }
  }
  walk(root);
  return results;
}

// ── YAML helpers ──

/** Get the 1-based line number where a key appears in raw text. */
function findKeyLine(text: string, key: string, startFrom: number = 0): number {
  const lines = text.split('\n');
  const keyPattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*:`);
  for (let i = startFrom; i < lines.length; i++) {
    if (keyPattern.test(lines[i])) return i + 1;
  }
  return startFrom + 1;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 77) + '...' : v;
  if (typeof v === 'object') {
    const j = JSON.stringify(v);
    return j.length > 80 ? j.slice(0, 77) + '...' : j;
  }
  return String(v);
}

// ── Core scanner ──

export async function scanWorkspace(root: string): Promise<ScanResult> {
  const files = findYamlFiles(root);
  const definitions: VarDefinition[] = [];
  const usages: VarUsage[] = [];
  const inventoryFiles: string[] = [];

  for (const absPath of files) {
    const relPath = path.relative(root, absPath).replace(/\\/g, '/');
    const cls = classifyFile(relPath);
    if (!cls) continue;

    let text: string;
    try { text = fs.readFileSync(absPath, 'utf-8'); }
    catch { continue; }

    if (relPath.startsWith('inventory/')) {
      inventoryFiles.push(relPath);
    }

    if (absPath.endsWith('.j2')) {
      // Template: only usages
      extractJinjaUsages(text, relPath, cls, usages);
      continue;
    }

    let docs: unknown[];
    try { docs = yaml.loadAll(text) as unknown[]; }
    catch { continue; }

    for (const doc of docs) {
      if (!doc || typeof doc !== 'object') continue;

      switch (cls.sourceType) {
        case 'inventory_group':
          extractInventoryVars(doc as Record<string, unknown>, text, relPath, definitions);
          extractJinjaUsages(text, relPath, cls, usages);
          break;

        case 'role_defaults':
        case 'role_vars':
        case 'group_vars':
        case 'host_vars':
          extractFlatVars(doc as Record<string, unknown>, text, relPath, cls, definitions);
          extractJinjaUsages(text, relPath, cls, usages);
          break;

        case 'play_vars':
          extractPlaybookVars(doc, text, relPath, definitions, usages);
          break;

        case 'task_usage':
          extractTaskVars(doc, text, relPath, cls, definitions, usages);
          break;

        default:
          extractJinjaUsages(text, relPath, cls, usages);
      }
    }
  }

  return { definitions, usages, inventoryFiles };
}

// ── Extraction strategies ──

/** Inventory files: walk the group tree to find vars at each level. */
function extractInventoryVars(
  doc: Record<string, unknown>,
  text: string,
  file: string,
  defs: VarDefinition[],
) {
  function walkGroups(obj: Record<string, unknown>, groupName?: string) {
    // Direct vars: block
    const vars = obj['vars'] as Record<string, unknown> | undefined;
    if (vars && typeof vars === 'object') {
      for (const [k, v] of Object.entries(vars)) {
        const children = typeof v === 'object' && v !== null && !Array.isArray(v)
          ? flattenKeys(v as Record<string, unknown>, k)
          : undefined;
        defs.push({
          name: k,
          value: v,
          file,
          line: findKeyLine(text, k),
          sourceType: 'inventory_group',
          scope: groupName ?? 'all',
          children,
        });
      }
    }
    // Hosts with per-host vars
    const hosts = obj['hosts'] as Record<string, unknown> | undefined;
    if (hosts && typeof hosts === 'object') {
      for (const [hostName, hostDef] of Object.entries(hosts)) {
        if (hostDef && typeof hostDef === 'object') {
          for (const [k, v] of Object.entries(hostDef as Record<string, unknown>)) {
            defs.push({
              name: k,
              value: v,
              file,
              line: findKeyLine(text, k),
              sourceType: 'inventory_host',
              scope: hostName,
            });
          }
        }
      }
    }
    // Children groups
    const children = obj['children'] as Record<string, unknown> | undefined;
    if (children && typeof children === 'object') {
      for (const [childGroup, childDef] of Object.entries(children)) {
        if (childDef && typeof childDef === 'object') {
          walkGroups(childDef as Record<string, unknown>, childGroup);
        }
      }
    }
    // Top-level keys that are group names (non-'all' pattern)
    for (const [k, v] of Object.entries(obj)) {
      if (['vars', 'hosts', 'children'].includes(k)) continue;
      if (v && typeof v === 'object' && ('hosts' in (v as object) || 'vars' in (v as object) || 'children' in (v as object))) {
        walkGroups(v as Record<string, unknown>, k);
      }
    }
  }
  walkGroups(doc);
}

/** Flat key-value files (defaults, vars, group_vars, host_vars). */
function extractFlatVars(
  doc: Record<string, unknown>,
  text: string,
  file: string,
  cls: FileClass,
  defs: VarDefinition[],
) {
  for (const [k, v] of Object.entries(doc)) {
    const children = typeof v === 'object' && v !== null && !Array.isArray(v)
      ? flattenKeys(v as Record<string, unknown>, k)
      : undefined;
    defs.push({
      name: k,
      value: v,
      file,
      line: findKeyLine(text, k),
      sourceType: cls.sourceType,
      scope: cls.scope,
      children,
    });
  }
}

/** Playbooks: extract vars:, vars_files:, role params, and usages. */
function extractPlaybookVars(
  doc: unknown,
  text: string,
  file: string,
  defs: VarDefinition[],
  usages: VarUsage[],
) {
  const plays = Array.isArray(doc) ? doc : [doc];
  for (const play of plays) {
    if (!play || typeof play !== 'object') continue;
    const p = play as Record<string, unknown>;

    // vars: block
    if (p['vars'] && typeof p['vars'] === 'object') {
      for (const [k, v] of Object.entries(p['vars'] as Record<string, unknown>)) {
        defs.push({
          name: k, value: v, file,
          line: findKeyLine(text, k),
          sourceType: 'play_vars',
        });
      }
    }

    // roles: with params
    if (Array.isArray(p['roles'])) {
      for (const roleEntry of p['roles']) {
        if (roleEntry && typeof roleEntry === 'object') {
          const r = roleEntry as Record<string, unknown>;
          for (const [k, v] of Object.entries(r)) {
            if (['role', 'when', 'tags', 'become', 'become_user', 'any_errors_fatal'].includes(k)) continue;
            defs.push({
              name: k, value: v, file,
              line: findKeyLine(text, k),
              sourceType: 'include_params',
              scope: String(r['role'] ?? ''),
            });
          }
        }
      }
    }

    // Extract Jinja2 usages from the whole play text
    extractJinjaUsages(text, file, { sourceType: 'play_usage' }, usages);
  }
}

/** Task files: find set_fact, register, vars, and Jinja2 references. */
function extractTaskVars(
  doc: unknown,
  text: string,
  file: string,
  cls: FileClass,
  defs: VarDefinition[],
  usages: VarUsage[],
) {
  const tasks = Array.isArray(doc) ? doc : [doc];

  function walkTasks(items: unknown[]) {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const t = item as Record<string, unknown>;

      // set_fact / ansible.builtin.set_fact
      for (const key of ['set_fact', 'ansible.builtin.set_fact']) {
        if (t[key] && typeof t[key] === 'object') {
          for (const [k, v] of Object.entries(t[key] as Record<string, unknown>)) {
            if (k === 'cacheable') continue;
            defs.push({
              name: k, value: v, file,
              line: findKeyLine(text, k),
              sourceType: 'set_fact',
              scope: cls.scope,
            });
          }
        }
      }

      // register:
      if (typeof t['register'] === 'string') {
        defs.push({
          name: t['register'], value: '<registered>', file,
          line: findKeyLine(text, 'register'),
          sourceType: 'register',
          scope: cls.scope,
        });
      }

      // vars: on a task
      if (t['vars'] && typeof t['vars'] === 'object') {
        for (const [k, v] of Object.entries(t['vars'] as Record<string, unknown>)) {
          defs.push({
            name: k, value: v, file,
            line: findKeyLine(text, k),
            sourceType: 'task_vars',
            scope: cls.scope,
          });
        }
      }

      // include_vars
      for (const key of ['include_vars', 'ansible.builtin.include_vars']) {
        if (t[key]) {
          const iv = t[key];
          if (typeof iv === 'object' && iv !== null && 'name' in (iv as object)) {
            defs.push({
              name: String((iv as Record<string, unknown>)['name']),
              value: '<include_vars>',
              file,
              line: findKeyLine(text, key),
              sourceType: 'include_vars',
              scope: cls.scope,
            });
          }
        }
      }

      // Recurse into block/rescue/always
      for (const blockKey of ['block', 'rescue', 'always']) {
        if (Array.isArray(t[blockKey])) {
          walkTasks(t[blockKey] as unknown[]);
        }
      }
    }
  }

  walkTasks(tasks);
  extractJinjaUsages(text, file, cls, usages);
}

/** Extract Jinja2 variable references from raw text. */
function extractJinjaUsages(
  text: string,
  file: string,
  cls: FileClass,
  usages: VarUsage[],
) {
  const lines = text.split('\n');
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // {{ var }} patterns
    let m: RegExpExecArray | null;
    JINJA_VAR_RE.lastIndex = 0;
    while ((m = JINJA_VAR_RE.exec(line))) {
      const name = m[1];
      if (isBuiltin(name)) continue;
      const key = `${file}:${i + 1}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      usages.push({
        name,
        file,
        line: i + 1,
        sourceType: cls.sourceType === 'template_usage' ? 'template_usage' : 'task_usage',
        expression: line.trim(),
      });
    }

    // when: conditions (not inside {{ }})
    if (/^\s*(when|failed_when|changed_when|until)\s*:/.test(line) || /^\s*-\s/.test(line)) {
      WHEN_VAR_RE.lastIndex = 0;
      while ((m = WHEN_VAR_RE.exec(line))) {
        const name = m[1];
        if (isBuiltin(name) || isKeyword(name)) continue;
        const key = `${file}:${i + 1}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        usages.push({
          name,
          file,
          line: i + 1,
          sourceType: 'task_usage',
          expression: line.trim(),
        });
      }
    }
  }
}

/** Flatten nested dict keys into dot-paths. */
function flattenKeys(obj: Record<string, unknown>, prefix: string): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const dotPath = `${prefix}.${k}`;
    keys.push(dotPath);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, dotPath));
    }
  }
  return keys;
}

/** Skip Ansible built-in variables / magic vars. */
function isBuiltin(name: string): boolean {
  const builtins = new Set([
    'ansible_host', 'ansible_user', 'ansible_port', 'ansible_connection',
    'ansible_become', 'ansible_become_user', 'ansible_become_method',
    'ansible_ssh_private_key_file', 'ansible_python_interpreter',
    'inventory_hostname', 'inventory_hostname_short', 'inventory_dir',
    'inventory_file', 'playbook_dir', 'role_path', 'ansible_play_hosts',
    'ansible_play_hosts_all', 'ansible_play_batch', 'groups', 'group_names',
    'hostvars', 'ansible_facts', 'ansible_local', 'ansible_env',
    'ansible_os_family', 'ansible_distribution', 'ansible_pkg_mgr',
    'omit', 'true', 'false', 'none', 'item', 'ansible_loop',
    'ansible_loop_var', 'ansible_index_var',
  ]);
  return builtins.has(name);
}

function isKeyword(name: string): boolean {
  const kw = new Set([
    'when', 'and', 'or', 'not', 'in', 'is', 'true', 'false', 'none',
    'block', 'rescue', 'always', 'loop', 'with_items', 'register',
    'become', 'become_user', 'tags', 'notify', 'changed', 'failed',
    'skipped', 'succeeded', 'defined', 'undefined', 'bool', 'int',
    'float', 'string', 'list', 'dict', 'default', 'length', 'lower',
    'upper', 'trim', 'join', 'map', 'select', 'reject', 'first', 'last',
    'combine', 'to_json', 'from_json', 'to_yaml', 'from_yaml',
    'regex_replace', 'regex_search', 'basename', 'dirname',
  ]);
  return kw.has(name);
}
