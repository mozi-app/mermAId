import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLineGutter,
    highlightSpecialChars,
    drawSelection,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
    highlightActiveLine,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import {
    foldGutter,
    indentOnInput,
    syntaxHighlighting,
    defaultHighlightStyle,
    bracketMatching,
    foldKeymap,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import { vim } from '@replit/codemirror-vim';
import mermaid from 'mermaid';
import { mermaidLanguage, mermaidLinter } from './editor.js';

// Initialize mermaid
mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    sequence: { showSequenceNumbers: false },
});

const STARTER_DIAGRAM = `sequenceDiagram
    participant Alice
    participant Bob
    participant Charlie

    Alice->>Bob: Hello Bob, how are you?
    Bob-->>Alice: I'm good thanks!
    Alice->>Bob: Great to hear!
    Bob->>Charlie: Hey Charlie!
    Charlie-->>Bob: Hi Bob!

    loop Health Check
        Bob->>Charlie: Are you still there?
        Charlie-->>Bob: Yes!
    end

    Note over Alice,Bob: A typical conversation
    Alice->>Charlie: Nice to meet you!
    Charlie-->>Alice: Likewise!
`;

// SVG viewBox-based pan/zoom (vector-clean, no rasterization)
function createSvgPanZoom(svgEl) {
    const vb = svgEl.viewBox.baseVal;
    const orig = { x: vb.x, y: vb.y, width: vb.width, height: vb.height };

    // Make SVG fill its container; viewBox controls what's visible
    svgEl.setAttribute('width', '100%');
    svgEl.setAttribute('height', '100%');
    svgEl.style.cursor = 'grab';

    let isPanning = false;
    let start = { x: 0, y: 0 };
    let startVB = { x: 0, y: 0 };

    const onWheel = (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
        const rect = svgEl.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width;
        const my = (e.clientY - rect.top) / rect.height;
        const newW = vb.width * factor;
        const newH = vb.height * factor;
        vb.x += (vb.width - newW) * mx;
        vb.y += (vb.height - newH) * my;
        vb.width = newW;
        vb.height = newH;
    };

    const onMouseDown = (e) => {
        if (e.button !== 0) return;
        isPanning = true;
        start = { x: e.clientX, y: e.clientY };
        startVB = { x: vb.x, y: vb.y };
        svgEl.style.cursor = 'grabbing';
        e.preventDefault();
    };

    const onMouseMove = (e) => {
        if (!isPanning) return;
        const rect = svgEl.getBoundingClientRect();
        vb.x = startVB.x - (e.clientX - start.x) * (vb.width / rect.width);
        vb.y = startVB.y - (e.clientY - start.y) * (vb.height / rect.height);
    };

    const onMouseUp = () => {
        if (!isPanning) return;
        isPanning = false;
        svgEl.style.cursor = 'grab';
    };

    svgEl.addEventListener('wheel', onWheel, { passive: false });
    svgEl.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return {
        getTransform() {
            return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
        },
        setTransform(t) {
            vb.x = t.x;
            vb.y = t.y;
            vb.width = t.width;
            vb.height = t.height;
        },
        resetZoom() {
            vb.x = orig.x;
            vb.y = orig.y;
            vb.width = orig.width;
            vb.height = orig.height;
        },
        dispose() {
            svgEl.removeEventListener('wheel', onWheel);
            svgEl.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        },
    };
}

// State
let panZoomInstance = null;
let debounceTimer = null;
let syncTimer = null;
let renderCounter = 0;
let isExternalUpdate = false;

// DOM elements
const container = document.getElementById('container');
const editorEl = document.getElementById('editor');
const previewEl = document.getElementById('preview');
const collapseBtn = document.getElementById('collapse-btn');
const floatingIcon = document.getElementById('floating-icon');
const resetZoomBtn = document.getElementById('reset-zoom-btn');

// Light theme for CodeMirror
const lightTheme = EditorView.theme({
    '&': { backgroundColor: '#fffdf7' },
    '.cm-content': { color: '#2d3436', caretColor: '#e17055' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#e17055' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: 'rgba(116, 185, 255, 0.25)',
    },
    '.cm-gutters': {
        backgroundColor: '#fff4e0',
        color: '#e17055',
        borderRight: '1px solid #f0d9a0',
    },
    '.cm-activeLineGutter': { backgroundColor: '#ffeaa7' },
    '.cm-activeLine': { backgroundColor: 'rgba(253, 203, 110, 0.15)' },
});

// Create CodeMirror editor
const editor = new EditorView({
    state: EditorState.create({
        doc: STARTER_DIAGRAM,
        extensions: [
            vim(),
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightSpecialChars(),
            history(),
            foldGutter(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            indentOnInput(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            bracketMatching(),
            rectangularSelection(),
            crosshairCursor(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            keymap.of([
                ...defaultKeymap,
                ...searchKeymap,
                ...historyKeymap,
                ...foldKeymap,
                ...lintKeymap,
            ]),
            lightTheme,
            mermaidLanguage(),
            mermaidLinter(),
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    scheduleRender();
                    if (!isExternalUpdate) {
                        scheduleSyncToServer();
                    }
                }
            }),
        ],
    }),
    parent: editorEl,
});

