/** Where in Ansible's hierarchy a variable was found. */
export type SourceType =
  | 'role_defaults'    // roles/x/defaults/main.yml
  | 'inventory_group'  // inventory file, under a group's vars
  | 'inventory_host'   // inventory file, per-host vars
  | 'group_vars'       // group_vars/**/*.yml
  | 'host_vars'        // host_vars/**/*.yml
  | 'play_vars'        // playbook vars: block
  | 'play_vars_files'  // playbook vars_files:
  | 'role_vars'        // roles/x/vars/main.yml
  | 'block_vars'       // block-level vars:
  | 'task_vars'        // task-level vars:
  | 'include_vars'     // include_vars module
  | 'set_fact'         // set_fact / ansible.builtin.set_fact
  | 'register'         // register: directive
  | 'include_params'   // include_role / include_tasks params
  | 'template_usage'   // usage inside *.j2
  | 'task_usage'       // usage inside task values / when / loop
  | 'play_usage';      // usage inside playbook expressions

/** A place where a variable is defined (assigned a value). */
export interface VarDefinition {
  name: string;
  value: unknown;
  file: string;       // workspace-relative path
  line: number;
  sourceType: SourceType;
  scope?: string;      // role name, group name, host name
  /** Dot-path children for dict vars, e.g. ['features.prometheus', 'features.ceph'] */
  children?: string[];
}

/** A place where a variable is referenced. */
export interface VarUsage {
  name: string;
  file: string;
  line: number;
  sourceType: SourceType;
  expression: string;  // the raw Jinja2 / YAML expression containing the reference
}

/** Full scan output for a workspace. */
export interface ScanResult {
  definitions: VarDefinition[];
  usages: VarUsage[];
  inventoryFiles: string[];
}

// ── Graph model (sent to webview) ──

export interface GraphNode {
  id: string;
  type: 'definition' | 'usage' | 'selected';
  name: string;
  value?: string;      // stringified preview
  file: string;
  line: number;
  sourceType: SourceType;
  precedence: number;
  scope?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: 'defines' | 'overrides' | 'uses' | 'derives' | 'merges';
}

export interface TraceResult {
  variable: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Resolved value at a specific precedence level. */
export interface PrecedenceEntry {
  sourceType: SourceType;
  precedence: number;
  value: unknown;
  file: string;
  line: number;
  scope?: string;
  isWinner: boolean;
}

export interface PrecedenceResult {
  variable: string;
  inventory: string;
  entries: PrecedenceEntry[];
  resolvedValue: unknown;
}

// ── Webview message protocol ──

export type ExtToWebview =
  | { type: 'setTrace'; data: TraceResult }
  | { type: 'setPrecedence'; data: PrecedenceResult }
  | { type: 'setInventories'; data: string[] }
  | { type: 'setVariableList'; data: string[] }
  | { type: 'setTheme'; data: 'light' | 'dark' };

export type WebviewToExt =
  | { type: 'traceVariable'; name: string }
  | { type: 'jumpToSource'; file: string; line: number }
  | { type: 'selectInventory'; file: string }
  | { type: 'resolvePrecedence'; name: string; inventory: string }
  | { type: 'ready' };
