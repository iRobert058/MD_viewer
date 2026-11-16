//! Scripted menu actions for automated checks of the built app.
//!
//! Only active when `MDV_SELFTEST` is set (by `scripts/selftest.sh`). It drives
//! the real menu handlers, so a check needs no screen or accessibility access.
//! Actions are comma-separated:
//!   <menu id>          run that menu item (e.g. `theme-dark`, `zoom-in`, `find`)
//!   find-query:<text>  type <text> into the focused window's find field
//!   close              close the focused window
//!   report             ask every window to write its diagnostics report
//!   wait:<ms>          pause

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::app::{AppState, lock};

const STEP: Duration = Duration::from_millis(400);

pub fn start(app: &AppHandle) {
    let Ok(script) = std::env::var("MDV_SELFTEST") else {
        return;
    };
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        for action in script.split(',').map(str::trim).filter(|a| !a.is_empty()) {
            run(&app, action);
            std::thread::sleep(STEP);
        }
    });
}

fn run(app: &AppHandle, action: &str) {
    if let Some(ms) = action.strip_prefix("wait:") {
        match ms.parse() {
            Ok(ms) => std::thread::sleep(Duration::from_millis(ms)),
            Err(e) => eprintln!("selftest: bad wait {ms}: {e}"),
        }
        return;
    }
    if action == "report" {
        if let Err(e) = app.emit("selftest-report", ()) {
            eprintln!("selftest: {e}");
        }
        return;
    }
    let focused = lock(&app.state::<AppState>().docs).focused.clone();
    if let Some(query) = action.strip_prefix("find-query:") {
        if let Some(label) = focused
            && let Err(e) = app.emit_to(&label, "selftest-find", query)
        {
            eprintln!("selftest: {e}");
        }
        return;
    }
    if action == "close" {
        if let Some(w) = focused.and_then(|l| app.get_webview_window(&l))
            && let Err(e) = w.close()
        {
            eprintln!("selftest: close: {e}");
        }
        return;
    }
    let handle = app.clone();
    let id = action.to_string();
    if let Err(e) = app.run_on_main_thread(move || crate::handle_menu(&handle, &id)) {
        eprintln!("selftest: {e}");
    }
}
