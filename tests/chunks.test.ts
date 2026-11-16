import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRenderer, FIRST_CHUNK_BLOCKS } from "../src/render";

const renderer = createRenderer(window);

function joined(markdown: string): { html: string; chunks: number } {
  const { first, rest } = renderer.renderChunked(markdown, "/d");
  const div = document.createElement("div");
  div.append(first);
  for (const chunk of rest) div.append(chunk());
  return { html: div.innerHTML, chunks: 1 + rest.length };
}

function full(markdown: string): string {
  const div = document.createElement("div");
  div.append(renderer.render(markdown, "/d"));
  return div.innerHTML;
}

const longDoc =
  Array.from(
    { length: 700 },
    (_, i) =>
      `## Part ${i}\n\nText ${i} with a note.[^n${i}]\n\n- a\n  - nested\n\n> quote ${i}`,
  ).join("\n\n") +
  "\n\n" +
  Array.from({ length: 700 }, (_, i) => `[^n${i}]: Footnote ${i}.`).join("\n");

describe("renderChunked", () => {
  it("produces exactly the full render when chunks are joined", () => {
    const { html, chunks } = joined(longDoc);
    expect(chunks).toBeGreaterThan(2);
    expect(html).toBe(full(longDoc));
  });

  it("keeps footnotes defined at the end of a long document", () => {
    const { html } = joined(longDoc);
    expect(html).toContain('id="user-content-fn700"');
    expect(html).not.toContain("[^n5]");
  });

  it("does not split documents with raw HTML blocks", () => {
    const src =
      "<details>\n\n" +
      Array.from(
        { length: FIRST_CHUNK_BLOCKS * 3 },
        (_, i) => `para ${i}`,
      ).join("\n\n") +
      "\n\n</details>";
    const { rest } = renderer.renderChunked(src, "/d");
    expect(rest).toHaveLength(0);
  });

  it("does not split short documents", () => {
    expect(renderer.renderChunked("# a\n\nb", "/d").rest).toHaveLength(0);
  });

  it("matches the full render for the large fixture generator's shape", () => {
    const gfm = readFileSync(
      join(process.cwd(), "tests/fixtures/gfm.md"),
      "utf8",
    );
    const doc = Array.from({ length: 30 }, () => gfm).join("\n\n");
    expect(joined(doc).html).toBe(full(doc));
  });
});
