const KEYWORDS = new Set([
    'sequenceDiagram', 'participant', 'actor', 'activate', 'deactivate',
    'Note', 'loop', 'alt', 'else', 'opt', 'par', 'and', 'critical',
    'break', 'rect', 'end', 'autonumber', 'over', 'title',
    'graph', 'flowchart', 'subgraph', 'direction',
    'classDef', 'style', 'class', 'click', 'linkStyle',
    'classDiagram', 'stateDiagram', 'state',
    'erDiagram', 'gantt', 'pie', 'gitGraph', 'mindmap', 'journey',
]);

const POSITION_KEYWORDS = new Set([
    'right', 'left', 'of',
]);

const STYLE_KEYWORDS = new Set(['classDef', 'style', 'linkStyle']);

export const mermaidStreamParser = {
    startState() {
        return { inString: false, inStyleDef: false };
    },

    token(stream, state) {
        // Reset style-def context at start of new lines
        if (stream.sol()) {
            state.inStyleDef = false;
        }

        // Skip whitespace
        if (stream.eatSpace()) return null;

        // Comments: %%
        if (stream.match('%%')) {
            stream.skipToEnd();
            return 'comment';
        }

        // After colon — message text (only outside style definitions)
        if (state.inString) {
            stream.skipToEnd();
            state.inString = false;
            return 'string';
        }

        // Colon — in style defs it's just a separator, otherwise starts message text
        if (stream.peek() === ':') {
            stream.next();
            if (!state.inStyleDef) {
                state.inString = true;
            }
            return 'punctuation';
        }

        // Arrow operators (check longer patterns first)
        if (stream.match('-->>') || stream.match('->>') ||
            stream.match('-->')  || stream.match('->')  ||
            stream.match('--x')  || stream.match('-x')  ||
            stream.match('--)')  || stream.match('-)')) {
            return 'operator';
        }

        // Hex colors (#fff, #e8f1ff, etc.)
        if (stream.match(/^#[0-9a-fA-F]{3,8}/)) {
            return 'atom';
        }

        // Try to match a word
        if (stream.match(/^[a-zA-Z_]\w*/)) {
            const word = stream.current();
            if (KEYWORDS.has(word)) {
                if (STYLE_KEYWORDS.has(word)) {
                    state.inStyleDef = true;
                }
                return 'keyword';
            }
            if (POSITION_KEYWORDS.has(word)) return 'keyword';
            return 'variableName';
        }

        // Numbers
        if (stream.match(/^\d+/)) {
            return 'number';
        }

        // Anything else — advance one character
        stream.next();
        return null;
    },
};
