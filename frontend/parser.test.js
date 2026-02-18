import { describe, it, expect } from 'vitest';
import { mermaidStreamParser } from './parser.js';

// Minimal mock of CodeMirror's StringStream, covering only the methods
// that mermaidStreamParser.token() actually calls.
class MockStream {
    constructor(line) {
        this.string = line;
        this.pos = 0;
        this.start = 0;
    }

    eatSpace() {
        const before = this.pos;
        while (this.pos < this.string.length && /\s/.test(this.string[this.pos])) {
            this.pos++;
        }
        return this.pos > before;
    }

    match(pattern) {
        if (typeof pattern === 'string') {
            if (this.string.startsWith(pattern, this.pos)) {
                this.pos += pattern.length;
                return true;
            }
            return false;
        }
        const m = this.string.slice(this.pos).match(pattern);
        if (m && m.index === 0) {
            this.pos += m[0].length;
            return m;
        }
        return null;
    }

    peek() {
        return this.pos < this.string.length ? this.string[this.pos] : undefined;
    }

    next() {
        if (this.pos < this.string.length) return this.string[this.pos++];
        return undefined;
    }

    skipToEnd() {
        this.pos = this.string.length;
    }

    current() {
        return this.string.slice(this.start, this.pos);
    }

    eol() {
        return this.pos >= this.string.length;
    }
}

// Tokenize a full line and return an array of { text, type } objects.
// Whitespace tokens (type null from eatSpace) are omitted.
function tokenize(line) {
    const stream = new MockStream(line);
    const state = mermaidStreamParser.startState();
    const tokens = [];

    while (!stream.eol()) {
        stream.start = stream.pos;
        const type = mermaidStreamParser.token(stream, state);
        const text = stream.current();
        if (text) tokens.push({ text, type });
    }

    return tokens;
}

// Tokenize across multiple lines, carrying state between them (as CodeMirror does).
function tokenizeLines(lines) {
    const state = mermaidStreamParser.startState();
    return lines.map((line) => {
        const stream = new MockStream(line);
        const tokens = [];
        while (!stream.eol()) {
            stream.start = stream.pos;
            const type = mermaidStreamParser.token(stream, state);
            const text = stream.current();
            if (text) tokens.push({ text, type });
        }
        return tokens;
    });
}

describe('mermaidStreamParser', () => {
    it('recognizes diagram type keywords', () => {
        const tokens = tokenize('sequenceDiagram');
        expect(tokens).toEqual([{ text: 'sequenceDiagram', type: 'keyword' }]);
    });

    it('recognizes block keywords', () => {
        for (const kw of ['participant', 'actor', 'loop', 'alt', 'else', 'opt',
            'par', 'and', 'critical', 'break', 'rect', 'end',
            'activate', 'deactivate', 'Note', 'autonumber', 'over', 'title']) {
            const tokens = tokenize(kw);
            expect(tokens).toEqual([{ text: kw, type: 'keyword' }]);
        }
    });

    it('recognizes position keywords', () => {
        for (const kw of ['right', 'left', 'of']) {
            const tokens = tokenize(kw);
            expect(tokens).toEqual([{ text: kw, type: 'keyword' }]);
        }
    });

    it('recognizes participant names as variableName', () => {
        const tokens = tokenize('Alice');
        expect(tokens).toEqual([{ text: 'Alice', type: 'variableName' }]);
    });

    it('recognizes comments', () => {
        const tokens = tokenize('%% this is a comment');
        expect(tokens).toEqual([{ text: '%% this is a comment', type: 'comment' }]);
    });

    it('recognizes all arrow operators', () => {
        const arrows = ['->>', '-->>', '->', '-->', '-x', '--x', '-)', '--)'];
        for (const arrow of arrows) {
            const tokens = tokenize(arrow);
            expect(tokens).toEqual([{ text: arrow, type: 'operator' }]);
        }
    });

    it('matches longer arrows before shorter ones', () => {
        // -->> should not be parsed as --> then >
        const tokens = tokenize('-->>');
        expect(tokens).toEqual([{ text: '-->>', type: 'operator' }]);

        // ->> should not be parsed as -> then >
        const tokens2 = tokenize('->>');
        expect(tokens2).toEqual([{ text: '->>', type: 'operator' }]);
    });

    it('recognizes numbers', () => {
        const tokens = tokenize('42');
        expect(tokens).toEqual([{ text: '42', type: 'number' }]);
    });

    it('skips whitespace', () => {
        const tokens = tokenize('  Alice');
        expect(tokens).toEqual([
            { text: '  ', type: null },
            { text: 'Alice', type: 'variableName' },
        ]);
    });

    it('treats colon as punctuation and the rest of the line as string', () => {
        // eatSpace() runs before the inString check, so the space after
        // the colon is consumed as a separate whitespace token.
        const lines = tokenizeLines([': Hello World']);
        expect(lines[0]).toEqual([
            { text: ':', type: 'punctuation' },
            { text: ' ', type: null },
            { text: 'Hello World', type: 'string' },
        ]);
    });

    it('resets inString state at line boundaries', () => {
        // After a colon+string line, the next line should tokenize normally
        const lines = tokenizeLines([': message', 'Alice']);
        expect(lines[1]).toEqual([{ text: 'Alice', type: 'variableName' }]);
    });

    it('tokenizes a full sequence diagram line', () => {
        const tokens = tokenize('Alice->>Bob');
        expect(tokens).toEqual([
            { text: 'Alice', type: 'variableName' },
            { text: '->>', type: 'operator' },
            { text: 'Bob', type: 'variableName' },
        ]);
    });

    it('tokenizes a message line with colon', () => {
        const lines = tokenizeLines(['Alice->>Bob: Hello World']);
        expect(lines[0]).toEqual([
            { text: 'Alice', type: 'variableName' },
            { text: '->>', type: 'operator' },
            { text: 'Bob', type: 'variableName' },
            { text: ':', type: 'punctuation' },
            { text: ' ', type: null },
            { text: 'Hello World', type: 'string' },
        ]);
    });

    it('tokenizes participant declaration', () => {
        const tokens = tokenize('participant Alice');
        expect(tokens).toEqual([
            { text: 'participant', type: 'keyword' },
            { text: ' ', type: null },
            { text: 'Alice', type: 'variableName' },
        ]);
    });

    it('advances past unrecognized characters', () => {
        const tokens = tokenize('#');
        expect(tokens).toEqual([{ text: '#', type: null }]);
    });
});
