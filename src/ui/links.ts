// Every link click is handled here; the web view never navigates by itself.

import { invoke } from "@tauri-apps/api/core";
import { classifyLink } from "../render/paths";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function scrollToId(id: string): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  target.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
  // Move keyboard focus too, so Tab continues from the target.
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  return true;
}

export function installLinkHandler(
  getBaseDir: () => string | null,
  onError: (msg: string) => void,
): void {
  const handle = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const anchor = target?.closest("a[href]");
    if (!anchor) return;
    event.preventDefault();
    if (event.type === "auxclick") return;
    const href = anchor.getAttribute("href") ?? "";
    const baseDir = getBaseDir();
    const link = classifyLink(href, baseDir ?? "/");
    switch (link.kind) {
      case "anchor":
        scrollToId(link.id);
        break;
      case "external":
        invoke("open_external", { url: link.url }).catch((e: unknown) =>
          onError(String(e)),
        );
        break;
      case "local":
        if (baseDir === null) return;
        invoke("open_local_link", { target: link.path }).catch((e: unknown) =>
          onError(String(e)),
        );
        break;
      case "blocked":
        break;
    }
  };
  document.addEventListener("click", handle);
  document.addEventListener("auxclick", handle);
}
