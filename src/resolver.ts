import type { ScanResult, PrecedenceResult, PrecedenceEntry, VarDefinition } from './types.js';
import { getPrecedence, getPrecedenceLabel } from './precedence.js';

/**
 * Resolve a variable's effective value by simulating Ansible's precedence.
 * Given a selected inventory file, shows every definition site ranked by precedence
 * and marks the winner.
 */
export function resolveVariable(
  scanResult: ScanResult,
  variableName: string,
  inventoryFile?: string,
): PrecedenceResult {
  const rootName = variableName.split('.')[0];

  // Gather all definitions that could provide this variable
  let defs = scanResult.definitions.filter(d => {
    if (d.name === variableName) return true;
    if (d.name === rootName) return true;
    if (d.children?.includes(variableName)) return true;
    return false;
  });

  // If an inventory file is selected, only include defs from that inventory
  // (other source types are always included)
  if (inventoryFile) {
    defs = defs.filter(d => {
      if (d.sourceType === 'inventory_group' || d.sourceType === 'inventory_host') {
        return d.file === inventoryFile;
      }
      return true;
    });
  }

  // Build precedence entries
  const entries: PrecedenceEntry[] = defs.map(d => ({
    sourceType: d.sourceType,
    precedence: getPrecedence(d.sourceType),
    value: resolveNestedValue(d, variableName),
    file: d.file,
    line: d.line,
    scope: d.scope,
    isWinner: false,
  }));

  // Sort by precedence ascending
  entries.sort((a, b) => a.precedence - b.precedence);

  // The highest precedence entry wins (last one wins in Ansible)
  // For same precedence, last-loaded wins — approximate by file order
  let resolvedValue: unknown = undefined;
  if (entries.length > 0) {
    // Among entries with the highest precedence, the last one wins
    const maxPrec = entries[entries.length - 1].precedence;
    const winners = entries.filter(e => e.precedence === maxPrec);
    const winner = winners[winners.length - 1];
    winner.isWinner = true;
    resolvedValue = winner.value;

    // Special case: if a set_fact uses combine(), the resolved value
    // is actually a merge of defaults + overrides. Mark it.
    if (winner.sourceType === 'set_fact') {
      const def = defs.find(d =>
        d.file === winner.file &&
        d.line === winner.line &&
        typeof d.value === 'string' &&
        String(d.value).includes('combine'),
      );
      if (def) {
        resolvedValue = '<merged via combine()>';
      }
    }
  }

  return {
    variable: variableName,
    inventory: inventoryFile ?? '(all inventories)',
    entries,
    resolvedValue,
  };
}

/**
 * List all unique variable names found in the scan.
 */
export function listAllVariables(scanResult: ScanResult): string[] {
  const names = new Set<string>();
  for (const d of scanResult.definitions) {
    names.add(d.name);
    if (d.children) {
      for (const c of d.children) names.add(c);
    }
  }
  // Sort alphabetically
  return [...names].sort();
}

// ── Helpers ──

function resolveNestedValue(def: VarDefinition, targetPath: string): unknown {
  if (def.name === targetPath) return def.value;
  const remaining = targetPath.slice(def.name.length + 1);
  if (!remaining) return def.value;
  const keys = remaining.split('.');
  let current: unknown = def.value;
  for (const key of keys) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}
