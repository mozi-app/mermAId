const DIAGRAM_HEADER_RE = /^\s*(sequenceDiagram|graph|flowchart|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|requirementDiagram|quadrantChart|C4[A-Za-z]*|architecture-beta|packet-beta|block-beta|xychart-beta|sankey-beta)\b/i;
const SEQUENCE_DIAGRAM_RE = /^\s*sequenceDiagram\b/i;

// Lines where a colon is a value separator (fill:#f9f), not message text.
const STYLE_LINE_RE = /^\s*(classDef|style|linkStyle)\b/i;
// U+037E (Greek question mark) is a visual twin of ';' that Mermaid treats as
// plain text, so it renders in message/note text instead of terminating the
// statement — which a literal ';' would.
const SAFE_SEMICOLON = ';';

// Agents routinely write prose with ';' in sequence message/note text
// (e.g. `A->>B: do this; then that`), which Mermaid parses as a statement
// separator and rejects. Replace only those text-position semicolons — the
// ones after a line's top-level message colon — with a rendering-safe twin.
// Genuine statement separators, flowchart bracket labels, and classDef/style
// lines are left untouched.
export function sanitizeMermaidSemicolons(content) {
    if (typeof content !== 'string') return '';
    if (!content.includes(';')) return content;
    return content.split('\n').map(sanitizeLine).join('\n');
}

function sanitizeLine(line) {
    if (!line.includes(';') || STYLE_LINE_RE.test(line)) return line;

    let out = '';
    let inMessage = false;
    let quote = '';
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (inMessage) {
            out += ch === ';' ? SAFE_SEMICOLON : ch;
            continue;
        }

        if (quote) {
            out += ch;
            if (ch === quote) quote = '';
            continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
        } else if (ch === '(') parenDepth++;
        else if (ch === ')' && parenDepth > 0) parenDepth--;
        else if (ch === '[') bracketDepth++;
        else if (ch === ']' && bracketDepth > 0) bracketDepth--;
        else if (ch === '{') braceDepth++;
        else if (ch === '}' && braceDepth > 0) braceDepth--;
        else if (
            ch === ':' &&
            parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 &&
            line[i - 1] !== ':' && line[i + 1] !== ':'
        ) {
            // First top-level, non-':::' colon starts message/note text.
            inMessage = true;
        }

        out += ch;
    }

    return out;
}

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
    // Sanitize runs last, on the expanded output: by then genuine top-level
    // separators are newlines, so any ';' left in message text is prose.
    return sanitizeMermaidSemicolons(expandSingleLineDiagram(content));
}

function expandSingleLineDiagram(content) {
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
