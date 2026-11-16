import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DARK_THEME, LIGHT_THEME } from "../src/render/highlight";

function luminance(hex: string): number {
  let h = hex.replace("#", "").slice(0, 6);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

/** Value of a custom property in the light (:root) or forced-dark block. */
function token(name: string, dark: boolean): string {
  const block = dark
    ? css.slice(css.indexOf(':root[data-theme="dark"]'))
    : css.slice(css.indexOf(":root {"));
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  if (!match?.[1]) throw new Error(`--${name} not found`);
  return match[1];
}

// Scopes that are backgrounds or editor-only states, not text in code blocks.
const IGNORED =
  /carriage-return|markup\.ignored|markup\.untracked|invalid|deprecated/;

interface ThemeJson {
  tokenColors?: {
    scope?: string | string[];
    settings?: { foreground?: string };
  }[];
}

describe("WCAG AA contrast", () => {
  for (const [dark, themeName] of [
    [false, LIGHT_THEME],
    [true, DARK_THEME],
  ] as const) {
    it(`${themeName} token colours on the code background`, async () => {
      const theme = (
        (await import(
          `../node_modules/@shikijs/themes/dist/${themeName}.mjs`
        )) as {
          default: ThemeJson;
        }
      ).default;
      const bg = token("code-bg", dark);
      const failing = (theme.tokenColors ?? [])
        .filter((t) => t.settings?.foreground)
        .filter((t) => !IGNORED.test([t.scope ?? []].flat().join(" ")))
        .map((t) => ({
          fg: t.settings?.foreground ?? "",
          ratio: contrast(t.settings?.foreground ?? "", bg),
        }))
        .filter((t) => t.ratio < 4.5);
      expect(failing).toEqual([]);
    });
  }

  for (const dark of [false, true]) {
    it(`UI text colours (${dark ? "dark" : "light"})`, () => {
      const pairs: [string, string][] = [
        ["text", "bg"],
        ["muted", "bg"],
        ["link", "bg"],
        ["muted", "sidebar-bg"],
        ["text", "code-bg"],
        ["muted", "subtle-bg"],
      ];
      for (const [fg, bg] of pairs) {
        expect(
          contrast(token(fg, dark), token(bg, dark)),
          `${fg} on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
