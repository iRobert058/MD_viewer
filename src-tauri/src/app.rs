//! App state, window management and the commands the frontend may call.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::documents::{Docs, OpenAction, is_markdown};
use crate::menu::MenuHandles;
use crate::platform;
use crate::settings::{self, Settings, SettingsPatch, Theme};
use crate::watcher::{self, FileWatcher};

pub const EVENT_DOCUMENT_CHANGED: &str = "document-changed";
pub const EVENT_SETTINGS_CHANGED: &str = "settings-changed";
pub const EVENT_MENU: &str = "menu";

/// Set at process start, used for the launch-time measurement.
pub static PROCESS_START: OnceLock<Instant> = OnceLock::new();

/// Managed on the builder, before `setup` runs: on a cold launch macOS can
/// deliver the open-document event before setup, and it needs this state.
#[derive(Default)]
pub struct AppState {
    pub docs: Mutex<Docs>,
    pub watchers: Mutex<HashMap<String, FileWatcher>>,
    pub settings: Mutex<Settings>,
    /// Set in `setup` once the config folder is known.
    pub settings_path: OnceLock<PathBuf>,
    pub menu: Mutex<Option<MenuHandles>>,
}

/// Lock a mutex, recovering from poisoning (a panic elsewhere must not take the
/// whole app down; the data inside is still consistent for our uses).
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    /// Load settings from disk. Called once from `setup`.
    pub fn init_settings(&self, path: PathBuf) {
        *lock(&self.settings) = settings::load(&path);
        if self.settings_path.set(path).is_err() {
            eprintln!("settings: init_settings called twice; keeping the first path");
        }
    }

    pub fn save_settings(&self) {
        let Some(path) = self.settings_path.get() else {
            eprintln!("settings: not saved, settings were never loaded");
            return;
        };
        let s = lock(&self.settings).clone();
        if let Err(e) = settings::save(path, &s) {
            eprintln!("settings: could not save {}: {e}", path.display());
        }
    }
}

// ---------------------------------------------------------------------------
// Opening files

pub fn open_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    for p in paths {
        open_path(app, &p);
    }
}

pub fn open_path(app: &AppHandle, path: &Path) {
    let path = match std::fs::canonicalize(path) {
        Ok(p) => p,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                forget_recent(app, path);
            }
            show_error(
                app,
                &format!("“{}” could not be opened.", display_name(path)),
                &e.to_string(),
            );
            return;
        }
    };
    if !path.is_file() {
        show_error(
            app,
            &format!("“{}” is not a file.", display_name(&path)),
            "Markdown Viewer opens Markdown files, not folders.",
        );
        return;
    }

    let state = app.state::<AppState>();
    let action = {
        let mut docs = lock(&state.docs);
        if !docs.ready {
            // Cold launch: the open event came before the app finished starting.
            docs.pending.push(path);
            return;
        }
        docs.plan_open(&path)
    };

    match action {
        OpenAction::Focus(label) => focus_window(app, &label),
        OpenAction::Reuse(label) => {
            start_watching(app, &label, &path);
            set_window_document(app, &label, Some(&path));
            if let Err(e) = app.emit_to(&label, EVENT_DOCUMENT_CHANGED, ()) {
                eprintln!("emit to {label}: {e}");
            }
            focus_window(app, &label);
        }
        OpenAction::Create(label) => {
            if let Err(e) = create_window(app, &label, Some(&path)) {
                lock(&state.docs).remove(&label);
                show_error(app, "Could not open a new window.", &e.to_string());
                return;
            }
            start_watching(app, &label, &path);
        }
    }
    remember_recent(app, &path);
}

/// Focus the most recently focused window, or open an empty one if none exist.
pub fn bring_to_front(app: &AppHandle) {
    let label = lock(&app.state::<AppState>().docs).focused.clone();
    let label = label.or_else(|| app.webview_windows().keys().next().cloned());
    match label {
        Some(l) => focus_window(app, &l),
        None => open_empty_window(app),
    }
}

