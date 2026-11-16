//! Watch an open file and tell its window when it changes.
//!
//! We watch the file's folder, not the file itself: most editors save by writing
//! a temp file and renaming it over the original, which ends a watch on the old
//! file. Events are filtered by file name and debounced.

use std::path::Path;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};

pub type FileWatcher = Debouncer<RecommendedWatcher>;

const DEBOUNCE: Duration = Duration::from_millis(100);

pub fn watch<F>(path: &Path, on_change: F) -> notify::Result<FileWatcher>
where
    F: Fn() + Send + 'static,
{
    let dir = path
        .parent()
        .ok_or_else(|| notify::Error::generic("file has no parent folder"))?
        .to_path_buf();
    let name = path.file_name().map(|n| n.to_os_string());
    let mut debouncer = new_debouncer(DEBOUNCE, move |res: DebounceEventResult| match res {
        Ok(events) => {
            if events
                .iter()
                .any(|e| e.path.file_name().map(|n| n.to_os_string()) == name)
            {
                on_change();
            }
        }
        Err(e) => eprintln!("watcher: {e}"),
    })?;
    debouncer
        .watcher()
        .watch(&dir, RecursiveMode::NonRecursive)?;
    Ok(debouncer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn reports_in_place_writes_and_atomic_renames() {
        let dir = tempfile::tempdir().unwrap();
        let dir = std::fs::canonicalize(dir.path()).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "one").unwrap();
        let (tx, rx) = mpsc::channel();
        let _w = watch(&file, move || {
            let _ = tx.send(());
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(300));

        std::fs::write(&file, "two").unwrap();
        rx.recv_timeout(Duration::from_secs(5))
            .expect("in-place write reported");
        while rx.try_recv().is_ok() {}

        let tmp = dir.join(".note.md.tmp");
        std::fs::write(&tmp, "three").unwrap();
        std::fs::rename(&tmp, &file).unwrap();
        rx.recv_timeout(Duration::from_secs(5))
            .expect("atomic rename reported");
    }
}
