import { describe, expect, it } from 'vitest';
import { prettyPrintMermaidForEditor } from './format.js';

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

    it('does not split semicolons inside quoted message text', () => {
        const input = 'sequenceDiagram; A->>B: "one; two"; B-->>A: done';

        expect(prettyPrintMermaidForEditor(input)).toBe(
            'sequenceDiagram\n' +
            '  A->>B: "one; two"\n' +
            '  B-->>A: done',
        );
    });

    it('does not split semicolons inside bracketed labels', () => {
        const input = 'graph TD; A[foo;bar]-->B';
        expect(prettyPrintMermaidForEditor(input)).toBe(
            'graph TD\nA[foo;bar]-->B',
        );
    });
});