// Rendering
function scheduleRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        renderDiagram(editor.state.doc.toString());
    }, 300);
}

async function renderDiagram(code) {
    if (!code.trim()) {
        previewEl.innerHTML = '<p style="color:#999;font-style:italic;">Type a diagram to see the preview</p>';
        return;
    }

    renderCounter++;
    const thisRender = renderCounter;

    try {
        // Use a unique ID for each render to avoid conflicts
        const id = `mermaid-svg-${thisRender}`;
        const { svg } = await mermaid.render(id, code);

        // Discard if a newer render has started
        if (thisRender !== renderCounter) return;

        // Save current viewBox before replacing
        let savedTransform = null;
        if (panZoomInstance) {
            savedTransform = panZoomInstance.getTransform();
            panZoomInstance.dispose();
            panZoomInstance = null;
        }

        previewEl.innerHTML = svg;

        // Initialize viewBox-based pan/zoom on the new SVG
        const svgEl = previewEl.querySelector('svg');
        if (svgEl) {
            panZoomInstance = createSvgPanZoom(svgEl);

            // Restore viewBox if we had one
            if (savedTransform) {
                panZoomInstance.setTransform(savedTransform);
            }
        }
    } catch (e) {
        // Errors are shown via the linter — keep last valid diagram
    }
}

// Collapse / Expand
collapseBtn.addEventListener('click', () => {
    container.classList.add('collapsed');
    floatingIcon.classList.remove('hidden');
});

floatingIcon.addEventListener('click', () => {
    container.classList.remove('collapsed');
    floatingIcon.classList.add('hidden');
});

// After transition ends, tell CodeMirror to recalculate
const editorPane = document.getElementById('editor-pane');
editorPane.addEventListener('transitionend', () => {
    editor.requestMeasure();
});

// Divider drag-to-resize
const divider = document.getElementById('divider');
let isDragging = false;

divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    divider.classList.add('dragging');
    editorPane.style.transition = 'none';
    divider.style.transition = 'none';
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const minWidth = 150;
    const maxWidth = window.innerWidth - 150;
    const width = Math.min(maxWidth, Math.max(minWidth, e.clientX));
    editorPane.style.width = width + 'px';
});

document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    divider.classList.remove('dragging');
    editorPane.style.transition = '';
    divider.style.transition = '';
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    editor.requestMeasure();
});

// Reset Zoom
resetZoomBtn.addEventListener('click', () => {
    if (panZoomInstance) {
        panZoomInstance.resetZoom();
    }
});

// Download menu
const downloadBtn = document.getElementById('download-btn');
const downloadMenu = document.getElementById('download-menu');
const downloadSvgBtn = document.getElementById('download-svg');
const downloadPngBtn = document.getElementById('download-png');

downloadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadMenu.classList.toggle('open');
});

document.addEventListener('click', () => {
    downloadMenu.classList.remove('open');
});

downloadMenu.addEventListener('click', (e) => {
    e.stopPropagation();
});

function downloadViaServer(filename, contentType, data, encoding) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/download';
    form.style.display = 'none';

    const fields = { filename, content_type: contentType, data, encoding: encoding || '' };
    for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
}

downloadSvgBtn.addEventListener('click', () => {
    const svgEl = previewEl.querySelector('svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    downloadViaServer('diagram.svg', 'image/svg+xml', svgData);
    downloadMenu.classList.remove('open');
});

downloadPngBtn.addEventListener('click', () => {
    const svgEl = previewEl.querySelector('svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgDataURI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = 8; // 8x for high-res output
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, img.width, img.height);
        ctx.drawImage(img, 0, 0);
        const pngDataUrl = canvas.toDataURL('image/png');
        const base64 = pngDataUrl.split(',')[1];
        downloadViaServer('diagram.png', 'image/png', base64, 'base64');
    };
    img.src = svgDataURI;
    downloadMenu.classList.remove('open');
});

// ── Server sync ─────────────────────────────────────────────────────────────

function scheduleSyncToServer() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        const content = editor.state.doc.toString();
        fetch('/api/diagram', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, source: 'browser' }),
        }).catch(() => {
            // Server unavailable — ignore
        });
    }, 300);
}

// Connect to SSE for live updates from external sources (e.g. MCP)
function connectSSE() {
    const evtSource = new EventSource('/api/events');

    evtSource.onmessage = (e) => {
        try {
            const event = JSON.parse(e.data);
            if (event.source === 'browser') return; // Ignore our own changes

            const currentContent = editor.state.doc.toString();
            if (event.content === currentContent) return; // Already in sync

            isExternalUpdate = true;
            editor.dispatch({
                changes: { from: 0, to: editor.state.doc.length, insert: event.content },
            });
            isExternalUpdate = false;
        } catch {
            // Ignore malformed events
        }
    };

    evtSource.onerror = () => {
        // EventSource auto-reconnects
    };
}

connectSSE();

// Initial render and sync to server
renderDiagram(STARTER_DIAGRAM);
scheduleSyncToServer();
