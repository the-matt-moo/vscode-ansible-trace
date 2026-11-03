import type { SourceType } from './types.js';

/**
 * Ansible variable precedence (low → high).
 * https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_variables.html#understanding-variable-precedence
 *
 * We assign numeric levels for sorting. Higher number = wins.
 */
const PRECEDENCE_MAP: Record<SourceType, number> = {
  role_defaults:    1,   // lowest
  inventory_group:  3,
  group_vars:       5,
  inventory_host:   7,
  host_vars:        9,
  play_vars:       12,
  play_vars_files: 13,
  role_vars:       15,
  block_vars:      16,
  task_vars:       17,
  include_vars:    18,
  set_fact:        19,
  register:        19,
  include_params:  20,
  // Usages don't have a precedence — these are just for completeness
  template_usage:   0,
  task_usage:       0,
  play_usage:       0,
};

export function getPrecedence(sourceType: SourceType): number {
  return PRECEDENCE_MAP[sourceType] ?? 0;
}

const PRECEDENCE_LABELS: Record<SourceType, string> = {
  role_defaults:   'Role Defaults',
  inventory_group: 'Inventory Group Vars',
  group_vars:      'group_vars/',
  inventory_host:  'Inventory Host Vars',
  host_vars:       'host_vars/',
  play_vars:       'Play vars:',
  play_vars_files: 'Play vars_files:',
  role_vars:       'Role vars/',
  block_vars:      'Block vars:',
  task_vars:       'Task vars:',
  include_vars:    'include_vars',
  set_fact:        'set_fact',
  register:        'register',
  include_params:  'Include Params',
  template_usage:  'Template',
  task_usage:      'Task',
  play_usage:      'Playbook',
};

export function getPrecedenceLabel(sourceType: SourceType): string {
  return PRECEDENCE_LABELS[sourceType] ?? sourceType;
}

/** Color for each precedence tier (used in webview). */
export function getPrecedenceColor(precedence: number): string {
  if (precedence >= 18) return '#e74c3c'; // red — runtime overrides
  if (precedence >= 15) return '#e67e22'; // orange — role vars, block/task vars
  if (precedence >= 12) return '#f1c40f'; // yellow — play vars
  if (precedence >= 5)  return '#3498db'; // blue — group/host vars
  if (precedence >= 1)  return '#2ecc71'; // green — defaults
  return '#95a5a6';                        // gray — usages
}
