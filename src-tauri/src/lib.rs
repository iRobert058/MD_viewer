mod app;
mod documents;
mod menu;
mod platform;
mod protocol;
mod settings;
mod watcher;

use std::path::PathBuf;
use std::time::Instant;

use tauri::{DragDropEvent, Manager, RunEvent, WindowEvent};

use app::{AppState, lock};

pub fn run() {
    let _ = app::PROCESS_START.set(Instant::now());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Asynchronous, so file reads never run on the main thread: a slow disk
        // or a pending macOS privacy prompt must not freeze the app.
        .register_asynchronous_uri_scheme_protocol("mdimg", |_ctx, request, responder| {
            let path = request.uri().path().to_string();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(protocol::handle(&path));
            });
        })
        .invoke_handler(tauri::generate_handler![
            app::load_document,
            app::get_settings,
            app::set_settings,
            app::frontend_ready,
            app::open_local_link,
            app::open_external,
            app::diagnostics_enabled,
            app::report_diagnostics,
        ])
        .manage(AppState::default())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let state = app.state::<AppState>();
            state.init_settings(config_dir.join("settings.json"));
            let settings = lock(&state.settings).clone();
            let (menu, handles) = menu::build(app.handle(), &settings)?;
            app.set_menu(menu)?;
            *lock(&state.menu) = Some(handles);
            Ok(())
        })
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .build(tauri::generate_context!())
        .expect("error while building the app");

    app.run(|app, event| match event {
        RunEvent::Ready => {
            let pending = {
                let state = app.state::<AppState>();
                let mut docs = lock(&state.docs);
                docs.ready = true;
                std::mem::take(&mut docs.pending)
            };
            let mut paths = pending;
            paths.extend(cli_paths());
            if paths.is_empty() {
                app::open_empty_window(app);
            } else {
                app::open_paths(app, paths);
            }
        }
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        RunEvent::Opened { urls } => {
            let paths = urls
                .into_iter()
                .filter_map(|u| match u.to_file_path() {
                    Ok(p) => Some(p),
                    Err(()) => {
                        eprintln!("ignoring non-file URL: {u}");
                        None
                    }
                })
                .collect();
            app::open_paths(app, paths);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows && app.webview_windows().is_empty() {
                app::open_empty_window(app);
            }
        }
        RunEvent::WindowEvent { label, event, .. } => match event {
            WindowEvent::Focused(true) => {
                lock(&app.state::<AppState>().docs).focused = Some(label);
            }
            WindowEvent::Resized(_) => app::window_resized(app, &label),
            WindowEvent::Destroyed => app::window_destroyed(app, &label),
            WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                let md: Vec<PathBuf> = paths
                    .into_iter()
                    .filter(|p| documents::is_markdown(p))
                    .collect();
                app::open_paths(app, md);
            }
            _ => {}
        },
        // Closing the last window keeps the app running, as Mac apps do. Quit
        // goes through our own menu item, which exits with an explicit code.
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        RunEvent::Exit => app.state::<AppState>().save_settings(),
        _ => {}
    });
}

fn handle_menu(app: &tauri::AppHandle, id: &str) {
    use menu::*;
    match id {
        OPEN => app::show_open_dialog(app),
        QUIT => {
            app.state::<AppState>().save_settings();
            app.exit(0);
        }
        MAKE_DEFAULT => app::make_default(app),
        RECENT_CLEAR => app::clear_recent(app),
        ZOOM_IN => app::step_zoom(app, Some(0.1)),
        ZOOM_OUT => app::step_zoom(app, Some(-0.1)),
        ZOOM_RESET => app::step_zoom(app, None),
        THEME_SYSTEM | THEME_LIGHT | THEME_DARK => {
            let theme = match id {
                THEME_LIGHT => settings::Theme::Light,
                THEME_DARK => settings::Theme::Dark,
                _ => settings::Theme::System,
            };
            app::update_settings(
                app,
                settings::SettingsPatch {
                    theme: Some(theme),
                    ..Default::default()
                },
            );
        }
        FIND | FIND_NEXT | FIND_PREV | TOGGLE_SIDEBAR | SETTINGS | HELP_DEFAULT => {
            if app.webview_windows().is_empty() && id == SETTINGS {
                app::open_empty_window(app);
            }
            app::send_to_focused(app, id)
        }
        other => {
            if let Some(i) = other
                .strip_prefix(RECENT_PREFIX)
                .and_then(|n| n.parse().ok())
            {
                app::open_recent(app, i);
            }
        }
    }
}

/// Files passed on the command line (handy with `tauri dev`; Finder and
/// `open -a` use open-document events instead).
fn cli_paths() -> Vec<PathBuf> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .filter(|p| p.is_file() && documents::is_markdown(p))
        .collect()
}
