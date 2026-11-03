import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { findYamlFiles } from './scanner.js';
import type { FlowGraph, FlowNode, FlowEdge } from './types.js';

/**
 * Static playbook -> role -> task-file graph.
 * Only literal references are resolved. Anything containing "{{" or missing on disk
 * becomes an "unresolved" node so the user can see it.
 */
export function scanFlow(root: string): FlowGraph {
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, FlowEdge>();
  const pending: Array<() => void> = [];
  const cache = new Map<string, string>();

  // Paths are workspace-relative with forward slashes.
  const read = (r: string): string => {
    if (!cache.has(r)) {
      try { cache.set(r, fs.readFileSync(path.join(root, r), 'utf-8')); }
      catch { cache.set(r, ''); }
    }
    return cache.get(r)!;
  };
  const stat = (r: string) => { try { return fs.statSync(path.join(root, r)); } catch { return undefined; } };
  const isFile = (r: string) => stat(r)?.isFile() ?? false;
  const isDir = (r: string) => stat(r)?.isDirectory() ?? false;
  const parse = (r: string): unknown => { try { return yaml.load(read(r)); } catch { return undefined; } };
  const lineOf = (r: string, needle: string): number => {
    const i = read(r).split('\n').findIndex(l => l.includes(needle));
    return i < 0 ? 1 : i + 1;
  };

  const addNode = (n: FlowNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const addEdge = (source: string, target: string, kind: FlowEdge['kind'], conditional: boolean, mode?: FlowEdge['mode']) => {
    const id = `${source}->${target}:${kind}`;
    const existing = edges.get(id);
    if (existing) existing.conditional = existing.conditional && conditional;
    else edges.set(id, { id, source, target, kind, conditional, mode });
  };

  // ── Resolvers (return undefined when the reference cannot be resolved statically) ──

  const roleDir = (name: string): string | undefined => {
    const n = name.trim().replace(/^opennebula\.deploy\./, '');
    if (!n || n.includes('{{')) return undefined;
    // Collection-qualified names use dots: opennebula.deploy.helper.facts -> roles/helper/facts
    for (const cand of [n, n.replace(/\./g, '/')]) {
      if (isDir(`roles/${cand}`)) return `roles/${cand}`;
    }
    return undefined;
  };

  const resolveFile = (raw: string, from: string, extra: string[] = []): string | undefined => {
    if (!raw) return undefined;
    // {{ role_path }} inside a role's own files means that role's directory.
    const rolePath = /^(roles\/[^/]+(?:\/[^/]+)*?)\/(?:tasks|handlers|meta|vars|defaults|templates)\//.exec(from)?.[1];
    if (rolePath && raw.startsWith('{{ role_path }}/')) {
      const abs = raw.replace('{{ role_path }}', rolePath);
      return !abs.includes('{{') && isFile(abs) ? abs : undefined; // already workspace-relative
    }
    if (raw.includes('{{')) return undefined;
    const dir = path.posix.dirname(from);
    for (const c of [path.posix.join(dir, raw), ...extra]) {
      for (const cand of [c, `${c}.yml`]) if (isFile(cand)) return cand;
    }
    return undefined;
  };

  const resolvePlaybook = (raw: string, from: string): string | undefined => {
    if (raw.startsWith('opennebula.deploy.')) {
      return resolveFile(`${raw.slice('opennebula.deploy.'.length)}.yml`, 'playbooks/x.yml', ['playbooks']);
    }
    return resolveFile(raw, from);
  };

  // ── Node factories (lazy: each new node queues its own processing) ──

  const playbookNode = (file: string): string => {
    const id = `pb:${file}`;
    if (!nodes.has(id)) {
      addNode({ id, kind: 'playbook', label: path.posix.basename(file), file, line: 1 });
      pending.push(() => processPlaybook(file, id));
    }
    return id;
  };

  const taskNode = (file: string): string => {
    const id = `tasks:${file}`;
    if (!nodes.has(id)) {
      addNode({ id, kind: 'tasks', label: file, file, line: 1 });
      pending.push(() => processTaskFile(file, id));
    }
    return id;
  };

  const roleNode = (dir: string): string => {
    const id = `role:${dir}`;
    if (!nodes.has(id)) {
      const tasks = `${dir}/tasks/main.yml`;
      // Open the role's tasks entry point when it exists, so double-click lands on a file.
      addNode({ id, kind: 'role', label: dir.replace(/^roles\//, ''), file: isFile(tasks) ? tasks : dir, line: 1 });
      if (isFile(tasks)) addEdge(id, taskNode(tasks), 'contains', false);
      const meta = `${dir}/meta/main.yml`;
      if (isFile(meta)) pending.push(() => processMeta(meta, id));
    }
    return id;
  };

  const unresolved = (src: string, file: string, raw: string, conditional: boolean, mode?: FlowEdge['mode']) => {
    const id = `unres:${file}:${raw}`;
    addNode({ id, kind: 'unresolved', label: raw, file, line: lineOf(file, raw) });
    addEdge(src, id, 'unresolved', conditional, mode);
  };

  // ── Processors ──

  const processMeta = (file: string, roleId: string) => {
    const doc = parse(file) as Record<string, unknown> | undefined;
    const deps = Array.isArray(doc?.dependencies) ? doc!.dependencies as unknown[] : [];
    for (const d of deps) {
      const raw = typeof d === 'string' ? d : String((d as Record<string, unknown>)?.role ?? (d as Record<string, unknown>)?.name ?? '');
      const cond = typeof d === 'object' && d !== null && 'when' in d;
      const dir = roleDir(raw);
      if (dir) addEdge(roleId, roleNode(dir), 'depends', cond);
      else unresolved(roleId, file, raw, cond);
    }
  };

  const processTaskFile = (file: string, id: string) => {
    const doc = parse(file);
    if (Array.isArray(doc)) processTaskList(doc, file, id, false);
  };

  const processPlaybook = (file: string, id: string) => {
    const doc = parse(file);
    if (!Array.isArray(doc)) return;
    for (const item of doc) {
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      const cond = 'when' in it;

      const imp = it['import_playbook'] ?? it['ansible.builtin.import_playbook'];
      if (imp !== undefined) {
        const raw = String(imp);
        const target = resolvePlaybook(raw, file);
        if (target) addEdge(id, playbookNode(target), 'imports', cond, 'import');
        else unresolved(id, file, raw, cond, 'import');
      }

      if ('hosts' in it) {
        for (const e of Array.isArray(it.roles) ? it.roles : []) {
          const raw = typeof e === 'string' ? e : String((e as Record<string, unknown>)?.role ?? (e as Record<string, unknown>)?.name ?? '');
          const c = cond || (typeof e === 'object' && e !== null && 'when' in e);
          const dir = roleDir(raw);
          if (dir) addEdge(id, roleNode(dir), 'runs', c);
          else unresolved(id, file, raw, c);
        }
        for (const key of ['pre_tasks', 'tasks', 'post_tasks']) {
          if (Array.isArray(it[key])) processTaskList(it[key] as unknown[], file, id, cond);
        }
      }
    }
  };

  /** Walk one task list. srcId is the node that "owns" these tasks. */
  const processTaskList = (list: unknown[], file: string, srcId: string, parentCond: boolean) => {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      const cond = parentCond || 'when' in it;

      for (const key of ['import_role', 'include_role', 'ansible.builtin.import_role', 'ansible.builtin.include_role']) {
        if (!(key in it)) continue;
        const arg = it[key];
        const raw = typeof arg === 'string' ? arg : String((arg as Record<string, unknown>)?.name ?? '');
        const mode = key.includes('import') ? 'import' : 'include';
        const dir = roleDir(raw);
        if (dir) addEdge(srcId, roleNode(dir), 'calls', cond, mode);
        else unresolved(srcId, file, raw, cond, mode);
      }

      for (const key of ['import_tasks', 'include_tasks', 'ansible.builtin.import_tasks', 'ansible.builtin.include_tasks']) {
        if (!(key in it)) continue;
        const arg = it[key];
        const raw = typeof arg === 'string' ? arg : String((arg as Record<string, unknown>)?.file ?? (arg as Record<string, unknown>)?.name ?? '');
        const mode = key.includes('import') ? 'import' : 'include';
        const target = resolveFile(raw, file);
        if (target) addEdge(srcId, taskNode(target), 'includes', cond, mode);
        else unresolved(srcId, file, raw, cond, mode);
      }

      for (const blk of ['block', 'rescue', 'always']) {
        if (Array.isArray(it[blk])) processTaskList(it[blk] as unknown[], file, srcId, cond);
      }
    }
  };

  // ── Discovery: every top-level playbook, then drain the queue ──

  const all = findYamlFiles(root)
    .filter(f => /\.ya?ml$/.test(f))
    .map(f => path.relative(root, f).replace(/\\/g, '/'));

  const isPlaybook = (r: string) => {
    if (/^(roles|inventory|group_vars|host_vars)\//.test(r)) return false;
    const doc = parse(r);
    return Array.isArray(doc) && doc.some(i => i && typeof i === 'object' &&
      ('hosts' in i || 'import_playbook' in i || 'ansible.builtin.import_playbook' in i));
  };

  for (const f of all) if (isPlaybook(f)) playbookNode(f);
  while (pending.length) pending.shift()!();

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
