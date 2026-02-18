# MermAId Editor

Go backend + JS frontend Mermaid diagram editor with live preview.

## Testing

### Go tests
- Framework: **goconvey** (`github.com/smartystreets/goconvey`)
- Run: `go test -v -race -count=1 -timeout 30s ./...`
- Always run with `-race`
- Files: `diagram_test.go`, `main_test.go`, `mcp_test.go`
- Use `stateDirOverride` (in `main.go`) to redirect state files to `t.TempDir()` in tests that touch the filesystem

### JS tests
- Framework: **vitest**
- Run: `npm test`
- Test file: `frontend/parser.test.js`

### Test rules
- Never use `time.Sleep` in tests — use channel + `select` + timeout for async assertions
- The `frontend/parser.js` is intentionally separated from `editor.js` so it can be tested without pulling in mermaid/CodeMirror dependencies

## Build
- `make build` — full build (npm install + esbuild bundle + go build)
- `make dev` — development mode with watch
- `make test` — run Go tests only
- `npm test` — run JS tests only
