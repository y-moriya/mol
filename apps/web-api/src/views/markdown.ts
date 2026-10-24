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
