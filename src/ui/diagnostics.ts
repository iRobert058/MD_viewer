// Rendering report for the fixture check script. Only runs when the app was
// started with MDV_DIAG_FILE set; it is written to that local file by Rust.

import { invoke } from "@tauri-apps/api/core";

function settled(img: HTMLImageElement): Promise<void> {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => resolve(), { once: true });
  });
}

export async function reportDiagnostics(
  article: HTMLElement,
  scroller: HTMLElement,
  loads: number,
): Promise<void> {
  const images = Array.from(article.querySelectorAll("img"));
  // Lazy images below the fold may never load; give them a bounded wait.
  await Promise.race([
    Promise.all(images.map(settled)),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
  const codes = Array.from(article.querySelectorAll<HTMLElement>("pre > code"));
  const coloured = article.querySelector<HTMLElement>("code.shiki span");
  const style = getComputedStyle(article);
  const report = {
    loads,
    title: document.title,
    theme: document.documentElement.dataset["theme"],
    background: getComputedStyle(document.body).backgroundColor,
    articleMaxWidth: style.maxWidth,
    articleWidthPx: Math.round(article.getBoundingClientRect().width),
    fontSize: style.fontSize,
    scrollTop: Math.round(scroller.scrollTop),
    scrollHeight: scroller.scrollHeight,
    headings: article.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
    outlineItems: document.querySelectorAll("#outline-list a").length,
    tables: article.querySelectorAll("table").length,
    taskCheckboxes: article.querySelectorAll("input[type=checkbox]").length,
    footnotes: article.querySelectorAll(".footnotes li").length,
    codeBlocks: codes.length,
    highlighted: codes.filter(
      (c) => c.dataset["highlighted"] && c.dataset["highlighted"] !== "none",
    ).length,
    tokenColour: coloured ? getComputedStyle(coloured).color : null,
    images: images.map((i) => ({
      src: i.getAttribute("src"),
      loaded: i.complete && i.naturalWidth > 0,
      width: i.naturalWidth,
    })),
    placeholders: article.querySelectorAll(".image-not-loaded").length,
    styleAttributes: article.querySelectorAll("[style]:not(code.shiki span)")
      .length,
    scriptsInDocument: article.querySelectorAll("script").length,
    pwned:
      (window as unknown as { __pwned?: boolean }).__pwned === true ||
      document.title === "PWNED",
    hidden: {
      article: article.hidden,
      empty: document.getElementById("empty")?.hidden,
      error: document.getElementById("error")?.hidden,
    },
    errorText: document.getElementById("error")?.textContent ?? "",
  };
  await invoke("report_diagnostics", { report });
}
