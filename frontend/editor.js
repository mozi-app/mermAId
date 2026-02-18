import { StreamLanguage } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import mermaid from 'mermaid';
import { mermaidStreamParser } from './parser.js';

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
