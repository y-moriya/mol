function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text: string): string {
  let escaped = escapeHtml(text);

  // Strip markdown image tags to prevent image exfiltration
  escaped = escaped.replace(/!\[([^\]]*)\]\([^\s)]+\)/g, "$1");

  // Bold
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-white">$1</strong>');

  // Italic
  escaped = escaped.replace(/\*(.+?)\*/g, '<em class="italic text-slate-200">$1</em>');

  // Inline code
  escaped = escaped.replace(
    /`([^`]+)`/g,
    '<code class="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/60 text-emerald-300 font-mono text-xs">$1</code>',
  );

  // Safe links (strict https or non-protocol-relative root paths, no open redirects)
  escaped = escaped.replace(
    /\[([^\]]+)\]\((https:\/\/[^\s)"'>]+|\/(?!\/)[^\s)"'>]*)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-emerald-400 underline hover:text-emerald-300 transition">$1</a>',
  );

  return escaped;
}

type ColumnAlignment = "left" | "center" | "right";

function splitTableRow(line: string): string[] {
  let content = line.trim();
  if (content.startsWith("|")) {
    content = content.slice(1);
  }
  if (content.endsWith("|") && !content.endsWith("\\|")) {
    content = content.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";
  let inBacktick = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const prevChar = i > 0 ? content[i - 1] : "";

    if (char === "`" && prevChar !== "\\") {
      inBacktick = !inBacktick;
      current += char;
    } else if (char === "|" && prevChar !== "\\" && !inBacktick) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isDelimiterRow(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
}

function parseAlignments(delimiterCells: string[]): ColumnAlignment[] {
  return delimiterCells.map((cell) => {
    const c = cell.trim();
    const start = c.startsWith(":");
    const end = c.endsWith(":");
    if (start && end) return "center";
    if (end) return "right";
    return "left";
  });
}

function getAlignmentClass(alignment: ColumnAlignment): string {
  if (alignment === "center") return "text-center";
  if (alignment === "right") return "text-right";
  return "text-left";
}

function renderTableCell(cellText: string): string {
  const unescaped = cellText.replace(/\\\|/g, "|");
  return renderInline(unescaped);
}

function renderTableHtml(
  headerCells: string[],
  alignments: ColumnAlignment[],
  bodyRows: string[][],
): string {
  const colCount = Math.max(headerCells.length, alignments.length);

  const thHtml = headerCells
    .map((h, idx) => {
      const align = alignments[idx] ?? "left";
      const alignClass = getAlignmentClass(align);
      return `<th class="px-4 py-3 font-semibold text-slate-200 ${alignClass}">${renderTableCell(h)}</th>`;
    })
    .join("\n        ");

  const trsHtml = bodyRows
    .map((row) => {
      const tds: string[] = [];
      for (let c = 0; c < colCount; c++) {
        const cell = row[c] ?? "";
        const align = alignments[c] ?? "left";
        const alignClass = getAlignmentClass(align);
        tds.push(
          `<td class="px-4 py-3 leading-relaxed ${alignClass}">${renderTableCell(cell)}</td>`,
        );
      }
      return `      <tr class="hover:bg-slate-800/30 transition-colors">\n        ${tds.join("\n        ")}\n      </tr>`;
    })
    .join("\n");

  return [
    '<div class="overflow-x-auto my-6 border border-slate-800 rounded-xl">',
    '  <table class="w-full text-left text-sm text-slate-300 border-collapse">',
    '    <thead class="bg-slate-900/90 text-xs uppercase text-slate-400 border-b border-slate-800 font-mono">',
    "      <tr>",
    `        ${thHtml}`,
    "      </tr>",
    "    </thead>",
    '    <tbody class="divide-y divide-slate-800/60 bg-slate-900/30">',
    trsHtml,
    "    </tbody>",
    "  </table>",
    "</div>",
  ].join("\n");
}

