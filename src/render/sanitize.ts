// Markdown files are untrusted. Everything markdown-it produces goes through
// DOMPurify before it reaches the page, and images are rewritten so that local
// files load through `mdimg://` and remote images are not fetched at all.

import DOMPurify, { type Config, type DOMPurify as Purifier } from "dompurify";
import { classifyImage } from "./paths";

const ALIGN = /^\s*text-align\s*:\s*(left|right|center)\s*;?\s*$/i;

export function createSanitizer(win: Window & typeof globalThis): Purifier {
  const purify = DOMPurify(win);
  // Inline styles are dropped (the page CSP blocks them anyway). Table cell
  // alignment from markdown-it is kept by turning it into a class.
  purify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName !== "style") return;
    const align = ALIGN.exec(data.attrValue)?.[1];
    if (align && (node.nodeName === "TD" || node.nodeName === "TH")) {
      node.classList.add(`align-${align.toLowerCase()}`);
    }
    data.keepAttr = false;
  });
  return purify;
}

const PURIFY_CONFIG: Config & { RETURN_DOM_FRAGMENT: true } = {
  RETURN_DOM_FRAGMENT: true,
  // Prefix every id/name with "user-content-" (as GitHub does) so a heading
  // like "# Images" cannot shadow document.images or the app's own elements.
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: [
    "style",
    "form",
    "button",
    "textarea",
    "select",
    "option",
    "dialog",
    "template",
  ],
  FORBID_ATTR: ["target", "formaction", "autofocus", "tabindex"],
  // Default list minus tel/callto/sms/etc.; relative URLs stay allowed.
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|file):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

export function sanitize(purify: Purifier, html: string): DocumentFragment {
  return purify.sanitize(html, PURIFY_CONFIG);
}

/** Point local images at `mdimg://` and replace remote images with a placeholder. */
export function rewriteImages(root: ParentNode, baseDir: string): void {
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    const target = classifyImage(src, baseDir);
    switch (target.kind) {
      case "local":
        img.setAttribute("src", target.url);
        img.setAttribute("loading", "lazy");
        img.setAttribute("decoding", "async");
        break;
      case "inline":
        break;
      case "remote":
      case "blocked": {
        const doc = img.ownerDocument;
        const placeholder = doc.createElement("span");
        placeholder.className = "image-not-loaded";
        const alt = img.getAttribute("alt") ?? "";
        placeholder.textContent = alt !== "" ? alt : "Image";
        placeholder.title =
          target.kind === "remote"
            ? `Remote image not loaded (this app makes no network requests): ${target.url}`
            : "Image not loaded";
        img.replaceWith(placeholder);
        break;
      }
    }
  }
}
