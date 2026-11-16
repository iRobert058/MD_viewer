//! The menu bar. Item ids are matched in `app::handle_menu`.

use std::path::Path;

use tauri::menu::{
    AboutMetadata, CheckMenuItem, HELP_SUBMENU_ID, Menu, MenuItem, PredefinedMenuItem, Submenu,
    WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Wry};

use crate::settings::{Settings, Theme};

pub const OPEN: &str = "open";
pub const MAKE_DEFAULT: &str = "make-default";
pub const QUIT: &str = "quit";
pub const SETTINGS: &str = "settings";
pub const RECENT_PREFIX: &str = "recent:";
pub const RECENT_CLEAR: &str = "recent-clear";
pub const FIND: &str = "find";
pub const FIND_NEXT: &str = "find-next";
pub const FIND_PREV: &str = "find-prev";
pub const TOGGLE_SIDEBAR: &str = "toggle-sidebar";
pub const ZOOM_IN: &str = "zoom-in";
pub const ZOOM_OUT: &str = "zoom-out";
pub const ZOOM_RESET: &str = "zoom-reset";
pub const THEME_SYSTEM: &str = "theme-system";
pub const THEME_LIGHT: &str = "theme-light";
pub const THEME_DARK: &str = "theme-dark";
pub const HELP_DEFAULT: &str = "help-default";

/// Menu parts that change at runtime.
pub struct MenuHandles {
    pub recent: Submenu<Wry>,
    pub theme_system: CheckMenuItem<Wry>,
    pub theme_light: CheckMenuItem<Wry>,
    pub theme_dark: CheckMenuItem<Wry>,
}

impl MenuHandles {
    pub fn set_theme(&self, theme: Theme) -> tauri::Result<()> {
        self.theme_system.set_checked(theme == Theme::System)?;
        self.theme_light.set_checked(theme == Theme::Light)?;
        self.theme_dark.set_checked(theme == Theme::Dark)?;
        Ok(())
    }

    /// Rebuild File > Open Recent from the list of paths.
    pub fn set_recent(&self, app: &AppHandle, paths: &[std::path::PathBuf]) -> tauri::Result<()> {
        for item in self.recent.items()? {
            self.recent.remove(&item)?;
        }
        let labels = recent_labels(paths);
        for (i, label) in labels.iter().enumerate() {
            let item = MenuItem::with_id(
                app,
                format!("{RECENT_PREFIX}{i}"),
                label,
                true,
                None::<&str>,
            )?;
            self.recent.append(&item)?;
        }
        if !paths.is_empty() {
            self.recent.append(&PredefinedMenuItem::separator(app)?)?;
        }
        self.recent.append(&MenuItem::with_id(
            app,
            RECENT_CLEAR,
            "Clear Menu",
            !paths.is_empty(),
            None::<&str>,
        )?)?;
        Ok(())
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// Menu labels: the file name, plus its folder when two entries share a name
/// (as Finder does for "README.md — project-a" / "README.md — project-b").
pub fn recent_labels(paths: &[std::path::PathBuf]) -> Vec<String> {
    paths
        .iter()
        .map(|p| {
            let name = file_name(p);
            let shared = paths.iter().filter(|q| file_name(q) == name).count() > 1;
            match p.parent().and_then(|d| d.file_name()) {
                Some(dir) if shared => format!("{name} — {}", dir.to_string_lossy()),
                _ => name,
            }
        })
        .collect()
}

pub fn build(app: &AppHandle, settings: &Settings) -> tauri::Result<(Menu<Wry>, MenuHandles)> {
    let sep = || PredefinedMenuItem::separator(app);
    let item =
        |id: &str, text: &str, accel: Option<&str>| MenuItem::with_id(app, id, text, true, accel);

    let app_menu = Submenu::with_items(
        app,
        "Markdown Viewer",
        true,
        &[
            &PredefinedMenuItem::about(
                app,
                Some("About Markdown Viewer"),
                Some(AboutMetadata::default()),
            )?,
            &sep()?,
            &item(SETTINGS, "Settings…", Some("CmdOrCtrl+,"))?,
            &item(MAKE_DEFAULT, "Make Default Markdown Viewer…", None)?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &item(QUIT, "Quit Markdown Viewer", Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    let recent = Submenu::with_items(app, "Open Recent", true, &[])?;
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item(OPEN, "Open…", Some("CmdOrCtrl+O"))?,
            &recent,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &sep()?,
            &item(FIND, "Find…", Some("CmdOrCtrl+F"))?,
            &item(FIND_NEXT, "Find Next", Some("CmdOrCtrl+G"))?,
            &item(FIND_PREV, "Find Previous", Some("CmdOrCtrl+Shift+G"))?,
        ],
    )?;

    let theme = settings.theme;
    let check = |id: &str, text: &str, on: bool| {
        CheckMenuItem::with_id(app, id, text, true, on, None::<&str>)
    };
    let theme_system = check(THEME_SYSTEM, "Match System", theme == Theme::System)?;
    let theme_light = check(THEME_LIGHT, "Light", theme == Theme::Light)?;
    let theme_dark = check(THEME_DARK, "Dark", theme == Theme::Dark)?;
    let appearance = Submenu::with_items(
        app,
        "Appearance",
        true,
        &[&theme_system, &theme_light, &theme_dark],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item(
                TOGGLE_SIDEBAR,
                "Toggle Outline Sidebar",
                Some("CmdOrCtrl+Ctrl+S"),
            )?,
            &appearance,
            &sep()?,
            &item(ZOOM_RESET, "Actual Size", Some("CmdOrCtrl+0"))?,
            &item(ZOOM_IN, "Zoom In", Some("CmdOrCtrl+="))?,
            &item(ZOOM_OUT, "Zoom Out", Some("CmdOrCtrl+-"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &sep()?,
            &PredefinedMenuItem::bring_all_to_front(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[&item(
            HELP_DEFAULT,
            "Using Markdown Viewer as the Default App",
            None,
        )?],
    )?;

    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )?;

    let handles = MenuHandles {
        recent,
        theme_system,
        theme_light,
        theme_dark,
    };
    handles.set_recent(app, &settings.recent_files)?;
    Ok((menu, handles))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn recent_labels_add_folder_only_for_duplicate_names() {
        let paths = [
            PathBuf::from("/a/project-a/README.md"),
            PathBuf::from("/b/project-b/README.md"),
            PathBuf::from("/c/notes.md"),
        ];
        assert_eq!(
            recent_labels(&paths),
            vec!["README.md — project-a", "README.md — project-b", "notes.md"]
        );
    }
}
