import { describe, expect, it } from "vitest";
import { createRenderer } from "../src/render";
import { reconcile } from "../src/render/reconcile";
import { findMatches } from "../src/ui/find";
import { collectHeadings } from "../src/ui/outline";

const renderer = createRenderer(window);

describe("reconcile (live reload)", () => {
  it("keeps unchanged blocks and replaces changed ones", () => {
    const article = document.createElement("article");
    reconcile(
      article,
      renderer.render("# Title\n\nOne\n\nTwo\n\n![i](a.png)", "/d"),
    );
    const [h1, p1, , pImg] = Array.from(article.children);

    const result = reconcile(
      article,
      renderer.render("# Title\n\nOne changed\n\nTwo\n\n![i](a.png)", "/d"),
    );
    const after = Array.from(article.children);
    expect(result).toEqual({ kept: 3, added: 1 });
    expect(after[0]).toBe(h1);
    expect(after[1]).not.toBe(p1);
    expect(after[1]?.textContent).toBe("One changed");
    expect(after[3]).toBe(pImg);
  });

  it("handles inserted and removed blocks", () => {
    const article = document.createElement("article");
    reconcile(article, renderer.render("A\n\nB\n\nC", "/d"));
    reconcile(article, renderer.render("A\n\nNew\n\nC", "/d"));
    expect(Array.from(article.children).map((c) => c.textContent)).toEqual([
      "A",
      "New",
      "C",
    ]);
    reconcile(article, renderer.render("C", "/d"));
    expect(Array.from(article.children).map((c) => c.textContent)).toEqual([
      "C",
    ]);
  });

  it("keeps a highlighted code block when its source did not change", () => {
    const article = document.createElement("article");
    reconcile(article, renderer.render("```js\nx\n```\n\npara", "/d"));
    const code = article.querySelector("code");
    if (!code) throw new Error("no code");
    code.dataset["highlighted"] = "javascript";
    reconcile(article, renderer.render("```js\nx\n```\n\npara edited", "/d"));
    expect(article.querySelector("code")).toBe(code);
    expect(article.querySelector("code")?.dataset["highlighted"]).toBe(
      "javascript",
    );
  });
});

describe("findMatches", () => {
  it("finds case-insensitive matches across text nodes", () => {
    const root = document.createElement("div");
    root.append(renderer.render("Apple pie and **apple** juice. APPLE!", "/d"));
    const ranges = findMatches(root, "apple");
    expect(ranges).toHaveLength(3);
    expect(ranges.map((r) => r.toString())).toEqual([
      "Apple",
      "apple",
      "APPLE",
    ]);
  });

  it("returns nothing for an empty query", () => {
    const root = document.createElement("div");
    root.textContent = "abc";
    expect(findMatches(root, "")).toEqual([]);
  });

  it("finds overlapping-free repeated matches", () => {
    const root = document.createElement("div");
    root.textContent = "aaaa";
    expect(findMatches(root, "aa")).toHaveLength(2);
  });
});

describe("collectHeadings", () => {
  it("lists headings with levels, skipping footnotes", () => {
    const root = document.createElement("div");
    root.append(
      renderer.render(
        "# One\n\n## Two\n\n### Three\n\nx[^1]\n\n[^1]: note",
        "/d",
      ),
    );
    expect(collectHeadings(root)).toEqual([
      { id: "user-content-one", text: "One", level: 1 },
      { id: "user-content-two", text: "Two", level: 2 },
      { id: "user-content-three", text: "Three", level: 3 },
    ]);
  });
});

describe("scrollToId", () => {
  it("only reaches document ids, not the app's own elements", async () => {
    const { scrollToId } = await import("../src/ui/links");
    // jsdom has neither scrollIntoView nor matchMedia.
    Element.prototype.scrollIntoView = function () {};
    window.matchMedia = (() => ({
      matches: false,
    })) as unknown as typeof window.matchMedia;
    document.body.innerHTML =
      '<input id="find-input"><h2 id="user-content-second">x</h2>';
    expect(scrollToId("second")).toBe(true);
    expect(document.activeElement?.id).toBe("user-content-second");
    expect(scrollToId("user-content-second")).toBe(true);
    expect(scrollToId("find-input")).toBe(false);
  });
});
