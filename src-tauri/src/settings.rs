//! Settings and recent files, stored as JSON in the app's config folder.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const MAX_RECENT: usize = 10;
pub const MIN_ZOOM: f64 = 0.5;
pub const MAX_ZOOM: f64 = 3.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: Theme,
    pub sidebar_visible: bool,
    pub zoom: f64,
    pub window_width: f64,
    pub window_height: f64,
    pub recent_files: Vec<PathBuf>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            sidebar_visible: true,
            zoom: 1.0,
            window_width: 900.0,
            window_height: 800.0,
            recent_files: Vec::new(),
        }
    }
}

/// The part of the settings the frontend may change.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub theme: Option<Theme>,
    pub sidebar_visible: Option<bool>,
    pub zoom: Option<f64>,
}

impl Settings {
    pub fn apply(&mut self, patch: SettingsPatch) {
        if let Some(t) = patch.theme {
            self.theme = t;
        }
        if let Some(s) = patch.sidebar_visible {
            self.sidebar_visible = s;
        }
        if let Some(z) = patch.zoom {
            self.zoom = clamp_zoom(z);
        }
    }

    /// Move `path` to the top of the recent list.
    pub fn add_recent(&mut self, path: &Path) {
        self.recent_files.retain(|p| p != path);
        self.recent_files.insert(0, path.to_path_buf());
        self.recent_files.truncate(MAX_RECENT);
    }

    pub fn remove_recent(&mut self, path: &Path) {
        self.recent_files.retain(|p| p != path);
    }
}

pub fn clamp_zoom(z: f64) -> f64 {
    if z.is_finite() {
        // Round to avoid drift like 1.1000000000000003 after repeated steps.
        ((z.clamp(MIN_ZOOM, MAX_ZOOM)) * 100.0).round() / 100.0
    } else {
        1.0
    }
}

/// Load settings. A missing file gives defaults. A file that cannot be parsed is
/// moved aside (not overwritten) so nothing is silently lost, and defaults are used.
pub fn load(path: &Path) -> Settings {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Settings::default(),
        Err(e) => {
            eprintln!(
                "settings: cannot read {}: {e}; using defaults",
                path.display()
            );
            return Settings::default();
        }
    };
    match serde_json::from_str::<Settings>(&text) {
        Ok(mut s) => {
            s.zoom = clamp_zoom(s.zoom);
            s
        }
        Err(e) => {
            let backup = path.with_extension("json.broken");
            eprintln!(
                "settings: {} is invalid ({e}); moved to {} and using defaults",
                path.display(),
                backup.display()
            );
            if let Err(e) = std::fs::rename(path, &backup) {
                eprintln!("settings: could not move invalid file aside: {e}");
            }
            Settings::default()
        }
    }
}

/// Write atomically (temp file + rename) so a crash never leaves half a file.
pub fn save(path: &Path, settings: &Settings) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_files_dedupe_and_cap() {
        let mut s = Settings::default();
        for i in 0..15 {
            s.add_recent(Path::new(&format!("/f{i}.md")));
        }
        s.add_recent(Path::new("/f10.md"));
        assert_eq!(s.recent_files.len(), MAX_RECENT);
        assert_eq!(s.recent_files[0], PathBuf::from("/f10.md"));
        assert_eq!(
            s.recent_files
                .iter()
                .filter(|p| p.ends_with("f10.md"))
                .count(),
            1
        );
    }

    #[test]
    fn zoom_is_clamped_and_rounded() {
        assert_eq!(clamp_zoom(10.0), MAX_ZOOM);
        assert_eq!(clamp_zoom(0.1), MIN_ZOOM);
        assert_eq!(clamp_zoom(1.1000000000000003), 1.1);
        assert_eq!(clamp_zoom(f64::NAN), 1.0);
    }

    #[test]
    fn round_trips_and_tolerates_missing_fields() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        assert_eq!(load(&p), Settings::default());
        let mut s = Settings {
            theme: Theme::Dark,
            ..Default::default()
        };
        s.add_recent(Path::new("/a b/ü.md"));
        save(&p, &s).unwrap();
        assert_eq!(load(&p), s);
        std::fs::write(&p, r#"{"theme":"light"}"#).unwrap();
        let partial = load(&p);
        assert_eq!(partial.theme, Theme::Light);
        assert_eq!(partial.zoom, 1.0);
    }

    #[test]
    fn invalid_file_is_moved_aside_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        std::fs::write(&p, "{not json").unwrap();
        assert_eq!(load(&p), Settings::default());
        assert!(!p.exists());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("settings.json.broken")).unwrap(),
            "{not json"
        );
    }
}
