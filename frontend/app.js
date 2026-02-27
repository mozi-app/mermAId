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
import { EditorState, Compartment } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import {
    foldGutter,
    HighlightStyle,
    indentOnInput,
    syntaxHighlighting,
    defaultHighlightStyle,
    bracketMatching,
    foldKeymap,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { indentWithTab } from '@codemirror/commands';
import mermaid from 'mermaid';
import { mermaidLanguage, mermaidLinter } from './editor.js';
import { prettyPrintMermaidForEditor } from './format.js';
import { installYankClipboardSync, pasteFromSystemClipboard } from './vim-clipboard.js';

// Register :q to quit the app
Vim.defineEx('quit', 'q', () => {
    fetch('/api/quit', { method: 'POST' });
});

installYankClipboardSync(Vim);

// Vim mode preference
const vimCompartment = new Compartment();
const vimKeyCompartment = new Compartment();
const editorThemeCompartment = new Compartment();
const syntaxCompartment = new Compartment();

function vimExtensions() {
    return [vim()];
}

function vimTabKeymap() {
    return keymap.of([{
        key: 'Tab',
        run: (view) => {
            const cm = getCM(view);
            if (cm && cm.state.vim && cm.state.vim.insertMode) {
                view.dispatch(view.state.replaceSelection('\t'));
                return true;
            }
            return false;
        },
    }]);
}

function defaultTabKeymap() {
    return keymap.of([indentWithTab]);
}

function savePreference(key, value) {
    fetch('/api/preferences').then(r => r.json()).then(prefs => {
        prefs[key] = value;
        fetch('/api/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(prefs),
        });
    }).catch(() => {});
}

// Initialize mermaid
function initMermaid(theme) {
    mermaid.initialize({
        startOnLoad: false,
        theme,
        securityLevel: 'loose',
        sequence: { showSequenceNumbers: false },
    });
}

initMermaid('default');

const STARTER_DIAGRAM = '';

// SVG viewBox-based pan/zoom (vector-clean, no rasterization)
function createSvgPanZoom(svgEl) {
    const vb = svgEl.viewBox.baseVal;
    const orig = { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
    const wheelTarget = svgEl.parentElement || svgEl;

    // Make SVG fill its container; viewBox controls what's visible
    svgEl.setAttribute('width', '100%');
    svgEl.setAttribute('height', '100%');
    svgEl.style.cursor = 'grab';

    let isPanning = false;
    let start = { x: 0, y: 0 };
    let startVB = { x: 0, y: 0 };
    const minScale = 0.02;
    const maxScale = 50;
    const wheelDeltaLimit = 240;
    const wheelZoomDivisor = 480;
    const pendingWheelDeltaLimit = wheelDeltaLimit * 4;
    let pendingWheelDelta = 0;
    let pendingWheelAnchor = { mx: 0.5, my: 0.5 };
    let wheelFrameId = 0;

    const applyWheelZoom = (delta, mx, my) => {
        const factor = Math.pow(2, delta / wheelZoomDivisor);
        const targetW = vb.width * factor;
        const targetH = vb.height * factor;
        const minW = orig.width * minScale;
        const maxW = orig.width * maxScale;
        const minH = orig.height * minScale;
        const maxH = orig.height * maxScale;
        const newW = Math.min(maxW, Math.max(minW, targetW));
        const newH = Math.min(maxH, Math.max(minH, targetH));

        if (newW === vb.width && newH === vb.height) return;

        vb.x += (vb.width - newW) * mx;
        vb.y += (vb.height - newH) * my;
        vb.width = newW;
        vb.height = newH;
    };

    const flushPendingWheelZoom = () => {
        wheelFrameId = 0;
        if (pendingWheelDelta === 0) return;

        const delta = pendingWheelDelta;
        const { mx, my } = pendingWheelAnchor;
        pendingWheelDelta = 0;
        applyWheelZoom(delta, mx, my);

        if (pendingWheelDelta !== 0) {
            wheelFrameId = requestAnimationFrame(flushPendingWheelZoom);
        }
    };

    const onWheel = (e) => {
        e.preventDefault();
        const rect = svgEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const modeScale = e.deltaMode === 1 ? 40 : (e.deltaMode === 2 ? rect.height : 1);
        let normalizedDelta = e.deltaY * modeScale;
        if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) return;
        normalizedDelta = Math.max(-wheelDeltaLimit, Math.min(wheelDeltaLimit, normalizedDelta));

        const mx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const my = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        pendingWheelAnchor = { mx, my };

        // Apply first event immediately so new zoom gestures always feel responsive.
        if (wheelFrameId === 0 && pendingWheelDelta === 0) {
            applyWheelZoom(normalizedDelta, mx, my);
            wheelFrameId = requestAnimationFrame(flushPendingWheelZoom);
            return;
        }

        pendingWheelDelta += normalizedDelta;
        pendingWheelDelta = Math.max(-pendingWheelDeltaLimit, Math.min(pendingWheelDeltaLimit, pendingWheelDelta));
        if (wheelFrameId === 0) {
            wheelFrameId = requestAnimationFrame(flushPendingWheelZoom);
        }
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

    wheelTarget.addEventListener('wheel', onWheel, { passive: false });
    svgEl.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return {
        getOriginal() {
            return { ...orig };
        },
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
            wheelTarget.removeEventListener('wheel', onWheel);
            svgEl.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (wheelFrameId !== 0) {
                cancelAnimationFrame(wheelFrameId);
                wheelFrameId = 0;
            }
        },
    };
}

