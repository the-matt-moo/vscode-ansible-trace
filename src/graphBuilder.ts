import type { ScanResult, TraceResult, GraphNode, GraphEdge, VarDefinition, VarUsage } from './types.js';
import { getPrecedence } from './precedence.js';

/**
 * Build a trace graph for a single variable: all definitions, overrides, and usages.
 * Handles dot-path children (e.g. "features.prometheus" matches parent "features").
 */
export function buildTraceGraph(scanResult: ScanResult, variableName: string): TraceResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  // Normalize: "features.prometheus" → root is "features", child path is "features.prometheus"
  const rootName = variableName.split('.')[0];
  const isChildAccess = variableName.includes('.');

  // ── Collect matching definitions ──
  const matchingDefs = scanResult.definitions.filter(d => {
    if (d.name === variableName) return true;
    if (d.name === rootName) return true;
    // Child paths
    if (d.children?.includes(variableName)) return true;
    // Dot-prefix match: searching "features.prometheus" should find def of "features"
    if (variableName.startsWith(d.name + '.')) return true;
    return false;
  });

  // Sort by precedence (low → high) for override edges
  matchingDefs.sort((a, b) => getPrecedence(a.sourceType) - getPrecedence(b.sourceType));

  for (const def of matchingDefs) {
    const nodeId = makeNodeId(def);
    if (nodeIds.has(nodeId)) continue;
    nodeIds.add(nodeId);

    let displayValue = resolveNestedValue(def, variableName);

    nodes.push({
      id: nodeId,
      type: 'definition',
      name: def.name,
      value: stringifyPreview(displayValue),
      file: def.file,
      line: def.line,
      sourceType: def.sourceType,
      precedence: getPrecedence(def.sourceType),
      scope: def.scope,
    });
  }

  // ── Override chain: provenance (low → high precedence), then the selected node ──
  const defNodes = nodes.filter(n => n.type === 'definition');
  for (let i = 1; i < defNodes.length; i++) {
    edges.push({
      id: `override-${i}`,
      source: defNodes[i - 1].id,
      target: defNodes[i].id,
      relation: 'overrides',
    });
  }

  // Selected node sits between provenance (above) and children (below).
  const winnerDef = defNodes[defNodes.length - 1];
  const selectedId = `selected:${variableName}`;
  nodes.push({
    id: selectedId,
    type: 'selected',
    name: variableName,
    file: winnerDef?.file ?? '',
    line: winnerDef?.line ?? 0,
    sourceType: 'task_usage',
    precedence: 0,
    scope: winnerDef?.scope,
  });
  if (winnerDef) {
    edges.push({
      id: 'provenance-selected',
      source: winnerDef.id,
      target: selectedId,
      relation: 'derives',
    });
  }

  // ── Detect merge relationships (set_fact with combine) ──
  for (const def of matchingDefs) {
    if (def.sourceType === 'set_fact' && def.value && typeof def.value === 'string') {
      const valStr = String(def.value);
      if (valStr.includes('combine')) {
        // Find what's being combined — extract var refs from the expression
        const refs = extractVarRefs(valStr);
        for (const ref of refs) {
          const sourceDef = matchingDefs.find(d => d.name === ref && d !== def);
          if (sourceDef) {
            const sourceId = makeNodeId(sourceDef);
            const targetId = makeNodeId(def);
            if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
              edges.push({
                id: `merge-${sourceId}-${targetId}`,
                source: sourceId,
                target: targetId,
                relation: 'merges',
              });
            }
          }
        }
      }
    }
  }

  // ── Collect matching usages ──
  const matchingUsages = scanResult.usages.filter(u => {
    if (u.name === variableName) return true;
    if (u.name === rootName && isChildAccess) return true;
    if (u.name.startsWith(variableName + '.')) return true;
    if (variableName.startsWith(u.name + '.')) return true;
    return false;
  });

  for (const usage of matchingUsages) {
    const nodeId = makeNodeId(usage);
    if (nodeIds.has(nodeId)) continue;
    nodeIds.add(nodeId);

    nodes.push({
      id: nodeId,
      type: 'usage',
      name: usage.name,
      value: usage.expression,
      file: usage.file,
      line: usage.line,
      sourceType: usage.sourceType,
      precedence: 0,
    });

    // Selected → child usage
    edges.push({
      id: `uses-${nodeId}`,
      source: selectedId,
      target: nodeId,
      relation: 'uses',
    });
  }

  return { variable: variableName, nodes, edges };
}

/**
 * Build a full project graph showing all variables and their relationships.
 */
export function buildProjectGraph(scanResult: ScanResult): TraceResult {
  const allVarNames = new Set<string>();
  for (const d of scanResult.definitions) allVarNames.add(d.name);
  for (const u of scanResult.usages) allVarNames.add(u.name.split('.')[0]);

  // Build individual traces and merge
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const seenNodes = new Set<string>();

  for (const name of allVarNames) {
    const trace = buildTraceGraph(scanResult, name);
    for (const n of trace.nodes) {
      if (!seenNodes.has(n.id)) {
        seenNodes.add(n.id);
        allNodes.push(n);
      }
    }
    for (const e of trace.edges) {
      allEdges.push({ ...e, id: `${name}-${e.id}` });
    }
  }

  return { variable: '*', nodes: allNodes, edges: allEdges };
}

// ── Helpers ──

function makeNodeId(item: { file: string; line: number; name: string }): string {
  return `${item.file}:${item.line}:${item.name}`;
}

function resolveNestedValue(def: VarDefinition, targetPath: string): unknown {
  if (def.name === targetPath) return def.value;
  // Walk into nested dict: "features" def, looking for "features.prometheus"
  const remaining = targetPath.slice(def.name.length + 1);
  if (!remaining) return def.value;
  const keys = remaining.split('.');
  let current: unknown = def.value;
  for (const key of keys) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return def.value; // can't resolve, show full value
    }
  }
  return current;
}

function stringifyPreview(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v.length > 240 ? v.slice(0, 237) + '...' : v;
  if (typeof v === 'object') {
    const j = JSON.stringify(v);
    return j.length > 240 ? j.slice(0, 237) + '...' : j;
  }
  return String(v);
}

function extractVarRefs(expr: string): string[] {
  const refs: string[] = [];
  const re = /\b([a-zA-Z_]\w*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) {
    const name = m[1];
    if (!['combine', 'd', 'default', 'true', 'false', 'none', 'omit'].includes(name)) {
      refs.push(name);
    }
  }
  return [...new Set(refs)];
}
