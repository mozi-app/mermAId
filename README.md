# Mermaid Editor

A lightweight, local Mermaid diagram editor. It runs a small Go server on localhost that serves a split-pane UI with a CodeMirror text editor on the left and a live-rendered Mermaid diagram preview on the right.

## Features

- Live preview with debounced rendering as you type
- Vim keybindings (via codemirror-vim)
- Mermaid syntax highlighting and linting
- Pan and zoom on the diagram preview
- Export diagrams as SVG or high-resolution PNG
- Collapsible editor pane
- Single-instance enforcement — re-running the binary focuses the existing session
- Builds as a native macOS `.app` bundle with a menu-bar icon (tray app)

## Requirements

- Go 1.25+
- Node.js / npm

## Build

```sh
# Install JS dependencies and build everything (frontend bundle + Go binary)
make build
```

The resulting binary is `./mermaid-editor`. Static assets are embedded into the binary at compile time, so the single file is all you need.

## Run

```sh
# Run the built binary
./mermaid-editor

# Or run directly with Go during development (with live JS rebuilds)
make dev
```

The editor opens automatically in your default browser.

## macOS App Bundle

```sh
make macapp
```

Creates `Mermaid Editor.app`, a self-contained macOS application that lives in the menu bar.

## Other Make Targets

| Target       | Description                    |
|--------------|--------------------------------|
| `make help`  | Show all available targets     |
| `make stop`  | Stop a running instance        |
| `make clean` | Remove build artifacts         |
