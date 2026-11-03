import React, { useState, useEffect, useCallback } from 'react';
import { TraceGraph } from './components/TraceGraph';
import { PrecedencePanel } from './components/PrecedencePanel';
import type { TraceResult, PrecedenceResult, ExtToWebview, WebviewToExt } from '../src/types';

// VS Code API handle
declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToExt): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

type Tab = 'trace' | 'precedence';

export function App() {
  const [tab, setTab] = useState<Tab>('trace');
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [precedence, setPrecedence] = useState<PrecedenceResult | null>(null);
  const [inventories, setInventories] = useState<string[]>([]);
  const [variables, setVariables] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const handler = (e: MessageEvent<ExtToWebview>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'setTrace':
          setTrace(msg.data);
          setTab('trace');
          break;
        case 'setPrecedence':
          setPrecedence(msg.data);
          setTab('precedence');
          break;
        case 'setInventories':
          setInventories(msg.data);
          break;
        case 'setVariableList':
          setVariables(msg.data);
          break;
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const jumpToSource = useCallback((file: string, line: number) => {
    vscode.postMessage({ type: 'jumpToSource', file, line });
  }, []);

  const traceVariable = useCallback((name: string) => {
    vscode.postMessage({ type: 'traceVariable', name });
  }, []);

  const resolvePrecedence = useCallback((name: string, inventory: string) => {
    vscode.postMessage({ type: 'resolvePrecedence', name, inventory });
  }, []);

  const filteredVars = search
    ? variables.filter(v => v.toLowerCase().includes(search.toLowerCase()))
    : variables;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        borderBottom: '1px solid var(--vscode-panel-border)',
        background: 'var(--vscode-sideBar-background)',
        flexShrink: 0,
      }}>
        <button
          onClick={() => setTab('trace')}
          style={tabStyle(tab === 'trace')}
        >
          Trace
        </button>
        <button
          onClick={() => {
            setTab('precedence');
            // Follow the traced variable when the tab is opened.
            if (trace && precedence?.variable !== trace.variable) {
              vscode.postMessage({
                type: 'resolvePrecedence',
                name: trace.variable,
                inventory: precedence?.inventory ?? '(all inventories)',
              });
            }
          }}
          style={tabStyle(tab === 'precedence')}
        >
          Precedence
        </button>
        <span style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="Search variables..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: 200, padding: '3px 8px',
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
            borderRadius: 3, fontSize: 12,
          }}
        />
      </div>

      {/* Variable quick-pick dropdown */}
      {search && filteredVars.length > 0 && (
        <div style={{
          position: 'absolute', top: 38, right: 12, zIndex: 100,
          background: 'var(--vscode-dropdown-background)',
          border: '1px solid var(--vscode-dropdown-border)',
          borderRadius: 3, maxHeight: 200, overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {filteredVars.slice(0, 30).map(v => (
            <div
              key={v}
              onClick={() => { traceVariable(v); setSearch(''); }}
              style={{
                padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                color: 'var(--vscode-dropdown-foreground)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {v}
            </div>
          ))}
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {tab === 'trace' && (
          trace
            ? <TraceGraph trace={trace} onJump={jumpToSource} onTrace={traceVariable} />
            : <EmptyState text="Right-click a variable in a YAML file and select 'Trace Ansible Variable', or search above." />
        )}
        {tab === 'precedence' && (
          precedence
            ? <PrecedencePanel
                key={precedence.variable + '|' + precedence.inventory}
                result={precedence}
                inventories={inventories}
                variables={variables}
                onJump={jumpToSource}
                onResolve={resolvePrecedence}
              />
            : <EmptyState text="Select a variable and inventory to see precedence resolution." />
        )}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', opacity: 0.5, padding: 40, textAlign: 'center',
      fontSize: 14,
    }}>
      {text}
    </div>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 12px',
    background: active ? 'var(--vscode-button-background)' : 'transparent',
    color: active ? 'var(--vscode-button-foreground)' : 'var(--vscode-foreground)',
    border: 'none',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
  };
}