export function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const htmlOut: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let currentList: "ul" | "ol" | null = null;

  const closeList = () => {
    if (currentList) {
      htmlOut.push(`</${currentList}>`);
      currentList = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";

    // Code block toggle
    if (rawLine.trim().startsWith("```")) {
      if (inCodeBlock) {
        // Close code block
        inCodeBlock = false;
        htmlOut.push(
          `<pre class="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs sm:text-sm text-emerald-300 overflow-x-auto my-4 leading-relaxed"><code>${escapeHtml(codeBlockLines.join("\n"))}</code></pre>`,
        );
        codeBlockLines = [];
      } else {
        // Open code block
        closeList();
        inCodeBlock = true;
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(rawLine);
      continue;
    }

    const trimmed = rawLine.trim();

    // Blank line
    if (!trimmed) {
      closeList();
      continue;
    }

    // Table check: line must contain '|' and the immediately following line must be a delimiter row
    if (trimmed.includes("|") && i + 1 < lines.length) {
      const nextLine = (lines[i + 1] ?? "").trim();
      if (nextLine.includes("|") || /^:?-{1,}:?/.test(nextLine)) {
        const headerCells = splitTableRow(rawLine);
        const delimiterCells = splitTableRow(nextLine);
        if (
          headerCells.length > 0 &&
          delimiterCells.length > 0 &&
          isDelimiterRow(delimiterCells)
        ) {
          closeList();
          const alignments = parseAlignments(delimiterCells);
          const bodyRows: string[][] = [];
          let j = i + 2;
          while (j < lines.length) {
            const rowLine = lines[j] ?? "";
            const trimmedRow = rowLine.trim();
            if (!trimmedRow || !trimmedRow.includes("|")) {
              break;
            }
            if (trimmedRow.startsWith("```") || trimmedRow.startsWith("#")) {
              break;
            }
            bodyRows.push(splitTableRow(rowLine));
            j++;
          }
          i = j - 1;
          htmlOut.push(renderTableHtml(headerCells, alignments, bodyRows));
          continue;
        }
      }
    }

    // Horizontal Rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeList();
      htmlOut.push('<hr class="border-slate-800 my-6" />');
      continue;
    }

    // Headings
    if (trimmed.startsWith("#### ")) {
      closeList();
      htmlOut.push(
        `<h4 class="text-base font-bold text-white mt-6 mb-2">${renderInline(trimmed.slice(5))}</h4>`,
      );
      continue;
    }
    if (trimmed.startsWith("### ")) {
      closeList();
      htmlOut.push(
        `<h3 class="text-lg font-bold text-white mt-6 mb-2">${renderInline(trimmed.slice(4))}</h3>`,
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      closeList();
      htmlOut.push(
        `<h2 class="text-xl font-bold text-white mt-8 mb-3 pb-2 border-b border-slate-800/80">${renderInline(trimmed.slice(3))}</h2>`,
      );
      continue;
    }
    if (trimmed.startsWith("# ")) {
      closeList();
      htmlOut.push(
        `<h1 class="text-2xl font-extrabold text-white mt-8 mb-4">${renderInline(trimmed.slice(2))}</h1>`,
      );
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      closeList();
      htmlOut.push(
        `<blockquote class="border-l-4 border-emerald-500/50 pl-4 py-1.5 my-3 text-slate-300 italic bg-slate-900/40 rounded-r">${renderInline(trimmed.slice(2))}</blockquote>`,
      );
      continue;
    }

    // Bullet list items
    if (/^[-*+]\s+/.test(trimmed)) {
      if (currentList !== "ul") {
        closeList();
        htmlOut.push('<ul class="space-y-1.5 my-3 list-disc list-inside">');
        currentList = "ul";
      }
      const itemText = trimmed.replace(/^[-*+]\s+/, "");
      htmlOut.push(
        `<li class="text-slate-300 text-sm leading-relaxed">${renderInline(itemText)}</li>`,
      );
      continue;
    }

    // Numbered list items
    if (/^\d+\.\s+/.test(trimmed)) {
      if (currentList !== "ol") {
        closeList();
        htmlOut.push('<ol class="space-y-1.5 my-3 list-decimal list-inside">');
        currentList = "ol";
      }
      const itemText = trimmed.replace(/^\d+\.\s+/, "");
      htmlOut.push(
        `<li class="text-slate-300 text-sm leading-relaxed">${renderInline(itemText)}</li>`,
      );
      continue;
    }

    // Normal paragraph
    closeList();
    htmlOut.push(
      `<p class="text-slate-300 text-sm sm:text-base leading-relaxed my-2">${renderInline(trimmed)}</p>`,
    );
  }

  closeList();

  if (inCodeBlock) {
    htmlOut.push(
      `<pre class="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs sm:text-sm text-emerald-300 overflow-x-auto my-4 leading-relaxed"><code>${escapeHtml(codeBlockLines.join("\n"))}</code></pre>`,
    );
  }

  return htmlOut.join("\n");
}
