const KEYWORDS = new Set([
    'sequenceDiagram', 'participant', 'actor', 'activate', 'deactivate',
    'Note', 'loop', 'alt', 'else', 'opt', 'par', 'and', 'critical',
    'break', 'rect', 'end', 'autonumber', 'over', 'title',
]);

const POSITION_KEYWORDS = new Set([
    'right', 'left', 'of',
]);

export const mermaidStreamParser = {
    startState() {
        return { inString: false };
    },

    token(stream, state) {
        // Skip whitespace
        if (stream.eatSpace()) return null;

        // Comments: %%
        if (stream.match('%%')) {
            stream.skipToEnd();
            return 'comment';
        }

        // After colon — message text
        if (state.inString) {
            stream.skipToEnd();
            state.inString = false;
            return 'string';
        }

        // Colon starts message text
        if (stream.peek() === ':') {
            stream.next();
            state.inString = true;
            return 'punctuation';
        }

        // Arrow operators (check longer patterns first)
        if (stream.match('-->>') || stream.match('->>') ||
            stream.match('-->')  || stream.match('->')  ||
            stream.match('--x')  || stream.match('-x')  ||
            stream.match('--)')  || stream.match('-)')) {
            return 'operator';
        }

        // Try to match a word
        if (stream.match(/^[a-zA-Z_]\w*/)) {
            const word = stream.current();
            if (KEYWORDS.has(word)) return 'keyword';
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
