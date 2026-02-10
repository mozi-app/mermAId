# Mermaid Sequence Diagram Editor — Implementation Plan

## Context

Building a self-contained local tool for editing and live-previewing Mermaid sequence diagrams. The Go binary embeds all frontend assets, auto-picks a port, and opens the browser. The editor provides syntax highlighting, validation, and a collapsible layout with pan/zoom on the rendered diagram.

## Project Structure

```
/Users/kmatthias/dev/mermaid/
├── main.go                  # Go server: embed, auto-port, auto-open browser
├── go.mod                   # Go module (stdlib only)
├── Makefile                 # Build orchestration
├── package.json             # npm deps (codemirror, mermaid, panzoom, esbuild)
├── .gitignore
├── frontend/
│   ├── app.js               # Main entry: wires editor, preview, collapse, panzoom
│   ├── editor.js            # CodeMirror 6 setup + Mermaid language mode + linter
│   └── style.css            # Split-pane layout, collapse animation, styling
├── static/
│   ├── index.html           # Single HTML page (checked in)
│   ├── bundle.js            # esbuild output (gitignored, built artifact)
│   └── style.css            # Copied from frontend/ during build (gitignored)
└── agent/plans/
```

## Libraries

| Component | Library | Role |
|-----------|---------|------|
| Editor | CodeMirror 6 | Code editing with extensions |
| Language | `@codemirror/language` (`StreamLanguage`) | Mermaid syntax highlighting |
| Linting | `@codemirror/lint` + `mermaid.parse()` | Inline error diagnostics |
| Rendering | Mermaid.js v11 | SVG diagram generation |
| Pan/Zoom | panzoom | Mouse drag + scroll zoom on SVG |
| Bundler | esbuild (dev dep) | Bundle to single IIFE JS file |
| Server | Go stdlib (`net/http`, `embed`, `net`) | Serve embedded static files |

## Implementation Steps

### Phase 1: Project Scaffolding
1. Create directory structure (`frontend/`, `static/`, `agent/plans/`)
2. `go mod init` — no external Go deps
3. `npm init -y` and install deps:
   - `npm install codemirror @codemirror/language @codemirror/lint mermaid panzoom`
   - `npm install -D esbuild`
4. Create `Makefile` with targets: `build`, `dev`, `clean`
5. Create `.gitignore` (node_modules, static/bundle.js, static/bundle.js.map, static/style.css, mermaid-editor binary)

### Phase 2: Minimal Editor + Preview
6. Write `static/index.html` — split-pane layout with `#editor-pane`, `#preview-pane`, collapse button, floating restore icon
7. Write `frontend/style.css` — flexbox split-pane (40/60), collapse transitions, floating icon, full-height editor
8. Write `frontend/app.js` — basic CodeMirror with `basicSetup`, mermaid.render() on doc change with 300ms debounce, starter diagram
9. Test: `npx esbuild frontend/app.js --bundle --format=iife --outfile=static/bundle.js` and open HTML in browser

### Phase 3: Go Server
10. Write `main.go`:
    - `//go:embed static` to embed all assets
    - `net.Listen("tcp", "127.0.0.1:0")` for auto-port
    - `http.Serve(listener, nil)` to serve on that listener
    - `openBrowser(url)` in a goroutine (uses `open` on macOS, `xdg-open` on Linux, `rundll32` on Windows)
11. Test: `make build && ./mermaid-editor` — browser opens, editor + preview work

### Phase 4: Mermaid Language Support
12. Write `frontend/editor.js` — `StreamLanguage.define()` tokenizer recognizing:
    - Keywords: `sequenceDiagram`, `participant`, `actor`, `activate`, `deactivate`, `Note`, `loop`, `alt`, `else`, `opt`, `par`, `and`, `critical`, `break`, `rect`, `end`, `autonumber`
    - Arrows: `->>`, `-->>`, `->`, `-->`, `-x`, `--x`, `-)`, `--)`
    - Comments: `%%`
    - Strings: text after `:` on message lines
13. Wire language mode into editor extensions in `app.js`
14. Test: syntax highlighting works for keywords, arrows, comments

### Phase 5: Linting / Validation
15. Add mermaid linter in `editor.js` — calls `mermaid.parse()`, maps errors to CodeMirror `Diagnostic` objects
16. Wire linter into editor extensions
17. Test: invalid syntax shows red underlines and error messages

### Phase 6: Pan & Zoom
18. Add panzoom in `app.js` — initialize on SVG after each render, destroy previous instance
19. Save/restore transform across re-renders to preserve user's viewport
20. Add "Reset Zoom" button handler
21. Test: scroll zoom, drag pan, reset button

### Phase 7: Collapsible Editor
22. Add collapse/expand logic in `app.js` — toggle CSS class on container, show/hide floating icon
23. CSS transitions: `width 0.3s ease` on editor pane; `.collapsed #editor-pane { width: 0; overflow: hidden }`
24. On `transitionend`, call `editor.requestMeasure()` so CodeMirror recalculates layout
25. Test: collapse shrinks editor to icon, diagram fills viewport with panzoom; click icon restores

### Phase 8: Polish
26. Tune debounce timing, handle edge cases (empty editor, rapid typing)
27. Final CSS polish (colors, spacing, fonts)
28. Final build: `make clean && make build` — single self-contained binary

## Key Architecture Decisions

- **StreamLanguage over Lezer grammar**: Full Lezer grammar for Mermaid would be excessive effort. StreamLanguage tokenizer is simple and sufficient for syntax highlighting.
- **Mermaid's own parser for linting**: Uses `mermaid.parse()` directly — guarantees parity between lint results and render success.
- **IIFE bundle format**: esbuild `--format=iife` produces a single script that runs on load. No module system needed at runtime.
- **No framework**: Vanilla JS. App state is trivial (editor content + collapsed boolean). CodeMirror and mermaid manage their own state.
- **Panzoom lifecycle**: Each render replaces the SVG DOM entirely, so panzoom must be destroyed and recreated. Transform is saved/restored to preserve viewport.
- **`http.Serve(listener)`**: Creating the listener first with port 0 lets us know the port before the server blocks, enabling URL printing and browser auto-open.

## Build Commands

```bash
# Development (watch mode)
make dev

# Production build (single binary)
make build

# Run the binary
./mermaid-editor
```

## Verification

1. `make build` succeeds and produces a single `mermaid-editor` binary
2. Running `./mermaid-editor` prints a URL and opens the browser
3. Editor shows syntax-highlighted starter diagram with live preview
4. Typing invalid syntax shows inline error markers
5. Mouse wheel zooms, drag pans, "Reset Zoom" button works
6. Collapse button shrinks editor to floating icon, diagram fills viewport
7. Clicking floating icon restores the editor
8. Binary works standalone — no other files needed alongside it