pub fn open_empty_window(app: &AppHandle) {
    let state = app.state::<AppState>();
    let label = lock(&state.docs).new_empty();
    if let Err(e) = create_window(app, &label, None) {
        lock(&state.docs).remove(&label);
        eprintln!("could not create window: {e}");
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn create_window(app: &AppHandle, label: &str, path: Option<&Path>) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let (w, h, theme) = {
        let s = lock(&state.settings);
        (s.window_width, s.window_height, s.theme)
    };
    let title = path
        .map(display_name)
        .unwrap_or_else(|| "Markdown Viewer".into());

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(&title)
        .inner_size(w, h)
        .min_inner_size(360.0, 240.0)
        .theme(native_theme(theme))
        // Shown by the frontend once the first render is done, so there is no
        // white flash before the content appears.
        .visible(false);

    // Cascade from the focused window, like other Mac apps.
    let focused = lock(&state.docs).focused.clone();
    let cascade_from = focused.and_then(|l| app.get_webview_window(&l));
    match cascade_from.and_then(|w| {
        let scale = w.scale_factor().ok()?;
        w.outer_position().ok().map(|p| p.to_logical::<f64>(scale))
    }) {
        Some(pos) => builder = builder.position(pos.x + 24.0, pos.y + 24.0),
        None => builder = builder.center(),
    }

    let window = builder.build()?;
    set_represented_file(app, &window, path);

    // If the frontend never reports in (a bug), show the window anyway after a
    // second so the user is not left with an invisible window.
    let w = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        if !w.is_visible().unwrap_or(true) {
            eprintln!(
                "window {} did not report ready in time; showing it",
                w.label()
            );
            if let Err(e) = w.show() {
                eprintln!("show {}: {e}", w.label());
            }
        }
    });
    Ok(())
}

fn native_theme(theme: Theme) -> Option<tauri::Theme> {
    match theme {
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    }
}

fn set_window_document(app: &AppHandle, label: &str, path: Option<&Path>) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let title = path
        .map(display_name)
        .unwrap_or_else(|| "Markdown Viewer".into());
    if let Err(e) = window.set_title(&title) {
        eprintln!("set_title {label}: {e}");
    }
    set_represented_file(app, &window, path);
}

fn set_represented_file(app: &AppHandle, window: &WebviewWindow, path: Option<&Path>) {
    let window = window.clone();
    let path = path.map(Path::to_path_buf);
    let result = app.run_on_main_thread(move || match window.ns_window() {
        // SAFETY: the pointer comes from a live Tauri window and we are on the main thread.
        Ok(ptr) => unsafe { platform::set_represented_file(ptr, path.as_deref()) },
        Err(e) => eprintln!("ns_window: {e}"),
    });
    if let Err(e) = result {
        eprintln!("run_on_main_thread: {e}");
    }
}

fn focus_window(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.unminimize().map_err(|e| eprintln!("unminimize: {e}"));
        let _ = w.show().map_err(|e| eprintln!("show: {e}"));
        let _ = w.set_focus().map_err(|e| eprintln!("set_focus: {e}"));
    }
}

fn start_watching(app: &AppHandle, label: &str, path: &Path) {
    let handle = app.clone();
    let target = label.to_string();
    match watcher::watch(path, move || {
        if let Err(e) = handle.emit_to(&target, EVENT_DOCUMENT_CHANGED, ()) {
            eprintln!("emit to {target}: {e}");
        }
    }) {
        Ok(w) => {
            lock(&app.state::<AppState>().watchers).insert(label.to_string(), w);
        }
        // Not fatal: the document still shows, it just will not live-reload.
        Err(e) => eprintln!("cannot watch {}: {e}", path.display()),
    }
}

pub fn window_destroyed(app: &AppHandle, label: &str) {
    let state = app.state::<AppState>();
    lock(&state.docs).remove(label);
    lock(&state.watchers).remove(label);
    state.save_settings();
}

pub fn window_resized(app: &AppHandle, label: &str) {
    let Some(w) = app.get_webview_window(label) else {
        return;
    };
    // Ignore full-screen and zoomed sizes; remember the user's own window size.
    if w.is_fullscreen().unwrap_or(false) || w.is_maximized().unwrap_or(false) {
        return;
    }
    let (Ok(size), Ok(scale)) = (w.inner_size(), w.scale_factor()) else {
        return;
    };
    let size = size.to_logical::<f64>(scale);
    let state = app.state::<AppState>();
    let mut s = lock(&state.settings);
    s.window_width = size.width;
    s.window_height = size.height;
}

// ---------------------------------------------------------------------------
// Recent files

fn remember_recent(app: &AppHandle, path: &Path) {
    let state = app.state::<AppState>();
    lock(&state.settings).add_recent(path);
    refresh_recent_menu(app);
    state.save_settings();
    let p = path.to_path_buf();
    if let Err(e) = app.run_on_main_thread(move || platform::note_recent_document(&p)) {
        eprintln!("run_on_main_thread: {e}");
    }
}

