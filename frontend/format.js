const DIAGRAM_HEADER_RE = /^\s*(sequenceDiagram|graph|flowchart|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|requirementDiagram|quadrantChart|C4[A-Za-z]*|architecture-beta|packet-beta|block-beta|xychart-beta|sankey-beta)\b/i;
const SEQUENCE_DIAGRAM_RE = /^\s*sequenceDiagram\b/i;

function splitMermaidStatements(content) {
    const statements = [];
    let current = '';
    let quote = '';
    let escaped = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (const ch of content) {
        if (quote) {
            current += ch;
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === quote) {
                quote = '';
            }
            continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            current += ch;
            continue;
        }

        if (ch === '(') parenDepth++;
        else if (ch === ')' && parenDepth > 0) parenDepth--;
        else if (ch === '[') bracketDepth++;
        else if (ch === ']' && bracketDepth > 0) bracketDepth--;
        else if (ch === '{') braceDepth++;
        else if (ch === '}' && braceDepth > 0) braceDepth--;

        if (ch === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            const trimmed = current.trim();
            if (trimmed) statements.push(trimmed);
            current = '';
            continue;
        }

        current += ch;
    }

    const tail = current.trim();
    if (tail) statements.push(tail);
    return statements;
}

export function prettyPrintMermaidForEditor(content) {
    if (typeof content !== 'string') return '';
    if (!content.includes(';')) return content;
    if (content.includes('\n')) return content;
    if (!DIAGRAM_HEADER_RE.test(content)) return content;

    const statements = splitMermaidStatements(content);
    if (statements.length <= 1) return content;

    if (SEQUENCE_DIAGRAM_RE.test(statements[0])) {
        return statements
            .map((statement, index) => (index === 0 ? statement : `  ${statement}`))
            .join('\n');
    }

    return statements.join('\n');
}
