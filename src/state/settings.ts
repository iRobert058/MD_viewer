// Settings live in Rust (one JSON file shared by all windows); this module is
// the typed client for them.

import { invoke } from "@tauri-apps/api/core";

export type Theme = "system" | "light" | "dark";

export interface Settings {
  theme: Theme;
  sidebarVisible: boolean;
  zoom: number;
}

export type SettingsPatch = Partial<Settings>;

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function setSettings(patch: SettingsPatch): Promise<void> {
  return invoke("set_settings", { patch });
}

export function applySettings(
  s: Settings,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset["theme"] = s.theme;
  root.classList.toggle("sidebar-hidden", !s.sidebarVisible);
  root.style.setProperty("--zoom", String(s.zoom));
}
