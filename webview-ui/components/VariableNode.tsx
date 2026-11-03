import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

/** Color by precedence tier — matches the legend. */
function tierColor(precedence: number): string {
  if (precedence >= 18) return '#e74c3c'; // set_fact, register
  if (precedence >= 15) return '#e67e22'; // role vars, block/task vars
  if (precedence >= 12) return '#f1c40f'; // play vars
  if (precedence >= 3)  return '#3498db'; // inventory, group/host vars
  if (precedence >= 1)  return '#2ecc71'; // role defaults
  return '#95a5a6';                        // usages (precedence 0)
}

function sourceLabel(sourceType: string): string {
  const labels: Record<string, string> = {
    role_defaults:   'defaults',
    inventory_group: 'inventory',
    inventory_host:  'host var',
    group_vars:      'group_vars',
    host_vars:       'host_vars',
    play_vars:       'play vars',
    play_vars_files: 'vars_files',
    role_vars:       'role vars',
    block_vars:      'block vars',
    task_vars:       'task vars',
    include_vars:    'include_vars',
    set_fact:        'set_fact',
    register:        'register',
    include_params:  'include params',
    template_usage:  'template',
    task_usage:      'task',
    play_usage:      'playbook',
  };
  return labels[sourceType] ?? sourceType;
}

function shortPath(file: string): string {
  // Show last 2-3 path segments
  const parts = file.replace(/\\/g, '/').split('/');
  return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : file;
}

export const VariableNode = memo(function VariableNode({ data }: NodeProps) {
  const d = data as any;
  const isSelected = d.type === 'selected';
  const color = isSelected ? 'var(--vscode-focusBorder)' : tierColor(d.precedence);
  const isDef = d.type === 'definition';

  return (
    <div
      style={{
        background: 'var(--vscode-editor-background)',
        border: `2px solid ${color}`,
        borderRadius: 8,
        padding: '8px 12px',
        width: 380,
        boxShadow: `0 2px 8px ${color}33`,
        cursor: 'pointer',
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{
          padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
          background: color, color: '#fff',
        }}>
          {isSelected ? 'selected' : sourceLabel(d.sourceType)}
        </span>
        {d.scope && (
          <span style={{ fontSize: 10, opacity: 0.6 }}>
            {d.scope}
          </span>
        )}
        {isDef && d.precedence > 0 && (
          <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 'auto' }}>
            P{d.precedence}
          </span>
        )}
      </div>

      {/* Variable name */}
      <div style={{
        fontWeight: 600, fontSize: 13,
        color: 'var(--vscode-editor-foreground)',
        cursor: 'pointer',
        wordBreak: 'break-all',
      }}
        onClick={() => d.onTrace?.(d.name)}
        title={`Click to trace "${d.name}"`}
      >
        {d.name}
      </div>

      {/* Value preview */}
      {d.value && (
        <div style={{
          fontSize: 11, opacity: 0.7, marginTop: 2,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          fontFamily: 'var(--vscode-editor-font-family)',
        }}
          title={d.value}
        >
          {d.value}
        </div>
      )}

      {/* File location */}
      {d.file && (
        <div style={{
          fontSize: 10, marginTop: 4, cursor: 'pointer',
          color: 'var(--vscode-textLink-foreground)',
          textDecoration: 'underline', wordBreak: 'break-all',
        }}
          onClick={(e) => { e.stopPropagation(); d.onJump?.(d.file, d.line); }}
          title={`Open ${d.file}:${d.line}`}
        >
          {shortPath(d.file)}:{d.line}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ background: color }} />
    </div>
  );
});