// State
let panZoomInstance = null;
let debounceTimer = null;
let syncTimer = null;
let renderCounter = 0;
let isExternalUpdate = false;
let latestServerVersion = 0;
let evtSource = null;
let resyncInFlight = null;
let foregroundRecoveryTimer = null;

// DOM elements
const container = document.getElementById('container');
const editorEl = document.getElementById('editor');
const previewEl = document.getElementById('preview');
const formatBtn = document.getElementById('format-btn');
const collapseBtn = document.getElementById('collapse-btn');
const expandBtn = document.getElementById('expand-btn');
const resetZoomBtn = document.getElementById('reset-zoom-btn');
const themeToggle = document.getElementById('theme-toggle');

// Light theme for CodeMirror
const lightTheme = EditorView.theme({
    '&': {
        backgroundColor: '#fffdf7',
        fontFamily: '"Source Code Pro", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    },
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

const darkTheme = EditorView.theme({
    '&': {
        backgroundColor: '#130e0a',
        fontFamily: '"Source Code Pro", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    },
    '.cm-content': { color: '#f4e6cc', caretColor: '#f2b661' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#f2b661' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: 'rgba(167, 139, 250, 0.3)',
    },
    '.cm-gutters': {
        backgroundColor: '#23180f',
        color: '#d9ad7b',
        borderRight: '1px solid #4f3924',
    },
    '.cm-activeLineGutter': { backgroundColor: '#342416', color: '#ffd8a7' },
    '.cm-activeLine': { backgroundColor: 'rgba(197, 121, 63, 0.22)' },
});

const darkHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: '#ffb56b' },
    { tag: [tags.name, tags.deleted, tags.character, tags.propertyName], color: '#f4e6cc' },
    { tag: [tags.function(tags.variableName), tags.labelName], color: '#ffd8a6' },
    { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: '#ffcf72' },
    { tag: [tags.definition(tags.name), tags.separator], color: '#e3a265' },
    { tag: [tags.className], color: '#ffe5c7' },
    { tag: [tags.number, tags.changed, tags.annotation, tags.modifier], color: '#f08b5c' },
    { tag: [tags.typeName], color: '#d4b277' },
    { tag: [tags.operator, tags.operatorKeyword], color: '#f9ddba' },
    { tag: [tags.url, tags.escape, tags.regexp, tags.link], color: '#f6c482' },
    { tag: [tags.meta, tags.comment], color: '#93806a' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.heading, color: '#ffb56b', fontWeight: '700' },
    { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: '#f8be61' },
    { tag: [tags.processingInstruction, tags.string, tags.inserted], color: '#f2c58f' },
    { tag: tags.invalid, color: '#ffffff', backgroundColor: '#e74c3c' },
]);

// Create CodeMirror editor (starts with vim enabled; adjusted after loading prefs)
const editor = new EditorView({
    state: EditorState.create({
        doc: STARTER_DIAGRAM,
        extensions: [
            vimCompartment.of(vimExtensions()),
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightSpecialChars(),
            history(),
            foldGutter(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            indentOnInput(),
            syntaxCompartment.of(syntaxHighlighting(defaultHighlightStyle, { fallback: true })),
            bracketMatching(),
            rectangularSelection(),
            crosshairCursor(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            vimKeyCompartment.of(vimTabKeymap()),
            keymap.of([
                ...defaultKeymap,
                ...searchKeymap,
                ...historyKeymap,
                ...foldKeymap,
                ...lintKeymap,
            ]),
            editorThemeCompartment.of(lightTheme),
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

editor.dom.addEventListener('keydown', (e) => {
    if (e.key !== 'p' && e.key !== 'P') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const cm = getCM(editor);
    if (!cm || !cm.state.vim) return;
    if (cm.state.vim.insertMode) return;

    e.preventDefault();
    e.stopPropagation();
    const key = e.key;
    pasteFromSystemClipboard(Vim, cm, key).catch(() => {
        Vim.handleKey(cm, key, 'user');
    });
}, true);

function applyTheme(isDark) {
    themeToggle.checked = isDark;
    document.body.classList.toggle('dark-mode', isDark);
    initMermaid(isDark ? 'dark' : 'default');
    editor.dispatch({
        effects: [
            editorThemeCompartment.reconfigure(isDark ? darkTheme : lightTheme),
            syntaxCompartment.reconfigure(
                isDark
                    ? syntaxHighlighting(darkHighlightStyle, { fallback: true })
                    : syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            ),
        ],
    });
}

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

function formatEditorContent() {
    const current = editor.state.doc.toString();
    const formatted = prettyPrintMermaidForEditor(current);
    if (formatted === current) return;

    editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: formatted },
    });
}

formatBtn.addEventListener('click', () => {
    formatEditorContent();
    editor.focus();
});

// Collapse / Expand
collapseBtn.addEventListener('click', () => {
    editorPane.style.width = '';
    container.classList.add('collapsed');
    expandBtn.classList.remove('hidden');
});

expandBtn.addEventListener('click', () => {
    editorPane.style.width = '';
    container.classList.remove('collapsed');
    expandBtn.classList.add('hidden');
});

// Vim toggle
const vimToggle = document.getElementById('vim-toggle');

function setVimMode(enabled) {
    vimToggle.checked = enabled;
    editor.dispatch({
        effects: [
            vimCompartment.reconfigure(enabled ? vimExtensions() : []),
            vimKeyCompartment.reconfigure(enabled ? vimTabKeymap() : defaultTabKeymap()),
        ],
    });
}

// Load saved preference (default: vim on)
fetch('/api/preferences').then(r => r.json()).then(prefs => {
    applyTheme(Boolean(prefs.darkMode));
    if (prefs.vimMode === false) {
        setVimMode(false);
    }
    scheduleRender();
}).catch(() => {});

vimToggle.addEventListener('change', () => {
    const enabled = vimToggle.checked;
    savePreference('vimMode', enabled);
    setVimMode(enabled);
    editor.focus();
});

themeToggle.addEventListener('change', () => {
    const isDark = themeToggle.checked;
    savePreference('darkMode', isDark);
    applyTheme(isDark);
    scheduleRender();
    editor.focus();
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

// Clone SVG with its original full-diagram viewBox and explicit pixel dimensions
// so exports capture the entire diagram regardless of current pan/zoom state.
function cloneSvgForExport(svgEl) {
    const clone = svgEl.cloneNode(true);
    if (panZoomInstance) {
        const orig = panZoomInstance.getOriginal();
        clone.setAttribute('viewBox', `${orig.x} ${orig.y} ${orig.width} ${orig.height}`);
        clone.setAttribute('width', orig.width);
        clone.setAttribute('height', orig.height);
    }
    clone.style.cursor = '';
    return clone;
}

downloadSvgBtn.addEventListener('click', () => {
    const svgEl = previewEl.querySelector('svg');
    if (!svgEl) return;
    const clone = cloneSvgForExport(svgEl);
    const svgData = new XMLSerializer().serializeToString(clone);
    downloadViaServer('diagram.svg', 'image/svg+xml', svgData);
    downloadMenu.classList.remove('open');
});

downloadPngBtn.addEventListener('click', () => {
    const svgEl = previewEl.querySelector('svg');
    if (!svgEl) return;
    const clone = cloneSvgForExport(svgEl);
    const svgData = new XMLSerializer().serializeToString(clone);
    const svgDataURI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = 2; // 2x for retina-quality output
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, img.width, img.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                downloadViaServer('diagram.png', 'image/png', base64, 'base64');
            };
            reader.readAsDataURL(blob);
        }, 'image/png');
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
        }).then(r => {
            if (!r.ok) return null;
            return r.json();
        }).then(data => {
            if (!data || typeof data.version !== 'number') return;
            latestServerVersion = Math.max(latestServerVersion, data.version);
        }).catch(() => {
            // Server unavailable — ignore
        });
    }, 300);
}

function applyServerContent(content, version) {
    if (typeof version === 'number') {
        latestServerVersion = Math.max(latestServerVersion, version);
    }

    const formattedContent = prettyPrintMermaidForEditor(content || '');
    const currentContent = editor.state.doc.toString();
    if (formattedContent === currentContent) return;

    isExternalUpdate = true;
    editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: formattedContent },
    });
    isExternalUpdate = false;
}

