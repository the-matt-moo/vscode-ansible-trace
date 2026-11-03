import React, { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeMouseHandler,
  MarkerType,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { TraceResult } from '../../src/types';
import { VariableNode } from './VariableNode';

const elk = new ELK();

const nodeTypes: NodeTypes = {
  variable: VariableNode,
};

interface Props {
  trace: TraceResult;
  onJump: (file: string, line: number) => void;
  onTrace: (name: string) => void;
}

const edgeStyles: Record<string, { stroke: string; strokeDasharray?: string; label: string }> = {
  overrides: { stroke: '#e67e22', label: 'overrides' },
  uses:      { stroke: '#3498db', label: 'uses' },
  derives:   { stroke: '#9b59b6', label: 'derives' },
  merges:    { stroke: '#e74c3c', strokeDasharray: '5 3', label: 'combine()' },
  defines:   { stroke: '#2ecc71', label: 'defines' },
};

export function TraceGraph(props: Props) {
  // ReactFlowProvider lets the inner component use useReactFlow().
  return (
    <ReactFlowProvider>
      <TraceCanvas {...props} />
    </ReactFlowProvider>
  );
}

function TraceCanvas({ trace, onJump, onTrace }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { fitView } = useReactFlow();

  // Layout: trace -> ELK -> React Flow nodes/edges
  useEffect(() => {
    setSelectedId(null);
    if (!trace.nodes.length) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const rfEdges: Edge[] = trace.edges.map(e => {
      const style = edgeStyles[e.relation] ?? edgeStyles['defines'];
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        // Only merges need a caption; direction and precedence are already shown.
        label: e.relation === 'merges' ? style.label : undefined,
        type: 'smoothstep',
        animated: e.relation === 'uses',
        style: { stroke: style.stroke, strokeWidth: 2, strokeDasharray: style.strokeDasharray },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        labelStyle: { fontSize: 10, fill: 'var(--vscode-descriptionForeground)' },
      };
    });

    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      },
      // Width matches VariableNode (380px); height grows with wrapped value text.
      children: trace.nodes.map(n => ({
        id: n.id,
        width: 380,
        height: (n.type === 'definition' ? 90 : 70) + Math.max(0, Math.ceil((n.value?.length ?? 0) / 52) - 1) * 16,
      })),
      edges: trace.edges.map(e => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
      })),
    };

    elk.layout(elkGraph).then(layouted => {
      const rfNodes: Node[] = trace.nodes.map(n => {
        const elkNode = layouted.children?.find(c => c.id === n.id);
        return {
          id: n.id,
          type: 'variable',
          position: { x: elkNode?.x ?? 0, y: elkNode?.y ?? 0 },
          data: { ...n, onTrace, onJump },
        };
      });
      setNodes(rfNodes);
      setEdges(rfEdges);
      // Refit after nodes are placed; fitView on mount alone runs too early.
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 200 }));
    });
  }, [trace]);

  // Highlight edges touching the selected node; dim the rest.
  const styledEdges = useMemo(() => edges.map(e => {
    if (!selectedId) return e;
    const active = e.source === selectedId || e.target === selectedId;
    return { ...e, style: { ...e.style, opacity: active ? 1 : 0.15 }, animated: active && e.animated };
  }), [edges, selectedId]);

  const styledNodes = useMemo(() => nodes.map(n => ({
    ...n,
    selected: n.id === selectedId,
  })), [nodes, selectedId]);

  const onNodeClick: NodeMouseHandler = (_, node) => setSelectedId(node.id);
  const onNodeDoubleClick: NodeMouseHandler = (_, node) => {
    const d = node.data as { file: string; line: number };
    if (d.file) onJump(d.file, d.line);
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ReactFlow
        nodes={styledNodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={() => setSelectedId(null)}
        nodeTypes={nodeTypes}
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2.5}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnScroll={false}
        panOnDrag
        selectionOnDrag={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--vscode-editorLineNumber-foreground)" />
        <Controls
          showInteractive={false}
          style={{ background: 'var(--vscode-sideBar-background)', borderRadius: 4 }}
        />
        <Panel position="top-left">
          <div style={{
            padding: '6px 12px',
            background: 'var(--vscode-badge-background)',
            color: 'var(--vscode-badge-foreground)',
            borderRadius: 4, fontSize: 13, fontWeight: 600,
          }}>
            {trace.variable}
            <span style={{ fontWeight: 400, opacity: 0.7, marginLeft: 8 }}>
              {trace.nodes.filter(n => n.type === 'definition').length} defs,{' '}
              {trace.nodes.filter(n => n.type === 'usage').length} usages
            </span>
          </div>
        </Panel>
        <Panel position="bottom-left">
          <div style={{
            display: 'flex', gap: 12, padding: '4px 10px',
            background: 'var(--vscode-sideBar-background)',
            borderRadius: 4, fontSize: 10, opacity: 0.8,
          }}>
            <LegendItem color="#2ecc71" label="Defaults" />
            <LegendItem color="#3498db" label="Inventory/Group" />
            <LegendItem color="#f1c40f" label="Play vars" />
            <LegendItem color="#e67e22" label="Role/Task vars" />
            <LegendItem color="#e74c3c" label="set_fact/register" />
            <LegendItem color="#95a5a6" label="Usage" />
            <span style={{ opacity: 0.6 }}>click: select · dbl-click: open · wheel: zoom</span>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}
