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
});
