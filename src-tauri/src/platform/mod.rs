//! Platform-specific code. Only macOS is implemented; other platforms get
//! stubs that report "not supported" so the rest of the app stays portable.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
mod other {
    use std::ffi::c_void;
    use std::path::Path;

    pub fn make_default_markdown_viewer<F: Fn(Result<(), String>) + 'static>(done: F) {
        done(Err("Not supported on this platform".into()));
    }
    /// # Safety
    /// No-op on this platform.
    pub unsafe fn set_represented_file(_ns_window: *mut c_void, _path: Option<&Path>) {}
    pub fn note_recent_document(_path: &Path) {}
    pub fn open_url(_url: &str) -> Result<(), String> {
        Err("Not supported on this platform".into())
    }
    pub fn reveal_in_finder(_path: &Path) {}
}
#[cfg(not(target_os = "macos"))]
pub use other::*;
