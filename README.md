# Mermaid Editor

A lightweight, local Mermaid diagram editor. It runs a small Go server on localhost that serves a split-pane UI with a CodeMirror text editor on the left and a live-rendered Mermaid diagram preview on the right.

## Features

- Live preview with debounced rendering as you type
- Vim keybindings (via codemirror-vim)
- Mermaid syntax highlighting and linting
- Pan and zoom on the diagram preview
- Export diagrams as SVG or high-resolution PNG
- Collapsible editor pane
- CLI tool for AI agent integration (Claude Code, etc.)
- Single-instance enforcement — re-running the binary focuses the existing session
- Builds as a native macOS `.app` bundle with a menu-bar icon (tray app)

## Installation

### Requirements

- Go 1.25+
- Node.js / npm

### Build from source

```sh
git clone https://github.com/kmatthias/mermaid-editor.git
cd mermaid-editor
make build
```

This installs JS dependencies, bundles the frontend, and compiles the Go binary. The resulting binary is `./mermaid-editor` — static assets are embedded at compile time, so the single file is all you need.

### Install to PATH

```sh
# Copy the binary somewhere on your PATH
cp mermaid-editor /usr/local/bin/

# Or use go install (requires GOBIN on PATH)
go install .
```

## Usage

```sh
# Run the editor (opens in your default browser)
./mermaid-editor

# Run in development mode with live JS rebuilds
make dev
```

The editor opens automatically in your default browser. If an instance is already running, it focuses the existing window instead of starting a new one.

## macOS App Bundle

```sh
make macapp
```

Creates `Mermaid Editor.app`, a self-contained macOS application that lives in the menu bar.

## CLI Tool (Claude Code Integration)

The editor ships with `bin/mermaid-cli`, a Ruby script that lets Claude Code (or any agent) read and write diagrams in a running editor instance. No MCP configuration required — just start the editor and use the CLI.

### Setup

1. Start the editor normally:

   ```sh
   ./mermaid-editor
   ```

2. Add the CLI to your `CLAUDE.md` (project or global) so Claude knows how to use it:

   ```markdown
   ## Mermaid Diagrams

   A mermaid editor is running locally. Use `bin/mermaid-cli` to interact with it:

   - `bin/mermaid-cli get` — print the current diagram to stdout
   - `bin/mermaid-cli set --text "graph TD; A-->B"` — set the diagram from a string
   - `bin/mermaid-cli set diagram.mmd` — set the diagram from a file
   - `bin/mermaid-cli status` — check if the editor is running
   ```

### How it works

The CLI discovers the running editor automatically via its state files and talks to it over its localhost HTTP API. Changes made via `set` appear instantly in the browser preview.

### Commands

| Command | Description |
|---------|-------------|
| `mermaid-cli get` | Print the current diagram text to stdout |
| `mermaid-cli set <file>` | Replace the diagram from a file (`-` for stdin) |
| `mermaid-cli set --text "…"` | Replace the diagram from a string |
| `mermaid-cli status` | Check if the editor is running |
| `mermaid-cli help` | Show usage information |

## Other Make Targets

| Target       | Description                    |
|--------------|--------------------------------|
| `make help`  | Show all available targets     |
| `make test`  | Run the test suite             |
| `make stop`  | Stop a running instance        |
| `make clean` | Remove build artifacts         |
