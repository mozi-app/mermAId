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
import panzoom from 'panzoom';
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

// State
let panzoomInstance = null;
let debounceTimer = null;
let renderCounter = 0;

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

        // Save current transform before replacing
        let savedTransform = null;
        if (panzoomInstance) {
            savedTransform = panzoomInstance.getTransform();
            panzoomInstance.dispose();
            panzoomInstance = null;
        }

        previewEl.innerHTML = svg;

        // Initialize panzoom on the new SVG
        const svgEl = previewEl.querySelector('svg');
        if (svgEl) {
            panzoomInstance = panzoom(svgEl, {
                maxZoom: 10,
                minZoom: 0.1,
                smoothScroll: false,
            });

            // Restore transform if we had one
            if (savedTransform) {
                panzoomInstance.moveTo(savedTransform.x, savedTransform.y);
                panzoomInstance.zoomAbs(savedTransform.x, savedTransform.y, savedTransform.scale);
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
    if (panzoomInstance) {
        panzoomInstance.moveTo(0, 0);
        panzoomInstance.zoomAbs(0, 0, 1);
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

function downloadFile(filename, url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

downloadSvgBtn.addEventListener('click', () => {
    const svgEl = previewEl.querySelector('svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    downloadFile('diagram.svg', URL.createObjectURL(blob));
    downloadMenu.classList.remove('open');
});

downloadPngBtn.addEventListener('click', () => {
    const svgEl = previewEl.querySelector('svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
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
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
            downloadFile('diagram.png', URL.createObjectURL(blob));
        }, 'image/png');
    };
    img.src = url;
    downloadMenu.classList.remove('open');
});

// Initial render
renderDiagram(STARTER_DIAGRAM);
