import type { MarkdownIt, Token } from "markdown-it";
import type { DOMPurify as Purifier } from "dompurify";
import { createMarkdown } from "./markdown";
import { createSanitizer, rewriteImages, sanitize } from "./sanitize";

export interface ChunkedRender {
  /** The first blocks, enough to fill the window. */
  first: DocumentFragment;
  /** The remaining blocks, rendered on demand in order. */
  rest: (() => DocumentFragment)[];
}

export interface Renderer {
  /** Markdown source to a sanitised fragment, owned by the renderer's document. */
  render(markdown: string, baseDir: string): DocumentFragment;
  /**
   * Like `render`, but split into chunks of top-level blocks so the first
   * screen can be shown before the rest of a long file is sanitised.
   * Documents with raw HTML blocks are not split (an HTML element may span
   * several blocks, and each chunk is sanitised on its own).
   */
  renderChunked(markdown: string, baseDir: string): ChunkedRender;
  /** Milliseconds spent in each step of the last render. */
  readonly lastTimings: Record<string, number>;
}

export const FIRST_CHUNK_BLOCKS = 60;
export const CHUNK_BLOCKS = 250;

/** Token indices just after each complete top-level block. */
export function blockEnds(tokens: Token[]): number[] {
  const ends: number[] = [];
  let depth = 0;
  tokens.forEach((t, i) => {
    depth += t.nesting;
    if (depth === 0) ends.push(i + 1);
  });
  return ends;
}

export function createRenderer(win: Window & typeof globalThis): Renderer {
  const md: MarkdownIt = createMarkdown();
  const purify: Purifier = createSanitizer(win);
  const lastTimings: Record<string, number> = {};

  const toFragment = (html: string, baseDir: string): DocumentFragment => {
    const fragment = sanitize(purify, html);
    rewriteImages(fragment, baseDir);
    return fragment;
  };

  return {
    lastTimings,
    render(markdown, baseDir) {
      const t0 = performance.now();
      const html = md.render(markdown);
      const t1 = performance.now();
      const fragment = toFragment(html, baseDir);
      lastTimings["parse"] = t1 - t0;
      lastTimings["sanitize"] = performance.now() - t1;
      return fragment;
    },

    renderChunked(markdown, baseDir) {
      const t0 = performance.now();
      const env = {};
      const tokens = md.parse(markdown, env);
      const ends = blockEnds(tokens);
      const hasHtmlBlocks = tokens.some((t) => t.type === "html_block");
      const renderRange = (from: number, to: number): string =>
        md.renderer.render(tokens.slice(from, to), md.options, env);

      if (hasHtmlBlocks || ends.length <= FIRST_CHUNK_BLOCKS) {
        const html = md.renderer.render(tokens, md.options, env);
        const t1 = performance.now();
        const first = toFragment(html, baseDir);
        lastTimings["parse"] = t1 - t0;
        lastTimings["sanitize"] = performance.now() - t1;
        return { first, rest: [] };
      }

      const firstEnd = ends[FIRST_CHUNK_BLOCKS - 1] ?? tokens.length;
      const t1 = performance.now();
      const first = toFragment(renderRange(0, firstEnd), baseDir);
      lastTimings["parse"] = t1 - t0;
      lastTimings["sanitize"] = performance.now() - t1;

      const rest: (() => DocumentFragment)[] = [];
      for (let b = FIRST_CHUNK_BLOCKS; b < ends.length; b += CHUNK_BLOCKS) {
        const from = ends[b - 1] ?? 0;
        const to =
          ends[Math.min(b + CHUNK_BLOCKS, ends.length) - 1] ?? tokens.length;
        rest.push(() => toFragment(renderRange(from, to), baseDir));
      }
      return { first, rest };
    },
  };
}
