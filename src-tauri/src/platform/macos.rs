//! macOS-only calls into AppKit. Everything here must run on the main thread;
//! callers use `AppHandle::run_on_main_thread`.

use std::ffi::c_void;
use std::path::Path;

use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSDocumentController, NSWindow, NSWorkspace};
use objc2_foundation::{NSArray, NSBundle, NSError, NSString, NSURL};
use objc2_uniform_type_identifiers::UTType;

pub const MARKDOWN_UTI: &str = "net.daringfireball.markdown";

fn file_url(path: &Path) -> objc2::rc::Retained<NSURL> {
    NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))
}

/// Ask macOS to make this app the default for Markdown. macOS shows its own
/// confirmation; `done` receives the outcome (it may run on any thread).
pub fn make_default_markdown_viewer<F>(done: F)
where
    F: Fn(Result<(), String>) + 'static,
{
    let Some(content_type) = UTType::typeWithIdentifier(&NSString::from_str(MARKDOWN_UTI)) else {
        done(Err(format!("macOS does not know the type {MARKDOWN_UTI}")));
        return;
    };
    let app_url = NSBundle::mainBundle().bundleURL();
    let block = RcBlock::new(move |err: *mut NSError| {
        if err.is_null() {
            done(Ok(()));
        } else {
            // SAFETY: AppKit passes a valid NSError when the pointer is non-null.
            let err = unsafe { &*err };
            done(Err(err.localizedDescription().to_string()));
        }
    });
    NSWorkspace::sharedWorkspace().setDefaultApplicationAtURL_toOpenContentType_completionHandler(
        &app_url,
        &content_type,
        Some(&block),
    );
}

/// Set the file shown by the title-bar proxy icon.
///
/// # Safety
/// `ns_window` must be a live `NSWindow` pointer and this must run on the main thread.
pub unsafe fn set_represented_file(ns_window: *mut c_void, path: Option<&Path>) {
    // SAFETY: guaranteed by the caller.
    let window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
    let url = path.map(file_url);
    window.setRepresentedURL(url.as_deref());
}

/// Add to the system's recent documents (Dock menu, Apple menu > Recent Items).
pub fn note_recent_document(path: &Path) {
    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("note_recent_document called off the main thread");
        return;
    };
    NSDocumentController::sharedDocumentController(mtm).noteNewRecentDocumentURL(&file_url(path));
}

/// Open an http(s)/mailto URL in the default app. Caller validates the scheme.
pub fn open_url(url: &str) -> Result<(), String> {
    let Some(ns_url) = NSURL::URLWithString(&NSString::from_str(url)) else {
        return Err(format!("not a valid URL: {url}"));
    };
    if NSWorkspace::sharedWorkspace().openURL(&ns_url) {
        Ok(())
    } else {
        Err(format!("macOS could not open {url}"))
    }
}

/// Show a file selected in Finder.
pub fn reveal_in_finder(path: &Path) {
    let urls = NSArray::from_retained_slice(&[file_url(path)]);
    NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&urls);
}
