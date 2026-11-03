# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 02-11-2026

### Added
- **Flow tab:** maps playbook -> role -> task file relationships from `roles:`, `import_*`/`include_*`, and meta `dependencies:`. Dynamic references that cannot be resolved are shown as red dashed nodes.
- Command **Show Playbook/Role Flow**.
- Collection-qualified names (`opennebula.deploy.*`) and `{{ role_path }}` resolve to the workspace's own files.
- Selected-variable node in the trace graph, placed between provenance (above) and children (below).
- Clickable file links on trace nodes.
- Trace nodes wrap long values instead of truncating them.

### Changed
- Trace graph arrows are captioned only for `combine()` merges. Direction and kind are shown by arrow and style.
- The Precedence tab uses the most recently traced variable. Opening the command no longer asks for a variable or inventory first.

### Fixed
- Webview now loads React Flow's stylesheet. Previously the canvas was too small and clicks and wheel zoom did not work.
- Graph refits after layout, so it no longer opens zoomed out.
- Clicking a file path on a trace node opens the file again.
- Opening a path that cannot be opened shows a warning instead of failing silently.

## [0.1.0] - 02-11-2026

### Added
- Initial release: scanner for inventory, group/host vars, role defaults/vars, playbooks, tasks, and Jinja2 templates.
- Interactive variable trace graph with click selection, double-click to open, mouse-wheel zoom, and pan.
- Precedence simulator tab: ranks each definition of a variable by Ansible precedence and marks the winner.
- F5 launch configuration that opens a target project (`.vscode/launch.json`).
