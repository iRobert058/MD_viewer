import { describe, expect, it } from "vitest";
import {
  classifyImage,
  classifyLink,
  isMarkdownPath,
  localImageUrl,
  resolvePath,
} from "../src/render/paths";

const BASE = "/Users/r/notes";

describe("resolvePath", () => {
  it("joins and normalises", () => {
    expect(resolvePath(BASE, "a.md")).toBe("/Users/r/notes/a.md");
    expect(resolvePath(BASE, "./sub/../a.md")).toBe("/Users/r/notes/a.md");
    expect(resolvePath(BASE, "../x/a.md")).toBe("/Users/r/x/a.md");
    expect(resolvePath(BASE, "/abs/a.md")).toBe("/abs/a.md");
    expect(resolvePath("/", "../../a.md")).toBe("/a.md");
  });
});

describe("classifyLink", () => {
  it("in-page anchors", () => {
    expect(classifyLink("#intro", BASE)).toEqual({
      kind: "anchor",
      id: "intro",
    });
    expect(classifyLink("#caf%C3%A9", BASE)).toEqual({
      kind: "anchor",
      id: "café",
    });
  });

  it("external links", () => {
    expect(classifyLink("https://example.com/a?b#c", BASE)).toEqual({
      kind: "external",
      url: "https://example.com/a?b#c",
    });
    expect(classifyLink("mailto:a@b.c", BASE).kind).toBe("external");
    expect(classifyLink("//example.com", BASE)).toEqual({
      kind: "external",
      url: "https://example.com",
    });
  });

  it("relative files, with spaces, non-ASCII, fragments and queries", () => {
    expect(classifyLink("other.md", BASE)).toEqual({
      kind: "local",
      path: "/Users/r/notes/other.md",
      fragment: "",
    });
    expect(
      classifyLink("folder%20with%20spaces/na%C3%AFve.md#part-2", BASE),
    ).toEqual({
      kind: "local",
      path: "/Users/r/notes/folder with spaces/naïve.md",
      fragment: "part-2",
    });
    expect(classifyLink("a.md?x=1", BASE)).toEqual({
      kind: "local",
      path: "/Users/r/notes/a.md",
      fragment: "",
    });
  });

  it("keeps a literal % that is not percent-encoding", () => {
    expect(classifyLink("100%.md", BASE)).toMatchObject({
      path: "/Users/r/notes/100%.md",
    });
  });

  it("file: URLs", () => {
    expect(classifyLink("file:///Users/r/a%20b.md", BASE)).toEqual({
      kind: "local",
      path: "/Users/r/a b.md",
      fragment: "",
    });
  });

  it("blocks other schemes", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "tauri://x",
      "ipc://x",
      "",
    ]) {
      expect(classifyLink(href, BASE)).toEqual({ kind: "blocked" });
    }
  });
});

describe("classifyImage", () => {
  it("local images become mdimg URLs", () => {
    expect(classifyImage("img/a b.png", BASE)).toEqual({
      kind: "local",
      path: "/Users/r/notes/img/a b.png",
      url: "mdimg://localhost/Users/r/notes/img/a%20b.png",
    });
  });

  it("remote and other schemes are not loaded", () => {
    expect(classifyImage("https://x.com/a.png", BASE).kind).toBe("remote");
    expect(classifyImage("//x.com/a.png", BASE).kind).toBe("remote");
    expect(classifyImage("javascript:x", BASE).kind).toBe("blocked");
    expect(classifyImage("data:image/png;base64,AA", BASE).kind).toBe("inline");
  });
});

describe("helpers", () => {
  it("isMarkdownPath", () => {
    expect(isMarkdownPath("/a/b.MD")).toBe(true);
    expect(isMarkdownPath("/a/b.mkd")).toBe(true);
    expect(isMarkdownPath("/a/b.txt")).toBe(false);
  });

  it("localImageUrl encodes reserved characters", () => {
    expect(localImageUrl("/a/#1?.png")).toBe("mdimg://localhost/a/%231%3F.png");
  });
});
