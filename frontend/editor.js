import { StreamLanguage } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import mermaid from 'mermaid';

const KEYWORDS = new Set([
    'sequenceDiagram', 'participant', 'actor', 'activate', 'deactivate',
    'Note', 'loop', 'alt', 'else', 'opt', 'par', 'and', 'critical',
    'break', 'rect', 'end', 'autonumber', 'over', 'title',
]);

const POSITION_KEYWORDS = new Set([
    'right', 'left', 'of',
]);

const mermaidStreamParser = {
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

export function mermaidLanguage() {
    return StreamLanguage.define(mermaidStreamParser);
}

export function mermaidLinter() {
    return linter(async (view) => {
        const code = view.state.doc.toString();
        if (!code.trim()) return [];

        try {
            await mermaid.parse(code);
            return [];
        } catch (e) {
            const msg = e.message || String(e);

            // Try to extract line number from Mermaid error
            let from = 0;
            let to = code.length;

            // Mermaid errors sometimes contain line/char info
            const lineMatch = msg.match(/line\s+(\d+)/i);
            if (lineMatch) {
                const lineNum = parseInt(lineMatch[1], 10);
                const lines = code.split('\n');
                let offset = 0;
                for (let i = 0; i < Math.min(lineNum - 1, lines.length); i++) {
                    offset += lines[i].length + 1;
                }
                from = offset;
                to = Math.min(offset + (lines[lineNum - 1]?.length || 1), code.length);
            }

            return [{
                from,
                to,
                severity: 'error',
                message: msg,
            }];
        }
    }, { delay: 500 });
}
