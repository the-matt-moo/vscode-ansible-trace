import React, { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  MarkerType,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { FlowGraph, FlowNode as FN, FlowEdge as FE } from '../../src/types';

const elk = new ELK();

const KIND_COLOR: Record<FN['kind'], string> = {
  playbook: '#3498db',
  role: '#2ecc71',
  tasks: '#95a5a6',
  unresolved: '#e74c3c',
};

const EDGE_STYLE: Record<FE['kind'], { stroke: string; dash?: string }> = {
  runs:       { stroke: '#3498db' },
  imports:    { stroke: '#3498db' },
  contains:   { stroke: '#7f8c8d' },
  includes:   { stroke: '#95a5a6' },
  calls:      { stroke: '#2ecc71' },
  depends:    { stroke: '#9b59b6' },
  unresolved: { stroke: '#e74c3c', dash: '2 4' },
};

interface NodeData extends FN {
  onJump: (file: string, line: number) => void;
}

function FlowNodeView({ data }: NodeProps) {
  const d = data as unknown as NodeData;
  const color = KIND_COLOR[d.kind];
  return (
    <div style={{
      width: 260, boxSizing: 'border-box', padding: '6px 10px', fontSize: 12,
      background: 'var(--vscode-editor-background)',
      border: `2px ${d.kind === 'unresolved' ? 'dashed' : 'solid'} ${color}`,
      borderRadius: 8,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <span style={{
        padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
        background: color, color: '#fff',
      }}>
        {d.kind === 'unresolved' ? 'dynamic' : d.kind}
      </span>
      <div style={{ fontWeight: 600, marginTop: 4, wordBreak: 'break-all' }}>{d.label}</div>
      {d.file && (
        <div
          onClick={e => { e.stopPropagation(); d.onJump(d.file, d.line); }}
          title={`Open ${d.file}:${d.line}`}
          style={{
            fontSize: 10, marginTop: 4, cursor: 'pointer', wordBreak: 'break-all',
            color: 'var(--vscode-textLink-foreground)', textDecoration: 'underline',
          }}
        >
          {d.file}:{d.line}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: color }} />
    </div>
  );
}

const nodeTypes: NodeTypes = { flow: FlowNodeView };

interface Props {
  flow: FlowGraph;
  onJump: (file: string, line: number) => void;
}

export function FlowView(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
}

function FlowCanvas({ flow, onJump }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setSelectedId(null);
    const rfEdges: Edge[] = flow.edges.map(e => {
      const s = EDGE_STYLE[e.kind];
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        // Only conditional edges get a caption: direction and kind are shown by style.
        label: e.conditional ? 'when' : undefined,
        labelStyle: { fontSize: 10 },
        style: {
          stroke: s.stroke,
          strokeWidth: 2,
          // Dashed = dynamic include (include_*), dotted red = unresolved.
          strokeDasharray: e.mode === 'include' ? '6 4' : s.dash,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke },
      };
    });

    elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': '40',
        'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      },
      children: flow.nodes.map(n => ({ id: n.id, width: 260, height: 70 })),
      edges: flow.edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    }).then(layouted => {
      const rfNodes: Node[] = flow.nodes.map(n => {
        const p = layouted.children?.find(c => c.id === n.id);
        return {
          id: n.id,
          type: 'flow',
          position: { x: p?.x ?? 0, y: p?.y ?? 0 },
          data: { ...n, onJump } as unknown as Record<string, unknown>,
        };
      });
      setNodes(rfNodes);
      setEdges(rfEdges);
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 200 }));
    });
  }, [flow]);

  // Highlight the selected node's edges; dim the rest.
  const styledEdges = useMemo(() => edges.map(e => {
    if (!selectedId) return e;
    const active = e.source === selectedId || e.target === selectedId;
    return { ...e, style: { ...e.style, opacity: active ? 1 : 0.12 } };
  }), [edges, selectedId]);

  const onNodeClick: NodeMouseHandler = (_, node) => setSelectedId(node.id);
  const onNodeDoubleClick: NodeMouseHandler = (_, node) => {
    const d = node.data as unknown as NodeData;
    if (d.file) onJump(d.file, d.line);
  };

  const count = (k: FN['kind']) => flow.nodes.filter(n => n.kind === k).length;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ReactFlow
        nodes={nodes.map(n => ({ ...n, selected: n.id === selectedId }))}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={() => setSelectedId(null)}
        nodeTypes={nodeTypes}
        minZoom={0.1}
        maxZoom={2.5}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnScroll={false}
        selectionOnDrag={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--vscode-editorLineNumber-foreground)" />
        <Controls showInteractive={false} style={{ background: 'var(--vscode-sideBar-background)', borderRadius: 4 }} />
        <Panel position="top-left">
          <div style={{
            padding: '6px 12px', borderRadius: 4, fontSize: 12,
            background: 'var(--vscode-badge-background)', color: 'var(--vscode-badge-foreground)',
          }}>
            {count('playbook')} playbooks · {count('role')} roles · {count('tasks')} task files · {count('unresolved')} dynamic
          </div>
        </Panel>
        <Panel position="bottom-left">
          <div style={{
            display: 'flex', gap: 12, padding: '4px 10px', borderRadius: 4, fontSize: 10,
            background: 'var(--vscode-sideBar-background)', opacity: 0.85,
          }}>
            <Legend color={KIND_COLOR.playbook} label="Playbook" />
            <Legend color={KIND_COLOR.role} label="Role" />
            <Legend color={KIND_COLOR.tasks} label="Task file" />
            <Legend color={KIND_COLOR.unresolved} label="Dynamic (unresolved)" />
            <span style={{ opacity: 0.7 }}>dashed edge: include_* · when: conditional · click: highlight · dbl-click: open</span>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}
