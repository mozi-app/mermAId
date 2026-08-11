import { describe, expect, it } from 'vitest';
import { prettyPrintMermaidForEditor, sanitizeMermaidSemicolons } from './format.js';

// U+037E (Greek question mark) is visually identical to ';' but is plain text
// to Mermaid, so it survives in message/note text instead of terminating the
// statement.
const G = ';';

describe('prettyPrintMermaidForEditor', () => {
    it('formats single-line sequence diagrams into readable multiline output', () => {
        const input = 'sequenceDiagram; autonumber; participant P as Player; participant Q as QuestBoard; P->>Q: Request daily quest; Q-->>P: Deliver quest card';

        expect(prettyPrintMermaidForEditor(input)).toBe(
            'sequenceDiagram\n' +
            '  autonumber\n' +
            '  participant P as Player\n' +
            '  participant Q as QuestBoard\n' +
            '  P->>Q: Request daily quest\n' +
            '  Q-->>P: Deliver quest card',
        );
    });

    it('keeps already-multiline content unchanged', () => {
        const input = 'sequenceDiagram\n  Alice->>Bob: Hi';
        expect(prettyPrintMermaidForEditor(input)).toBe(input);
    });

    it('ignores non-mermaid semicolon strings', () => {
        const input = 'foo; bar; baz';
        expect(prettyPrintMermaidForEditor(input)).toBe(input);
    });

    it('does not split, but neutralizes, semicolons inside quoted message text', () => {
        const input = 'sequenceDiagram; A->>B: "one; two"; B-->>A: done';

        expect(prettyPrintMermaidForEditor(input)).toBe(
            'sequenceDiagram\n' +
            `  A->>B: "one${G} two"\n` +
            '  B-->>A: done',
        );
    });

    it('neutralizes prose semicolons in already-multiline sequence diagrams', () => {
        const input = 'sequenceDiagram\n  A->>B: do this; then that\n  Note over A: first; second';

        expect(prettyPrintMermaidForEditor(input)).toBe(
            'sequenceDiagram\n' +
            `  A->>B: do this${G} then that\n` +
            `  Note over A: first${G} second`,
        );
    });

    it('does not split semicolons inside bracketed labels', () => {
        const input = 'graph TD; A[foo;bar]-->B';
        expect(prettyPrintMermaidForEditor(input)).toBe(
            'graph TD\nA[foo;bar]-->B',
        );
    });

    it('does not split on a semicolon guarded by an escaped quote', () => {
        // The escaped \" does not close the string, so the ';' stays inside the
        // quoted label instead of being treated as a statement separator.
        const input = 'graph TD; A["x\\";y"]-->B';
        expect(prettyPrintMermaidForEditor(input)).toBe(
            'graph TD\nA["x\\";y"]-->B',
        );
    });
});

describe('sanitizeMermaidSemicolons', () => {
    it('leaves content without semicolons untouched', () => {
        const input = 'sequenceDiagram\n  A->>B: hello';
        expect(sanitizeMermaidSemicolons(input)).toBe(input);
    });

    it('converts a semicolon in sequence message text', () => {
        expect(sanitizeMermaidSemicolons('sequenceDiagram\n  A->>B: do; it')).toBe(
            `sequenceDiagram\n  A->>B: do${G} it`,
        );
    });

    it('converts a semicolon in Note text', () => {
        expect(sanitizeMermaidSemicolons('sequenceDiagram\n  Note over A: first; second')).toBe(
            `sequenceDiagram\n  Note over A: first${G} second`,
        );
    });

    it('converts a semicolon inside quoted message text', () => {
        expect(sanitizeMermaidSemicolons('sequenceDiagram\n  A->>B: "one; two"')).toBe(
            `sequenceDiagram\n  A->>B: "one${G} two"`,
        );
    });

    it('leaves a top-level statement separator alone', () => {
        const input = 'graph TD; A-->B';
        expect(sanitizeMermaidSemicolons(input)).toBe(input);
    });

    it('leaves semicolons in flowchart bracket labels alone', () => {
        const input = 'graph TD\n  A[foo;bar]-->B';
        expect(sanitizeMermaidSemicolons(input)).toBe(input);
    });

    it('leaves semicolons on classDef/style lines alone', () => {
        const input = 'graph TD\n  classDef foo fill:#f9f;stroke:#333';
        expect(sanitizeMermaidSemicolons(input)).toBe(input);
    });

    it('does not treat a ::: class assignment as message text', () => {
        const input = 'flowchart TD\n  A:::cls; B';
        expect(sanitizeMermaidSemicolons(input)).toBe(input);
    });

    it('converts only the message-text semicolon across mixed lines', () => {
        const input = 'sequenceDiagram\n  A->>B: keep; this\n  classDef x fill:#000;color:#fff';
        expect(sanitizeMermaidSemicolons(input)).toBe(
            `sequenceDiagram\n  A->>B: keep${G} this\n  classDef x fill:#000;color:#fff`,
        );
    });

    it('returns an empty string for non-string input', () => {
        expect(sanitizeMermaidSemicolons(null)).toBe('');
        expect(sanitizeMermaidSemicolons(undefined)).toBe('');
        expect(sanitizeMermaidSemicolons(42)).toBe('');
    });

    it('converts every semicolon in a single message', () => {
        expect(sanitizeMermaidSemicolons('sequenceDiagram\n  A->>B: a; b; c')).toBe(
            `sequenceDiagram\n  A->>B: a${G} b${G} c`,
        );
    });

    it('leaves semicolons on style and linkStyle lines alone', () => {
        const input = 'graph TD\n  style A fill:#f9f;stroke:#333\n  linkStyle 0 stroke:#333;';
        expect(sanitizeMermaidSemicolons(input)).toBe(input);
    });

    it('ignores a colon inside quotes when locating the message colon', () => {
        // The ';' inside the quoted actor name is before the real message
        // colon, so it stays a separator-looking literal; only the prose ';'
        // after the message colon is converted.
        expect(sanitizeMermaidSemicolons('sequenceDiagram\n  Note over "Node; A": text; more')).toBe(
            `sequenceDiagram\n  Note over "Node; A": text${G} more`,
        );
    });

    it('ignores a colon inside brackets so a trailing separator is preserved', () => {
        const input = 'flowchart TD\n  A[a: b] --> B; C';
        expect(sanitizeMermaidSemicolons(input)).toBe(input);
    });

    it('preserves a trailing newline', () => {
        expect(sanitizeMermaidSemicolons('sequenceDiagram\n  A->>B: a; b\n')).toBe(
            `sequenceDiagram\n  A->>B: a${G} b\n`,
        );
    });
});
