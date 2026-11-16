import type { MarkdownIt } from "markdown-it";
import type { DOMPurify as Purifier } from "dompurify";
import { createMarkdown } from "./markdown";
import { createSanitizer, rewriteImages, sanitize } from "./sanitize";

export interface Renderer {
  /** Markdown source to a sanitised fragment, owned by the renderer's document. */
  render(markdown: string, baseDir: string): DocumentFragment;
}

export function createRenderer(win: Window & typeof globalThis): Renderer {
  const md: MarkdownIt = createMarkdown();
  const purify: Purifier = createSanitizer(win);
  return {
    render(markdown, baseDir) {
      const fragment = sanitize(purify, md.render(markdown));
      rewriteImages(fragment, baseDir);
      return fragment;
    },
  };
}