function resyncFromServer() {
    if (resyncInFlight) return resyncInFlight;

    resyncInFlight = fetch('/api/diagram')
        .then(r => r.json())
        .then(({ content, version }) => {
            if (typeof version === 'number' && version <= latestServerVersion) return;
            applyServerContent(content, version);
        })
        .catch(() => {
            // Server unavailable — ignore
        })
        .finally(() => {
            resyncInFlight = null;
        });

    return resyncInFlight;
}

function disconnectSSE() {
    if (!evtSource) return;
    evtSource.close();
    evtSource = null;
}

// Connect to SSE for live updates from external sources (e.g. MCP)
function connectSSE() {
    disconnectSSE();
    evtSource = new EventSource('/api/events');

    evtSource.onmessage = (e) => {
        try {
            const event = JSON.parse(e.data);
            if (event.source === 'browser') return; // Ignore our own changes
            if (typeof event.version === 'number' && event.version <= latestServerVersion) return;
            applyServerContent(event.content, event.version);
        } catch {
            // Ignore malformed events
        }
    };

    evtSource.onerror = () => {
        // EventSource auto-reconnects
    };
}

function recoverFromBackground() {
    clearTimeout(foregroundRecoveryTimer);
    foregroundRecoveryTimer = setTimeout(() => {
        connectSSE();
        resyncFromServer();
    }, 50);
}

connectSSE();
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        recoverFromBackground();
    }
});
window.addEventListener('focus', recoverFromBackground);

// Auto-enter insert mode on paste when in vim normal mode
editor.dom.addEventListener('paste', () => {
    if (!vimToggle.checked) return;
    const cm = getCM(editor);
    if (cm && cm.state.vim && !cm.state.vim.insertMode) {
        Vim.handleKey(editor, 'i');
    }
}, true);

// Initial load: fetch current diagram from server (may have been set via CLI arg)
resyncFromServer()
    .then(() => {
        renderDiagram(editor.state.doc.toString());
    })
    .catch(() => {
        renderDiagram(STARTER_DIAGRAM);
    });