fn forget_recent(app: &AppHandle, path: &Path) {
    let state = app.state::<AppState>();
    lock(&state.settings).remove_recent(path);
    refresh_recent_menu(app);
    state.save_settings();
}

pub fn clear_recent(app: &AppHandle) {
    let state = app.state::<AppState>();
    lock(&state.settings).recent_files.clear();
    refresh_recent_menu(app);
    state.save_settings();
}

pub fn open_recent(app: &AppHandle, index: usize) {
    let path = lock(&app.state::<AppState>().settings)
        .recent_files
        .get(index)
        .cloned();
    if let Some(p) = path {
        open_path(app, &p);
    }
}

fn refresh_recent_menu(app: &AppHandle) {
    let state = app.state::<AppState>();
    let recent = lock(&state.settings).recent_files.clone();
    if let Some(menu) = lock(&state.menu).as_ref()
        && let Err(e) = menu.set_recent(app, &recent)
    {
        eprintln!("menu: could not rebuild Open Recent: {e}");
    }
}

// ---------------------------------------------------------------------------
// Settings

pub fn update_settings(app: &AppHandle, patch: SettingsPatch) {
    let state = app.state::<AppState>();
    let new_theme = patch.theme;
    let snapshot = {
        let mut s = lock(&state.settings);
        s.apply(patch);
        s.clone()
    };
    if let Some(theme) = new_theme {
        if let Some(menu) = lock(&state.menu).as_ref()
            && let Err(e) = menu.set_theme(theme)
        {
            eprintln!("menu: {e}");
        }
        for w in app.webview_windows().values() {
            if let Err(e) = w.set_theme(native_theme(theme)) {
                eprintln!("set_theme: {e}");
            }
        }
    }
    state.save_settings();
    if let Err(e) = app.emit(EVENT_SETTINGS_CHANGED, FrontendSettings::from(&snapshot)) {
        eprintln!("emit settings: {e}");
    }
}

pub fn step_zoom(app: &AppHandle, delta: Option<f64>) {
    let current = lock(&app.state::<AppState>().settings).zoom;
    let zoom = match delta {
        Some(d) => current + d,
        None => 1.0,
    };
    update_settings(
        app,
        SettingsPatch {
            zoom: Some(zoom),
            ..Default::default()
        },
    );
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FrontendSettings {
    theme: Theme,
    sidebar_visible: bool,
    zoom: f64,
}

impl From<&Settings> for FrontendSettings {
    fn from(s: &Settings) -> Self {
        Self {
            theme: s.theme,
            sidebar_visible: s.sidebar_visible,
            zoom: s.zoom,
        }
    }
}

// ---------------------------------------------------------------------------
// Dialogs and menu actions

pub fn show_error(app: &AppHandle, message: &str, detail: &str) {
    eprintln!("{message} {detail}");
    app.dialog()
        .message(detail)
        .title(message)
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

pub fn show_open_dialog(app: &AppHandle) {
    let handle = app.clone();
    app.dialog()
        .file()
        .add_filter("Markdown", crate::documents::MARKDOWN_EXTENSIONS)
        .pick_files(move |files| {
            let Some(files) = files else { return };
            let paths: Vec<PathBuf> = files
                .into_iter()
                .filter_map(|f| match f.into_path() {
                    Ok(p) => Some(p),
                    Err(e) => {
                        eprintln!("open dialog returned a non-path: {e}");
                        None
                    }
                })
                .collect();
            open_paths(&handle, paths);
        });
}

pub fn make_default(app: &AppHandle) {
    let handle = app.clone();
    let result = app.run_on_main_thread(move || {
        let h = handle.clone();
        platform::make_default_markdown_viewer(move |result| {
            let (kind, title, text) = match result {
                Ok(()) => (
                    MessageDialogKind::Info,
                    "Markdown Viewer is now the default",
                    "Markdown files you open from Finder will open here.".to_string(),
                ),
                Err(e) => (
                    MessageDialogKind::Warning,
                    "Default app not changed",
                    format!(
                        "{e}\n\nYou can also do this in Finder: select a .md file, choose File > Get Info, pick Markdown Viewer under “Open with”, and click “Change All…”."
                    ),
                ),
            };
            h.dialog().message(text).title(title).kind(kind).show(|_| {});
        });
    });
    if let Err(e) = result {
        eprintln!("run_on_main_thread: {e}");
    }
}

pub fn send_to_focused(app: &AppHandle, action: &str) {
    let label = lock(&app.state::<AppState>().docs).focused.clone();
    if let Some(label) = label
        && let Err(e) = app.emit_to(&label, EVENT_MENU, action)
    {
        eprintln!("emit menu to {label}: {e}");
    }
}

// ---------------------------------------------------------------------------
// Commands

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    path: String,
    name: String,
    dir: String,
    content: String,
}

/// The document assigned to the calling window, or `None` for the empty state.
/// The frontend never chooses which file to read; Rust decides from the label.
#[tauri::command]
pub async fn load_document(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
) -> Result<Option<DocumentPayload>, String> {
    let Some(path) = lock(&state.docs).path_for(window.label()) else {
        return Ok(None);
    };
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Some(DocumentPayload {
        name: display_name(&path),
        dir: path
            .parent()
            .map(|d| d.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        // Non-UTF-8 bytes are shown as U+FFFD instead of refusing the whole file.
        content: String::from_utf8_lossy(&bytes).into_owned(),
    }))
}

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, AppState>) -> FrontendSettings {
    FrontendSettings::from(&*lock(&state.settings))
}

