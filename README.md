# Ansible Variable Trace

A VS Code extension that traces an Ansible variable across inventory, roles, playbooks, tasks, and Jinja2 templates, and shows the result as an interactive graph.

Existing Ansible visualizers graph role and task relationships. This one follows variables: where a value is defined, how Ansible's precedence ranks the definitions, and where it is used.

**Status: alpha.** The scanner is verified against [`opennebula/one-deploy`](https://github.com/OpenNebula/one-deploy). The VS Code UI is still being tested.

## Features

### Trace graph
Right-click a variable in a YAML or Jinja2 file, then choose **Trace Ansible Variable** (`Ctrl+Shift+T`). The graph runs top to bottom:

1. **Provenance:** definitions in precedence order (low to high), each badged with its source and level (e.g. `P19`).
2. **Selected:** the traced variable, outlined in the focus color.
3. **Children:** every usage (tasks, `when:` conditions, templates, playbook expressions).

Interaction:
- Click a box to highlight its connected edges.
- Double-click a box to open its file at the line.
- Click a file path (underlined) to open it.
- Click a variable name to trace that variable instead.
- Mouse wheel or pinch to zoom; drag empty space to pan.
- Boxes wrap long values instead of truncating them.

`combine()` merges (e.g. `set_fact` built from defaults plus inventory) are the only edges with a caption.

### Precedence tab
Shows how Ansible ranks every definition of the traced variable:
- Resolved value at the top.
- A waterfall of definitions, low to high precedence, with source, scope, value, and file:line.
- The winner is marked **WINS**. Click any row to open its file.
- Choose an inventory in the dropdown. "(all inventories)" is the default.

Opening the tab uses the variable you last traced.

### Commands

| Command | Keybinding | Purpose |
|---|---|---|
| Trace Ansible Variable | `Ctrl+Shift+T` (`Cmd+Shift+T` on macOS) | Trace the variable at the cursor, or pick one from a list |
| Show Variable Graph | none | Pick a variable and open the trace graph |
| Show Precedence Simulator | none | Open the precedence tab for the last traced variable |
| Refresh Variable Index | none | Rescan the workspace |

## What it scans

| Source | Precedence |
|---|---|
| `roles/*/defaults/**` | 1 (lowest) |
| Inventory group vars | 3 |
| `group_vars/**` | 5 |
| Inventory host vars | 7 |
| `host_vars/**` | 9 |
| Playbook `vars:` | 12 |
| `roles/*/vars/**` | 15 |
| Block and task `vars:` | 16-17 |
| `include_vars` | 18 |
| `set_fact` / `register` | 19 |
| Role include parameters | 20 |

Usages come from `{{ }}` expressions and `when:`/`failed_when:`/`changed_when:`/`until:` conditions in YAML, and from all `*.j2` templates. Ansible built-in magic variables (`inventory_hostname`, `groups`, etc.) are ignored.

## Install and run from source

Requirements: Node.js 18+ and VS Code 1.85+.

```bash
git clone https://github.com/the-matt-moo/vscode-ansible-trace.git
cd vscode-ansible-trace
npm install
npm run build
```

Then open the folder in VS Code and press **F5**. Select **Run Extension (open one-deploy)** in Run and Debug. The build runs first, and the Extension Development Host opens `M:/Github/one-deploy`. Change the path in `.vscode/launch.json` to use another project.

To package a `.vsix`:

```bash
npx @vscode/vsce package
```

## How it works

1. **Scanner** (`src/scanner.ts`): walks the workspace, classifies files by Ansible layout, and extracts definitions and usages.
2. **Graph builder** (`src/graphBuilder.ts`): builds the provenance, selected, and children graph for one variable. Dotted names such as `features.prometheus` match their root and children.
3. **Resolver** (`src/resolver.ts`): ranks definitions by precedence for the Precedence tab.
4. **Webview** (`webview-ui/`): React Flow for the canvas, ELK.js for layout.

## Limitations

- Static analysis only. It does not evaluate Jinja2, runtime `-e` extra vars, dynamic inventory, or plugin-supplied variables.
- `set_fact` and `combine()` results are shown as expressions, not computed values.
- `include_vars` with a dynamic path is shown as `<include_vars>` with no value.
- Ties in precedence are broken by scan order, not Ansible's real load order.
- `group_vars/` and `host_vars/` are not yet matched to the groups and hosts in the chosen inventory, so "(all inventories)" can mix values Ansible would never load together.
- Vault-encrypted files are skipped.

## Development

```bash
npm run build      # esbuild: extension + webview
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p webview-ui/tsconfig.json
```

Layout:

```
src/             extension host: scanner, graph builder, resolver, panel
webview-ui/      React app: App, TraceGraph, VariableNode, PrecedencePanel
.vscode/         F5 launch config and build task
esbuild.js       dual bundle (extension + webview)
```

## License

MIT
