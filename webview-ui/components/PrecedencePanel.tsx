import React, { useState } from 'react';
import type { PrecedenceResult } from '../../src/types';

function tierColor(precedence: number): string {
  if (precedence >= 18) return '#e74c3c';
  if (precedence >= 15) return '#e67e22';
  if (precedence >= 12) return '#f1c40f';
  if (precedence >= 3)  return '#3498db';
  if (precedence >= 1)  return '#2ecc71';
  return '#95a5a6';
}

function sourceLabel(sourceType: string): string {
  const labels: Record<string, string> = {
    role_defaults: 'Role Defaults', inventory_group: 'Inventory Group Vars',
    inventory_host: 'Inventory Host Vars', group_vars: 'group_vars/',
    host_vars: 'host_vars/', play_vars: 'Play vars:',
    play_vars_files: 'Play vars_files:', role_vars: 'Role vars/',
    block_vars: 'Block vars:', task_vars: 'Task vars:',
    include_vars: 'include_vars', set_fact: 'set_fact',
    register: 'register', include_params: 'Include Params',
  };
  return labels[sourceType] ?? sourceType;
}

function shortPath(file: string): string {
  const parts = file.replace(/\\/g, '/').split('/');
  return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : file;
}

interface Props {
  result: PrecedenceResult;
  inventories: string[];
  variables: string[];
  onJump: (file: string, line: number) => void;
  onResolve: (name: string, inventory: string) => void;
}

export function PrecedencePanel({ result, inventories, variables, onJump, onResolve }: Props) {
  const [varInput, setVarInput] = useState(result.variable);
  const [invInput, setInvInput] = useState(result.inventory);
  const [showVarSuggestions, setShowVarSuggestions] = useState(false);

  const filteredVars = varInput
    ? variables.filter(v => v.toLowerCase().includes(varInput.toLowerCase())).slice(0, 20)
    : [];

  function doResolve() {
    if (varInput) onResolve(varInput, invInput);
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Controls */}
      <div style={{
        padding: '10px 16px', display: 'flex', gap: 8, alignItems: 'flex-end',
        borderBottom: '1px solid var(--vscode-panel-border)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        {/* Variable input */}
        <div style={{ position: 'relative', flex: 1, minWidth: 150 }}>
          <label style={{ fontSize: 10, opacity: 0.6, display: 'block', marginBottom: 2 }}>Variable</label>
          <input
            value={varInput}
            onChange={e => { setVarInput(e.target.value); setShowVarSuggestions(true); }}
            onFocus={() => setShowVarSuggestions(true)}
            onBlur={() => setTimeout(() => setShowVarSuggestions(false), 200)}
            onKeyDown={e => e.key === 'Enter' && doResolve()}
            style={inputStyle}
            placeholder="e.g. features.prometheus"
          />
          {showVarSuggestions && filteredVars.length > 0 && (
            <div style={dropdownStyle}>
              {filteredVars.map(v => (
                <div key={v} style={dropdownItemStyle}
                  onMouseDown={() => { setVarInput(v); setShowVarSuggestions(false); }}>
                  {v}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inventory selector */}
        <div style={{ minWidth: 150 }}>
          <label style={{ fontSize: 10, opacity: 0.6, display: 'block', marginBottom: 2 }}>Inventory</label>
          <select
            value={invInput}
            onChange={e => setInvInput(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="(all inventories)">(all inventories)</option>
            {inventories.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <button onClick={doResolve} style={btnStyle}>Resolve</button>
      </div>

      {/* Result header */}
      <div style={{
        padding: '10px 16px 6px', display: 'flex', alignItems: 'center', gap: 12,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{result.variable}</span>
        <span style={{ fontSize: 11, opacity: 0.5 }}>
          {result.entries.length} definition{result.entries.length !== 1 ? 's' : ''} found
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.6 }}>
          inventory: {result.inventory}
        </span>
      </div>

      {/* Resolved value */}
      <div style={{
        margin: '0 16px 10px', padding: '8px 12px',
        background: 'var(--vscode-textCodeBlock-background)',
        borderRadius: 4, fontSize: 13,
        fontFamily: 'var(--vscode-editor-font-family)',
        borderLeft: `3px solid ${result.entries.length > 0 ? tierColor(result.entries.find(e => e.isWinner)?.precedence ?? 0) : '#95a5a6'}`,
      }}>
        <span style={{ opacity: 0.5, fontSize: 10, marginRight: 8 }}>resolved value:</span>
        <span style={{ fontWeight: 600 }}>{formatValue(result.resolvedValue)}</span>
      </div>

      {/* Precedence stack (visual waterfall) */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8 }}>
          LOW precedence (bottom wins) → HIGH precedence
        </div>

        {result.entries.map((entry, i) => {
          const color = tierColor(entry.precedence);
          const barWidth = Math.max(15, (entry.precedence / 21) * 100);

          return (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 0',
                borderBottom: '1px solid var(--vscode-panel-border)',
                opacity: entry.isWinner ? 1 : 0.65,
                cursor: 'pointer',
              }}
              onClick={() => onJump(entry.file, entry.line)}
              title={`${entry.file}:${entry.line} — click to open`}
            >
              {/* Precedence bar */}
              <div style={{ width: 120, flexShrink: 0 }}>
                <div style={{
                  height: 18, width: `${barWidth}%`, borderRadius: 3,
                  background: color, display: 'flex', alignItems: 'center',
                  paddingLeft: 6, fontSize: 10, color: '#fff', fontWeight: 600,
                  minWidth: 24,
                }}>
                  P{entry.precedence}
                </div>
              </div>

              {/* Source badge */}
              <span style={{
                padding: '1px 8px', borderRadius: 3, fontSize: 10,
                background: `${color}22`, color, fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>
                {sourceLabel(entry.sourceType)}
              </span>

              {/* Scope */}
              {entry.scope && (
                <span style={{ fontSize: 10, opacity: 0.6, whiteSpace: 'nowrap' }}>
                  ({entry.scope})
                </span>
              )}

              {/* Value */}
              <span style={{
                flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', fontFamily: 'var(--vscode-editor-font-family)',
              }}>
                {formatValue(entry.value)}
              </span>

              {/* File */}
              <span style={{ fontSize: 10, opacity: 0.4, whiteSpace: 'nowrap' }}>
                {shortPath(entry.file)}:{entry.line}
              </span>

              {/* Winner badge */}
              {entry.isWinner && (
                <span style={{
                  padding: '1px 6px', borderRadius: 3, fontSize: 9,
                  background: '#2ecc71', color: '#fff', fontWeight: 700,
                }}>
                  WINS
                </span>
              )}
            </div>
          );
        })}

        {result.entries.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 13, padding: 20, textAlign: 'center' }}>
            No definitions found for this variable in the selected scope.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ──

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '4px 8px',
  background: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  border: '1px solid var(--vscode-input-border)',
  borderRadius: 3, fontSize: 12,
};

const btnStyle: React.CSSProperties = {
  padding: '4px 14px',
  background: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
  border: 'none', borderRadius: 3,
  cursor: 'pointer', fontSize: 12, fontWeight: 600,
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
  background: 'var(--vscode-dropdown-background)',
  border: '1px solid var(--vscode-dropdown-border)',
  borderRadius: 3, maxHeight: 180, overflowY: 'auto',
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
};

const dropdownItemStyle: React.CSSProperties = {
  padding: '3px 10px', cursor: 'pointer', fontSize: 12,
  color: 'var(--vscode-dropdown-foreground)',
};

// ── Helpers ──

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return 'undefined';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}
