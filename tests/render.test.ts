import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRenderer } from "../src/render";
import { createMarkdown, Slugger } from "../src/render/markdown";

const renderer = createRenderer(window);
const fixture = (name: string): string =>
  join(process.cwd(), "tests/fixtures", name);
const BASE = "/Users/r/notes";

function html(markdown: string, baseDir = BASE): string {
  const div = document.createElement("div");
  div.append(renderer.render(markdown, baseDir));
  return div.innerHTML.trim();
}

function dom(markdown: string, baseDir = BASE): HTMLDivElement {
  const div = document.createElement("div");
  div.append(renderer.render(markdown, baseDir));
  return div;
}

describe("GitHub Flavored Markdown", () => {
  it("renders headings with GitHub-style ids", () => {
    expect(html("# Hello World")).toBe(
      '<h1 id="user-content-hello-world">Hello World</h1>',
    );
    expect(html("## What's `new`?")).toBe(
      '<h2 id="user-content-whats-new">What\'s <code>new</code>?</h2>',
    );
  });

  it("de-duplicates heading ids", () => {
    const ids = Array.from(dom("# A\n\n# A\n\n# A").querySelectorAll("h1")).map(
      (h) => h.id,
    );
    expect(ids).toEqual([
      "user-content-a",
      "user-content-a-1",
      "user-content-a-2",
    ]);
  });

  it("renders tables with alignment as classes, not inline styles", () => {
    const out = html("| L | C | R |\n|:--|:-:|--:|\n| a | b | c |");
    expect(out).toContain('<th class="align-left">L</th>');
    expect(out).toContain('<th class="align-center">C</th>');
    expect(out).toContain('<td class="align-right">c</td>');
    expect(out).not.toContain("style=");
  });

  it("renders task lists with disabled checkboxes", () => {
    const d = dom("- [x] done\n- [ ] open\n- plain");
    const list = d.querySelector("ul");
    expect(list?.className).toBe("contains-task-list");
    const boxes = Array.from(
      d.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
    );
    expect(boxes).toHaveLength(2);
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    expect(boxes.every((b) => b.disabled)).toBe(true);
    expect(d.querySelectorAll("li.task-list-item")).toHaveLength(2);
    expect(d.querySelector("li:not(.task-list-item)")?.textContent).toBe(
      "plain",
    );
  });

  it("renders strikethrough", () => {
    expect(html("~~gone~~")).toBe("<p><s>gone</s></p>");
  });

  it("autolinks bare URLs", () => {
    expect(html("see https://example.com now")).toBe(
      '<p>see <a href="https://example.com">https://example.com</a> now</p>',
    );
  });

  it("renders footnotes", () => {
    const d = dom("Claim.[^1]\n\n[^1]: Source.");
    expect(d.querySelector("sup.footnote-ref a")?.getAttribute("href")).toBe(
      "#fn1",
    );
    expect(
      d.querySelector("section.footnotes li#user-content-fn1")?.textContent,
    ).toContain("Source.");
  });

  it("renders fenced code with a language class for the highlighter", () => {
    expect(html("```ts\nconst a = 1;\n```")).toBe(
      '<pre><code class="language-ts">const a = 1;\n</code></pre>',
    );
  });

  it("renders the GFM fixture without throwing", () => {
    const src = readFileSync(fixture("gfm.md"), "utf8");
    const d = dom(src);
    expect(d.querySelectorAll("table")).toHaveLength(1);
    expect(d.querySelectorAll("pre > code")).toHaveLength(5);
  });
});

describe("ids that would clash with DOM properties", () => {
  it("keeps heading ids such as 'images' and 'links' (prefixed)", () => {
    const ids = Array.from(
      dom("# Images\n\n# Links\n\n# Error").querySelectorAll("h1"),
    ).map((h) => h.id);
    expect(ids).toEqual([
      "user-content-images",
      "user-content-links",
      "user-content-error",
    ]);
  });

  it("prefixes ids written in raw HTML too", () => {
    expect(dom('<div id="find-input">x</div>').querySelector("div")?.id).toBe(
      "user-content-find-input",
    );
  });
});

