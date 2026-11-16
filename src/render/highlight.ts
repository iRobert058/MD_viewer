// Syntax highlighting with Shiki, loaded only when a document has code blocks.
//
// The page first shows code as plain text; this module then colours it in.
// Shiki, its JS regex engine, the two themes and each language grammar are
// separate chunks, fetched from inside the app bundle on first use.
// Colours are applied through the CSSOM (not inline style attributes), which
// the page's Content-Security-Policy allows.

import type { HighlighterCore, ThemedToken } from "shiki/core";

let highlighter: Promise<HighlighterCore> | null = null;
let languages: Promise<typeof import("shiki/langs")> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [
      { createHighlighterCore },
      { createJavaScriptRegexEngine },
      { bundledThemes },
    ] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("shiki/themes"),
    ]);
    return createHighlighterCore({
      themes: [bundledThemes["github-light"](), bundledThemes["github-dark"]()],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighter;
}

function getLanguages(): Promise<typeof import("shiki/langs")> {
  languages ??= import("shiki/langs");
  return languages;
}

export function languageOf(code: Element): string | null {
  const match = /(?:^|\s)language-([^\s]+)/.exec(code.className);
  return match?.[1]?.toLowerCase() ?? null;
}

async function resolveLanguage(name: string): Promise<string | null> {
  const { bundledLanguagesInfo } = await getLanguages();
  const info = bundledLanguagesInfo.find(
    (l) => l.id === name || l.aliases?.includes(name),
  );
  return info?.id ?? null;
}

function tokensToDom(doc: Document, lines: ThemedToken[][]): DocumentFragment {
  const out = doc.createDocumentFragment();
  lines.forEach((line, i) => {
    if (i > 0) out.append("\n");
    for (const token of line) {
      const span = doc.createElement("span");
      span.textContent = token.content;
      for (const [prop, value] of Object.entries(token.htmlStyle ?? {})) {
        span.style.setProperty(prop, value);
      }
      out.append(span);
    }
  });
  return out;
}

const yieldToBrowser = (): Promise<void> =>
  new Promise((r) => setTimeout(r, 0));

/** Highlight every not-yet-highlighted fenced code block under `root`. */
export async function highlightAll(root: ParentNode): Promise<void> {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>(
      'pre > code[class*="language-"]:not([data-highlighted])',
    ),
  );
  if (blocks.length === 0) return;
  const hl = await getHighlighter();
  const { bundledLanguages } = await getLanguages();

  for (const code of blocks) {
    // The element may have been replaced by a live reload in the meantime.
    if (!code.isConnected) continue;
    const name = languageOf(code);
    const lang = name === null ? null : await resolveLanguage(name);
    if (lang === null) {
      code.dataset["highlighted"] = "none";
      continue;
    }
    if (!hl.getLoadedLanguages().includes(lang)) {
      const loader = bundledLanguages[lang as keyof typeof bundledLanguages];
      await hl.loadLanguage(loader());
    }
    const text = code.textContent ?? "";
    const tokens = hl.codeToTokens(text.replace(/\n$/, ""), {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
    code.replaceChildren(tokensToDom(code.ownerDocument, tokens.tokens));
    code.dataset["highlighted"] = lang;
    code.classList.add("shiki");
    await yieldToBrowser();
  }
}
