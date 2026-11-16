//! `mdimg://` serves local images referenced by the open Markdown file.
//!
//! The frontend resolves a relative image path against the document's folder and
//! requests `mdimg://localhost/<percent-encoded absolute path>`. Only image file
//! types are served, so a Markdown file cannot use this to read other files.

use std::path::PathBuf;

use percent_encoding::percent_decode_str;
use tauri::http::{Response, StatusCode, header};

const IMAGE_TYPES: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("avif", "image/avif"),
    ("svg", "image/svg+xml"),
    ("bmp", "image/bmp"),
    ("ico", "image/x-icon"),
    ("heic", "image/heic"),
];

#[derive(Debug, PartialEq, Eq)]
pub enum Rejection {
    BadPath,
    NotAnImage,
}

/// Turn the URL path of an `mdimg` request into a file path and MIME type.
pub fn resolve(url_path: &str) -> Result<(PathBuf, &'static str), Rejection> {
    let decoded = percent_decode_str(url_path)
        .decode_utf8()
        .map_err(|_| Rejection::BadPath)?;
    let path = PathBuf::from(decoded.as_ref());
    if !path.is_absolute() {
        return Err(Rejection::BadPath);
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .ok_or(Rejection::NotAnImage)?;
    let mime = IMAGE_TYPES
        .iter()
        .find(|(e, _)| e.eq_ignore_ascii_case(ext))
        .map(|(_, m)| *m)
        .ok_or(Rejection::NotAnImage)?;
    Ok((path, mime))
}

pub fn handle(url_path: &str) -> Response<Vec<u8>> {
    let (path, mime) = match resolve(url_path) {
        Ok(v) => v,
        Err(Rejection::BadPath) => return status(StatusCode::BAD_REQUEST),
        Err(Rejection::NotAnImage) => return status(StatusCode::FORBIDDEN),
    };
    match std::fs::read(&path) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            // SVGs are images here; make sure nothing inside them can run.
            .header(header::CONTENT_SECURITY_POLICY, "script-src 'none'")
            .body(bytes)
            .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => status(StatusCode::NOT_FOUND),
        Err(e) => {
            eprintln!("mdimg: cannot read {}: {e}", path.display());
            status(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    let mut r = Response::new(Vec::new());
    *r.status_mut() = code;
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_spaces_and_non_ascii() {
        let (p, m) = resolve("/Users/r/My%20Notes/caf%C3%A9.png").unwrap();
        assert_eq!(p, PathBuf::from("/Users/r/My Notes/café.png"));
        assert_eq!(m, "image/png");
    }

    #[test]
    fn rejects_non_images() {
        assert_eq!(resolve("/etc/passwd"), Err(Rejection::NotAnImage));
        assert_eq!(resolve("/Users/r/notes.md"), Err(Rejection::NotAnImage));
        assert_eq!(resolve("/Users/r/key.pem"), Err(Rejection::NotAnImage));
    }

    #[test]
    fn rejects_relative_paths() {
        assert_eq!(resolve("x.png"), Err(Rejection::BadPath));
    }

    #[test]
    fn extension_is_case_insensitive() {
        assert_eq!(resolve("/a/B.JPG").unwrap().1, "image/jpeg");
    }

    #[test]
    fn serves_existing_image_and_404s_missing() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a b.png");
        std::fs::write(&img, b"\x89PNG").unwrap();
        let url = format!("{}", img.display()).replace(' ', "%20");
        let r = handle(&url);
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.body(), b"\x89PNG");
        let missing = handle(&format!("{}/nope.png", dir.path().display()));
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }
}
