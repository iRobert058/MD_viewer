import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { createRenderer } from "./render";
import { reconcile } from "./render/reconcile";
import { reportDiagnostics } from "./ui/diagnostics";
import { FindBar } from "./ui/find";
import { installLinkHandler } from "./ui/links";
import { Outline } from "./ui/outline";
import {
  applySettings,
  getSettings,
  setSettings,
  type Settings,
  type Theme,
} from "./state/settings";

interface DocumentPayload {
  path: string;
  name: string;
  dir: string;
  content: string;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id} in index.html`);
  return el as T;
}

const article = byId<HTMLElement>("doc");
const scroller = byId<HTMLElement>("scroller");
const empty = byId<HTMLElement>("empty");
const errorBox = byId<HTMLElement>("error");
const settingsDialog = byId<HTMLDialogElement>("settings-dialog");
const helpDialog = byId<HTMLDialogElement>("help-dialog");

const renderer = createRenderer(window);
const outline = new Outline(
  byId("outline"),
  byId("outline-list"),
  article,
  scroller,
);
const find = new FindBar(
  {
    bar: byId("findbar"),
    input: byId("find-input"),
    status: byId("find-status"),
    prev: byId("find-prev"),
    next: byId("find-next"),
    close: byId("find-close"),
  },
  article,
  scroller,
);

let current: DocumentPayload | null = null;
let pendingHighlight: Promise<void> = Promise.resolve();
let diagnostics = false;
let loads = 0;
let settings: Settings | null = null;

function show(which: "doc" | "empty" | "error"): void {
  article.hidden = which !== "doc";
  empty.hidden = which !== "empty";
  errorBox.hidden = which !== "error";
}

function showError(message: string): void {
  errorBox.textContent = message;
  show("error");
}

async function highlight(): Promise<void> {
  if (!article.querySelector('pre > code[class*="language-"]')) return;
  const { highlightAll } = await import("./render/highlight");
  await highlightAll(article);
}

/** Load, then (only under the test scripts) report what was rendered. */
async function loadAndReport(): Promise<void> {
  await load();
  loads++;
  if (!diagnostics) return;
  await pendingHighlight;
  await reportDiagnostics(article, scroller, loads);
}

/** Load (or reload) this window's document and render it. */
async function load(): Promise<void> {
  let doc: DocumentPayload | null;
  try {
    doc = await invoke<DocumentPayload | null>("load_document");
  } catch (e) {
    showError(`This file could not be read.\n${String(e)}`);
    return;
  }
  if (doc === null) {
    current = null;
    article.replaceChildren();
    outline.clear();
    document.title = "Markdown Viewer";
    show("empty");
    return;
  }
  const sameFile = current?.path === doc.path;
  current = doc;
  document.title = doc.name;

  const scrollTop = scroller.scrollTop;
  const fragment = renderer.render(doc.content, doc.dir);
  if (!sameFile) article.replaceChildren();
  reconcile(article, fragment);
  show("doc");
  scroller.scrollTop = sameFile ? scrollTop : 0;

  outline.rebuild();
  find.refresh();
  pendingHighlight = highlight().catch((e: unknown) =>
    console.error("highlighting failed", e),
  );
}

function toggleSidebar(): void {
  if (!settings) return;
  setSettings({ sidebarVisible: !settings.sidebarVisible }).catch(reportError);
}

function openSettings(): void {
  if (!settings) return;
  const form = settingsDialog.querySelector("form");
  if (!form) return;
  for (const radio of Array.from(
    form.querySelectorAll<HTMLInputElement>('input[name="theme"]'),
  )) {
    radio.checked = radio.value === settings.theme;
  }
  const sidebar = form.querySelector<HTMLInputElement>('input[name="sidebar"]');
  if (sidebar) sidebar.checked = settings.sidebarVisible;
  settingsDialog.showModal();
}

settingsDialog.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.name === "theme")
    setSettings({ theme: input.value as Theme }).catch(reportError);
  if (input.name === "sidebar")
    setSettings({ sidebarVisible: input.checked }).catch(reportError);
});

function reportError(e: unknown): void {
  console.error(e);
}

function onMenu(action: string): void {
  switch (action) {
    case "find":
      if (current) find.open();
      break;
    case "find-next":
      if (current) find.step(1);
      break;
    case "find-prev":
      if (current) find.step(-1);
      break;
    case "toggle-sidebar":
      toggleSidebar();
      break;
    case "settings":
      openSettings();
      break;
    case "help-default":
      helpDialog.showModal();
      break;
    default:
      console.warn("unknown menu action", action);
  }
}

async function start(): Promise<void> {
  const started = performance.now();
  const win = getCurrentWebviewWindow();

  settings = await getSettings();
  applySettings(settings);

  await win.listen<Settings>("settings-changed", (e) => {
    settings = e.payload;
    applySettings(e.payload);
  });
  await win.listen("document-changed", () => {
    loadAndReport().catch(reportError);
  });
  await win.listen<string>("menu", (e) => onMenu(e.payload));
  await win.onDragDropEvent((e) => {
    document.documentElement.classList.toggle(
      "drag-over",
      e.payload.type === "enter" || e.payload.type === "over",
    );
  });

  installLinkHandler(
    () => current?.dir ?? null,
    (msg) => console.error(msg),
  );

  diagnostics = await invoke<boolean>("diagnostics_enabled");
  await load();
  loads++;
  // The DOM now holds the content, so the window can be shown. Do not wait
  // for requestAnimationFrame: WebKit does not run frames for a hidden window.
  await invoke("frontend_ready", { renderMs: performance.now() - started });
  if (diagnostics) {
    await pendingHighlight;
    await reportDiagnostics(article, scroller, loads);
  }
}

start().catch((e: unknown) => {
  showError(`Markdown Viewer could not start.\n${String(e)}`);
  invoke("frontend_ready", { renderMs: null }).catch(reportError);
});