#[tauri::command]
pub fn set_settings(app: AppHandle, patch: SettingsPatch) {
    update_settings(&app, patch);
}

/// The first render is on screen: show the window.
#[tauri::command]
pub fn frontend_ready(window: WebviewWindow, render_ms: Option<f64>) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    record_timing(window.label(), render_ms);
    Ok(())
}

/// Open a link from the document. `target` is an absolute path (already
/// resolved against the document folder by the frontend, fragment removed).
#[tauri::command]
pub async fn open_local_link(app: AppHandle, target: String) -> Result<(), String> {
    let path = PathBuf::from(&target);
    if !path.is_absolute() {
        return Err(format!("not an absolute path: {target}"));
    }
    if is_markdown(&path) {
        open_path(&app, &path);
        return Ok(());
    }
    if !path.exists() {
        show_error(&app, "Link target not found.", &target);
        return Ok(());
    }
    // Other local files are revealed, not opened: a link in an untrusted file
    // must not be able to launch an app or script with one click.
    let p = path.clone();
    app.run_on_main_thread(move || platform::reveal_in_finder(&p))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:"))
    {
        return Err(format!("refusing to open {url}"));
    }
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(platform::open_url(&url));
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Test instrumentation. Both are off unless an environment variable names an
// output file, which only the scripts in `scripts/` set. Nothing leaves the Mac.

/// Launch timing, for scripts/measure-launch.sh (MDV_TIMING_FILE).
fn record_timing(label: &str, render_ms: Option<f64>) {
    let since_start = PROCESS_START
        .get()
        .map(|t| t.elapsed().as_secs_f64() * 1000.0)
        .unwrap_or(f64::NAN);
    let epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let line = serde_json::json!({
        "label": label,
        "epochMs": epoch_ms,
        "sinceProcessStartMs": since_start,
        "renderMs": render_ms,
    });
    append_line("MDV_TIMING_FILE", &line.to_string());
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsConfig {
    enabled: bool,
    /// Scroll here after the first render, to test that live reload keeps the
    /// position (MDV_DIAG_SCROLL, in CSS pixels).
    scroll_to: Option<f64>,
}

/// Whether the frontend should send a rendering report (MDV_DIAG_FILE).
#[tauri::command]
pub fn diagnostics_config() -> DiagnosticsConfig {
    DiagnosticsConfig {
        enabled: std::env::var_os("MDV_DIAG_FILE").is_some(),
        scroll_to: std::env::var("MDV_DIAG_SCROLL")
            .ok()
            .and_then(|v| v.parse().ok()),
    }
}

/// A summary of what a window rendered, for scripts/check-fixtures.sh.
#[tauri::command]
pub fn report_diagnostics(window: WebviewWindow, report: serde_json::Value) {
    let line = serde_json::json!({ "label": window.label(), "report": report });
    append_line("MDV_DIAG_FILE", &line.to_string());
}

fn append_line(env_var: &str, line: &str) {
    let Ok(file) = std::env::var(env_var) else {
        return;
    };
    use std::io::Write;
    let result = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .and_then(|mut f| writeln!(f, "{line}"));
    if let Err(e) = result {
        eprintln!("{env_var}: cannot write {file}: {e}");
    }
}
