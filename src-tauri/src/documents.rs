//! Which document is shown in which window.
//!
//! Every document window has a label (`doc-N`) and optionally a path. A window
//! without a path shows the empty state. Paths are always canonical, so the same
//! file reached through a symlink or a different spelling maps to one window.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];

pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            MARKDOWN_EXTENSIONS
                .iter()
                .any(|m| m.eq_ignore_ascii_case(e))
        })
        .unwrap_or(false)
}

/// What to do when a file is opened.
#[derive(Debug, PartialEq, Eq)]
pub enum OpenAction {
    /// The file is already open in this window: bring it to the front.
    Focus(String),
    /// An empty-state window exists: show the file there.
    Reuse(String),
    /// Create a new window with this label.
    Create(String),
}

#[derive(Default)]
pub struct Docs {
    windows: HashMap<String, Option<PathBuf>>,
    next_id: u64,
    /// False until `RunEvent::Ready`. Files opened before that are queued.
    pub ready: bool,
    pub pending: Vec<PathBuf>,
    pub focused: Option<String>,
}

impl Docs {
    /// Decide where `path` goes and record the assignment.
    pub fn plan_open(&mut self, path: &Path) -> OpenAction {
        if let Some(label) = self.label_for(path) {
            return OpenAction::Focus(label);
        }
        if let Some(label) = self.empty_window() {
            self.windows.insert(label.clone(), Some(path.to_path_buf()));
            return OpenAction::Reuse(label);
        }
        let label = self.new_label();
        self.windows.insert(label.clone(), Some(path.to_path_buf()));
        OpenAction::Create(label)
    }

    /// Register a new empty-state window and return its label.
    pub fn new_empty(&mut self) -> String {
        let label = self.new_label();
        self.windows.insert(label.clone(), None);
        label
    }

    pub fn path_for(&self, label: &str) -> Option<PathBuf> {
        self.windows.get(label).cloned().flatten()
    }

    pub fn remove(&mut self, label: &str) {
        self.windows.remove(label);
        if self.focused.as_deref() == Some(label) {
            self.focused = None;
        }
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.windows.is_empty()
    }

    fn label_for(&self, path: &Path) -> Option<String> {
        self.windows
            .iter()
            .find(|(_, p)| p.as_deref() == Some(path))
            .map(|(l, _)| l.clone())
    }

    /// The oldest empty-state window, so the choice is deterministic.
    fn empty_window(&self) -> Option<String> {
        self.windows
            .iter()
            .filter(|(_, p)| p.is_none())
            .map(|(l, _)| l)
            .min_by_key(|l| label_number(l))
            .cloned()
    }

    fn new_label(&mut self) -> String {
        self.next_id += 1;
        format!("doc-{}", self.next_id)
    }
}

fn label_number(label: &str) -> u64 {
    label
        .strip_prefix("doc-")
        .and_then(|n| n.parse().ok())
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_markdown_extensions_case_insensitively() {
        assert!(is_markdown(Path::new("/a/notes.md")));
        assert!(is_markdown(Path::new("/a/README.MD")));
        assert!(is_markdown(Path::new("/a/x.markdown")));
        assert!(is_markdown(Path::new("/a/x.mdown")));
        assert!(is_markdown(Path::new("/a/x.mkd")));
        assert!(!is_markdown(Path::new("/a/x.txt")));
        assert!(!is_markdown(Path::new("/a/md")));
    }

    #[test]
    fn opening_same_file_twice_focuses_existing_window() {
        let mut d = Docs::default();
        let p = Path::new("/notes/a.md");
        let first = d.plan_open(p);
        assert_eq!(first, OpenAction::Create("doc-1".into()));
        assert_eq!(d.plan_open(p), OpenAction::Focus("doc-1".into()));
    }

    #[test]
    fn empty_window_is_reused_before_creating_a_new_one() {
        let mut d = Docs::default();
        let empty = d.new_empty();
        assert_eq!(
            d.plan_open(Path::new("/a.md")),
            OpenAction::Reuse(empty.clone())
        );
        assert_eq!(d.path_for(&empty).as_deref(), Some(Path::new("/a.md")));
        // The empty window is now used, so the next file gets its own window.
        assert_eq!(
            d.plan_open(Path::new("/b.md")),
            OpenAction::Create("doc-2".into())
        );
    }

    #[test]
    fn several_files_each_get_a_window() {
        let mut d = Docs::default();
        let actions: Vec<_> = ["/a.md", "/b.md", "/c.md"]
            .iter()
            .map(|p| d.plan_open(Path::new(p)))
            .collect();
        assert_eq!(
            actions,
            vec![
                OpenAction::Create("doc-1".into()),
                OpenAction::Create("doc-2".into()),
                OpenAction::Create("doc-3".into()),
            ]
        );
    }

    #[test]
    fn closed_window_frees_its_file() {
        let mut d = Docs::default();
        let p = Path::new("/a.md");
        d.plan_open(p);
        d.remove("doc-1");
        assert!(d.is_empty());
        assert_eq!(d.plan_open(p), OpenAction::Create("doc-2".into()));
    }

    #[test]
    fn oldest_empty_window_is_reused_first() {
        let mut d = Docs::default();
        for _ in 0..10 {
            d.new_empty();
        }
        assert_eq!(
            d.plan_open(Path::new("/a.md")),
            OpenAction::Reuse("doc-1".into())
        );
    }
}
