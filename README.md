# MermAId Editor

A local Mermaid diagram editor designed for AI-assisted workflows. An AI coding agent (Claude Code, etc.) generates or updates diagrams via MCP or CLI, and you see the results rendered live in your browser. You can also edit diagrams directly — it's a full editor with syntax highlighting, linting, and vim keybindings.

The editor runs as a small Go server on localhost with a split-pane UI: a CodeMirror text editor on the left and a live Mermaid preview on the right.

## Features

- AI agent integration via MCP server or CLI tool — agents can get and set diagrams programmatically
- Live preview with debounced rendering as you type
- Vim keybindings (via codemirror-vim)
- Mermaid syntax highlighting and linting
- Pan and zoom on the diagram preview
- Export diagrams as SVG or high-resolution PNG
- Collapsible editor pane
- Single-instance enforcement — re-running the binary focuses the existing session
- Cross-platform: runs on macOS, Linux, and Windows
- Builds as a native macOS `.app` bundle with a menu-bar icon (tray app)

## Installation

### Requirements

- Go 1.25+
- Node.js / npm
- **macOS only:** Xcode Command Line Tools (for CGO — the native app window uses Cocoa/WebKit)

### Build from source (macOS / Linux)

```sh
git clone https://github.com/kmatthias/mermaid-editor.git
cd mermaid-editor
make build
```

This installs JS dependencies, bundles the frontend, and compiles the Go binary. The resulting binary is `./mermaid-editor` — static assets are embedded at compile time, so the single file is all you need.

On **macOS**, the build uses CGO to link against Cocoa and WebKit for the native app window. On **Linux**, no CGO or system libraries are required.

### Build from source (Windows)

Windows requires Go and Node.js installed. If you have GNU Make (e.g. via [Chocolatey](https://chocolatey.org/), MSYS2, or Git Bash):

```sh
make build
```

Without Make, run the steps manually in PowerShell:

```powershell
npm install
npx esbuild frontend/app.js --bundle --format=iife --minify --sourcemap --outfile=static/bundle.js
copy frontend\style.css static\style.css
go build -o mermaid-editor.exe .
```

### Install to PATH

```sh
# macOS / Linux: copy the binary somewhere on your PATH
cp mermaid-editor /usr/local/bin/

# Or use go install on any platform (requires GOBIN on PATH)
go install .
```

On Windows, copy `mermaid-editor.exe` to a directory on your `%PATH%`, or use `go install .`.

## Usage

```sh
# Run the editor (opens in your default browser)
./mermaid-editor

# Run in development mode with live JS rebuilds
make dev
```

The editor opens automatically in your default browser. If an instance is already running, it focuses the existing window instead of starting a new one.

### Platform notes

| | macOS | Linux | Windows |
|---|---|---|---|
| **Browser** | Opens via `open` | Opens via `xdg-open` | Opens via `rundll32` |
| **Native window** | Yes (Cocoa/WebKit app) | No — browser only | No — browser only |
| **App bundle** | `make macapp` | N/A | N/A |
| **CGO required** | Yes (for native window) | No | No |

### macOS App Bundle

```sh
make macapp
```

Creates `MermAId Editor.app`, a self-contained macOS application that lives in the menu bar. This target is macOS-only.

## AI Agent Integration (Claude Code, etc.)

There are two ways to connect an AI agent to the editor. Pick whichever fits your workflow — both provide the same get/set diagram capabilities.

| | MCP Server | CLI Tool |
|---|---|---|
| **How it works** | Editor runs as an MCP server over stdio; the agent talks to it natively | A Ruby script calls the editor's HTTP API |
| **Agent discovers tools** | Automatically (via MCP protocol) | Via instructions you add to `CLAUDE.md` |
| **Requirements** | Just the binary | Ruby, plus a running editor instance |
| **Best for** | Dedicated agent sessions | When you're already using the editor interactively |

---

### Option A: MCP Server

The editor can run as an [MCP](https://modelcontextprotocol.io/) server. In this mode it starts the HTTP server for the browser UI **and** exposes `get_diagram` / `set_diagram` tools over stdio. The agent discovers the tools automatically — no `CLAUDE.md` instructions needed.

#### Setup

Add the server to your Claude Code MCP config (`~/.claude/settings.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "mermaid-editor": {
      "command": "/path/to/mermaid-editor",
      "args": ["--mcp"]
    }
  }
}
```

That's it. Claude Code will start the editor when it needs it, and the MCP tools will be available automatically.

#### Tools

| Tool | Description |
|------|-------------|
| `get_diagram` | Returns the current diagram text and version |
| `set_diagram` | Replaces the entire diagram (appears live in the browser) |

---

### Option B: CLI Tool

The editor ships with `bin/mermaid-cli`, a Ruby script that talks to a running editor instance over its HTTP API. You start the editor yourself and tell the agent about the CLI via `CLAUDE.md`.

#### Setup

1. Start the editor normally:

   ```sh
   ./mermaid-editor
   ```

2. Add the CLI to your `CLAUDE.md` (project or global) so the agent knows how to use it:

   ```markdown
   ## Mermaid Diagrams

   A mermaid editor is running locally. Use `bin/mermaid-cli` to interact with it:

   - `bin/mermaid-cli get` — print the current diagram to stdout
   - `bin/mermaid-cli set --text "graph TD; A-->B"` — set the diagram from a string
   - `bin/mermaid-cli set diagram.mmd` — set the diagram from a file
   - `bin/mermaid-cli status` — check if the editor is running
   ```

#### How it works

The CLI discovers the running editor automatically via its state files and talks to it over its localhost HTTP API. Changes made via `set` appear instantly in the browser preview.

#### Commands

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
