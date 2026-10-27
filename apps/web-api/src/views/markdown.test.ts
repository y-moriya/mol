import { describe, expect, it } from "vitest";
import { renderMarkdownToHtml } from "./markdown";

describe("renderMarkdownToHtml", () => {
  it("converts headings, paragraphs, and horizontal rules", () => {
    const md = "# Heading 1\n## Heading 2\n---\nHello world";
    const html = renderMarkdownToHtml(md);
    expect(html).toContain("<h1");
    expect(html).toContain("Heading 1</h1>");
    expect(html).toContain("<h2");
    expect(html).toContain("Heading 2</h2>");
    expect(html).toContain("<hr");
    expect(html).toContain("<p");
    expect(html).toContain("Hello world</p>");
  });

  it("converts bullet lists and numbered lists with appropriate tags", () => {
    const md = `1. First item
2. Second item

- Bullet one
- Bullet two`;
    const html = renderMarkdownToHtml(md);
    expect(html).toContain("<ol");
    expect(html).toContain("First item</li>");
    expect(html).toContain("</ol>");
    expect(html).toContain("<ul");
    expect(html).toContain("Bullet one</li>");
    expect(html).toContain("</ul>");
  });

  it("escapes html to prevent XSS attacks while rendering inline styles", () => {
    const md = `**bold** and *italic* and \`code\` with <script>alert(1)</script> [Link](https://example.com)`;
    const html = renderMarkdownToHtml(md);
    expect(html).toContain('<strong class="font-bold text-white">bold</strong>');
    expect(html).toContain("<code class=");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('href="https://example.com"');
  });

  it("renders fenced code blocks without executing html", () => {
    const md = "```ts\nconst x = 1 < 2;\n```";
    const html = renderMarkdownToHtml(md);
    expect(html).toContain("<pre class=");
    expect(html).toContain("const x = 1 &lt; 2;");
  });

  it("strips markdown images and prevents protocol-relative open redirects", () => {
    const md =
      "Look at ![chart](https://evil.com/leak.png) and click [relative](/posts/1) or [protocol relative](//evil.com) or [xss](javascript:alert(1))";
    const html = renderMarkdownToHtml(md);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("leak.png");
    expect(html).toContain("Look at chart");
    expect(html).toContain('href="/posts/1"');
    expect(html).not.toContain('href="//evil.com"');
    expect(html).not.toContain('href="javascript:alert(1)"');
  });

  it("renders markdown tables with alignments and inline formatting", () => {
    const md = `| Header 1 | Header 2 | Header 3 |
| :--- | :---: | ---: |
| **Left** | \`Center\` | [Right](https://example.com) |
| Cell A | Cell B | Cell C |`;
    const html = renderMarkdownToHtml(md);
    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");
    expect(html).toContain('<th class="px-4 py-3 font-semibold text-slate-200 text-left">Header 1</th>');
    expect(html).toContain('<th class="px-4 py-3 font-semibold text-slate-200 text-center">Header 2</th>');
    expect(html).toContain('<th class="px-4 py-3 font-semibold text-slate-200 text-right">Header 3</th>');
    expect(html).toContain('<strong class="font-bold text-white">Left</strong>');
    expect(html).toContain('<code class="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/60 text-emerald-300 font-mono text-xs">Center</code>');
    expect(html).toContain('href="https://example.com"');
  });

  it("handles tables with pipes in code backticks and escaped pipes", () => {
    const md = `| Tool | Description |
| --- | --- |
| \`search_mol | get_post\` | Escaped \\| pipe |`;
    const html = renderMarkdownToHtml(md);
    expect(html).toContain("<table");
    expect(html).toContain("search_mol | get_post");
    expect(html).toContain("Escaped | pipe");
  });

  it("does not render table if delimiter row is missing", () => {
    const md = `| Col A | Col B |
Not a delimiter
| Row 1 | Row 2 |`;
    const html = renderMarkdownToHtml(md);
    expect(html).not.toContain("<table");
    expect(html).toContain("<p");
  });
});