describe("Slugger", () => {
  it("handles non-ASCII and punctuation", () => {
    const s = new Slugger();
    expect(s.slug("Naïve café!")).toBe("naïve-café");
    expect(s.slug("日本語")).toBe("日本語");
    expect(s.slug("  ")).toBe("section");
  });

  it("does not collide with an existing -1 heading", () => {
    const s = new Slugger();
    expect([s.slug("a-1"), s.slug("a"), s.slug("a")]).toEqual([
      "a-1",
      "a",
      "a-2",
    ]);
  });
});

describe("sanitising untrusted HTML", () => {
  it("removes <script> elements", () => {
    const out = html("<script>window.__pwned = true</script>\n\ntext");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("__pwned");
  });

  it("removes event handler attributes such as onerror=", () => {
    const out = html('<img src="x.png" onerror="window.__pwned = true">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("__pwned");
  });

  it("neutralises javascript: links written in Markdown", () => {
    const d = dom("[x](javascript:alert(1))");
    expect(d.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("neutralises javascript: links written as raw HTML", () => {
    const d = dom(
      '<a href="javascript:alert(1)">x</a> <a href="JaVaScRiPt:alert(1)">y</a>',
    );
    for (const a of Array.from(d.querySelectorAll("a"))) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/javascript/i);
    }
  });

  it("removes scripts inside SVG, iframes, forms and style attributes", () => {
    const out = html(
      '<svg><script>x()</script></svg><iframe src="https://e.com"></iframe>' +
        '<form action="https://e.com"><button>b</button></form><div style="color:red">d</div>',
    );
    expect(out).not.toMatch(/<script|<iframe|<form|<button|style=/);
  });

  it("neutralises everything in the XSS fixture", () => {
    const src = readFileSync(fixture("xss.md"), "utf8");
    const out = html(src);
    expect(out).not.toMatch(
      /<script|onerror|href="\s*javascript:|<iframe|<form|style=/i,
    );
    // The Markdown-syntax javascript: link is left as inert text, not a link.
    expect(out).toContain("<p>[javascript link](javascript:alert(1))</p>");
    expect(out).toContain("<details>");
  });
});

describe("images", () => {
  it("loads relative images through mdimg:// with the path encoded", () => {
    const img = dom(
      "![x](images/my pic.png)".replace(" ", "%20"),
      "/Users/r/My Notes",
    ).querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      "mdimg://localhost/Users/r/My%20Notes/images/my%20pic.png",
    );
  });

  it("resolves ../ against the document folder", () => {
    const img = dom("![x](../img/a.png)", "/Users/r/notes/sub").querySelector(
      "img",
    );
    expect(img?.getAttribute("src")).toBe(
      "mdimg://localhost/Users/r/notes/img/a.png",
    );
  });

  it("does not load remote images", () => {
    const d = dom("![Badge](https://example.com/badge.svg)");
    expect(d.querySelector("img")).toBeNull();
    const placeholder = d.querySelector(".image-not-loaded");
    expect(placeholder?.textContent).toBe("Badge");
    expect(placeholder?.getAttribute("title")).toContain(
      "https://example.com/badge.svg",
    );
  });

  it("keeps data: images", () => {
    const d = dom('<img src="data:image/png;base64,iVBORw0KGgo=" alt="d">');
    expect(d.querySelector("img")?.getAttribute("src")).toMatch(
      /^data:image\/png/,
    );
  });
});

describe("markdown-it configuration", () => {
  it("allows raw HTML (then sanitised) and linkify", () => {
    const md = createMarkdown();
    expect(md.options.html).toBe(true);
    expect(md.options.linkify).toBe(true);
  });
});
