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
import { history, undo, defaultKeymap, historyKeymap } from '@codemirror/commands';
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
let renderCounter = 0;

// DOM elements
const container = document.getElementById('container');
const editorEl = document.getElementById('editor');
const previewEl = document.getElementById('preview');
const collapseBtn = document.getElementById('collapse-btn');
const floatingIcon = document.getElementById('floating-icon');
const resetZoomBtn = document.getElementById('reset-zoom-btn');

// Prompt pane DOM elements
const aiToggleBtn = document.getElementById('ai-toggle-btn');
const promptPane = document.getElementById('prompt-pane');
const modelSelect = document.getElementById('model-select');
const promptClearBtn = document.getElementById('prompt-clear-btn');
const promptCloseBtn = document.getElementById('prompt-close-btn');
const promptResponse = document.getElementById('prompt-response');
const promptInput = document.getElementById('prompt-input');
const promptSubmitBtn = document.getElementById('prompt-submit');
const promptApplyBtn = document.getElementById('prompt-apply');
const promptUndoBtn = document.getElementById('prompt-undo');

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

// ── AI Prompt Pane ──────────────────────────────────────────────────────────

let modelsLoaded = false;
let isStreaming = false;
let conversationHistory = [];
let lastExtractedCode = null;
let abortController = null;

const SYSTEM_PROMPT = `You are a Mermaid diagram assistant. The user will provide their current diagram and a request.
When modifying the diagram, return the complete updated diagram inside a \`\`\`mermaid code fence.
Provide a brief explanation outside the code fence. Do not include partial diagrams.`;

function togglePromptPane() {
    const isHidden = promptPane.classList.toggle('hidden');
    aiToggleBtn.classList.toggle('active', !isHidden);
    editor.requestMeasure();
    if (!isHidden && !modelsLoaded) {
        fetchModels();
    }
    if (!isHidden) {
        promptInput.focus();
    }
}

aiToggleBtn.addEventListener('click', togglePromptPane);
promptCloseBtn.addEventListener('click', togglePromptPane);

// Keyboard shortcut: Ctrl+Shift+A
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        togglePromptPane();
    }
});

// Fetch available models
async function fetchModels() {
    try {
        const resp = await fetch('/api/ollama/tags');
        if (!resp.ok) throw new Error('Ollama not reachable');
        const data = await resp.json();
        modelSelect.innerHTML = '';
        if (data.models && data.models.length > 0) {
            for (const m of data.models) {
                const opt = document.createElement('option');
                opt.value = m.name;
                opt.textContent = m.name;
                modelSelect.appendChild(opt);
            }
        } else {
            modelSelect.innerHTML = '<option value="">No models found</option>';
        }
        modelsLoaded = true;
    } catch (e) {
        modelSelect.innerHTML = '<option value="">Ollama unavailable</option>';
        promptResponse.textContent = 'Could not connect to Ollama. Is it running on localhost:11434?';
    }
}

// Clear conversation
promptClearBtn.addEventListener('click', () => {
    conversationHistory = [];
    promptResponse.textContent = '';
    lastExtractedCode = null;
    promptApplyBtn.classList.add('hidden');
    promptUndoBtn.classList.add('hidden');
});

// Extract code block from AI response
function extractCodeBlock(text) {
    const match = text.match(/```(?:mermaid)?\s*\n([\s\S]*?)```/);
    return match ? match[1].trim() : null;
}

// Submit prompt
async function submitPrompt() {
    const userPrompt = promptInput.value.trim();
    if (!userPrompt || isStreaming) return;

    const model = modelSelect.value;
    if (!model) {
        promptResponse.textContent = 'No model selected. Is Ollama running?';
        return;
    }

    const editorContent = editor.state.doc.toString();

    // Build messages
    if (conversationHistory.length === 0) {
        conversationHistory.push({ role: 'system', content: SYSTEM_PROMPT });
    }

    conversationHistory.push({
        role: 'user',
        content: `Current diagram:\n\`\`\`mermaid\n${editorContent}\n\`\`\`\n\nRequest: ${userPrompt}`,
    });

    // UI state
    isStreaming = true;
    promptSubmitBtn.disabled = true;
    promptSubmitBtn.textContent = '...';
    promptApplyBtn.classList.add('hidden');
    promptUndoBtn.classList.add('hidden');
    lastExtractedCode = null;
    promptInput.value = '';
    promptResponse.textContent = '';

    // Add streaming cursor
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    promptResponse.appendChild(cursor);

    abortController = new AbortController();

    try {
        const resp = await fetch('/api/ollama/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: conversationHistory,
                stream: true,
                options: { num_ctx: 8192 },
            }),
            signal: abortController.signal,
        });

        if (!resp.ok) {
            throw new Error(`Ollama error: ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line in buffer

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const chunk = JSON.parse(line);
                    const content = chunk.message?.content || '';
                    fullResponse += content;
                    // Update display: text before cursor
                    promptResponse.textContent = fullResponse;
                    promptResponse.appendChild(cursor);
                    promptResponse.scrollTop = promptResponse.scrollHeight;
                } catch {
                    // skip malformed JSON lines
                }
            }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
            try {
                const chunk = JSON.parse(buffer);
                fullResponse += chunk.message?.content || '';
            } catch {
                // skip
            }
        }

        // Finalize
        promptResponse.textContent = fullResponse;
        promptResponse.scrollTop = promptResponse.scrollHeight;

        // Save assistant response to history
        conversationHistory.push({ role: 'assistant', content: fullResponse });

        // Check for code block
        lastExtractedCode = extractCodeBlock(fullResponse);
        if (lastExtractedCode) {
            promptApplyBtn.classList.remove('hidden');
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            promptResponse.textContent += '\n\n[Cancelled]';
        } else {
            promptResponse.textContent = `Error: ${e.message}`;
        }
    } finally {
        isStreaming = false;
        promptSubmitBtn.disabled = false;
        promptSubmitBtn.textContent = 'Send';
        abortController = null;
        cursor.remove();
    }
}

promptSubmitBtn.addEventListener('click', submitPrompt);

// Enter to submit, Shift+Enter for newline
promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitPrompt();
    }
});

// Apply changes
promptApplyBtn.addEventListener('click', () => {
    if (!lastExtractedCode) return;
    editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: lastExtractedCode },
    });
    promptApplyBtn.classList.add('hidden');
    promptUndoBtn.classList.remove('hidden');
    promptResponse.textContent += '\n\n— Applied. Press u (Vim) or Ctrl+Z to undo.';
    promptResponse.scrollTop = promptResponse.scrollHeight;
});

// Undo
promptUndoBtn.addEventListener('click', () => {
    undo(editor);
    promptUndoBtn.classList.add('hidden');
    promptApplyBtn.classList.remove('hidden');
});

// Initial render
renderDiagram(STARTER_DIAGRAM);
