# Decisions

Short notes on choices that are not obvious from the code. Newest last.

## Files open in Rust-owned windows; the frontend never picks a path

Each window has a label (`doc-N`). Rust maps labels to canonical file paths, and
`load_document` returns the file for the calling window only. The web view has
no general file-system access (`core:default` permissions only), so a Markdown
file that somehow ran script still could not read other files through IPC.

## State is managed before `setup`

On a cold launch from Finder or `open -a`, macOS delivers the open-document
event before Tauri runs `setup`. Reading managed state at that point panics, so
`AppState` is registered on the builder and settings are loaded into it in
`setup`. Paths that arrive before `RunEvent::Ready` are queued and opened there.
If an empty window already exists when a file arrives, the file is shown in it
instead of opening a second window.

## Windows are shown when the frontend reports, not on a frame

Windows are created hidden and shown when the frontend has rendered, to avoid a
white flash. The frontend must not wait for `requestAnimationFrame`: WebKit does
not run frames for hidden windows, which cost 1.5 s per launch before this was
found. A 1.5 s safety timer still shows a window whose frontend never reports.

## Local images go through `mdimg://`, read off the main thread

Relative images are rewritten to `mdimg://localhost/<absolute path>`. The
handler serves only image file types, so a document cannot use it to read
other files. It runs asynchronously: a synchronous handler blocks the main
thread, and the first read in `~/Documents` waits on a macOS privacy prompt,
which froze the whole app during testing. `Info.plist` has usage strings that
explain the prompt.

## Remote images are not loaded

`CLAUDE.md` forbids network requests the user did not trigger. Loading
`![](https://…)` would be such a request (and is how tracking pixels work), so
remote images are replaced by a small placeholder with the alt text and the URL
in its tooltip. A per-document "load remote images" action could be added later
if wanted.

## Links to non-Markdown local files reveal them in Finder

Clicking a link to `report.pdf` reveals the file in Finder instead of opening
it. Markdown files are untrusted; a link labelled "notes" could point at an app
or a `.command` script, and opening it would run it with one click.

## Document ids are prefixed with `user-content-`

DOMPurify removes ids that would shadow DOM properties (`images`, `links`,
`forms`…), which silently dropped headings such as "# Images" from the outline.
With `SANITIZE_NAMED_PROPS` every id in the document gets the prefix, as on
GitHub, and anchor links resolve `#name` to `user-content-name`. A side effect:
document links can no longer target the app's own elements.

## No inline styles; strict CSP

The page CSP allows only bundled scripts and styles. Inline `style` attributes
in Markdown are dropped by the sanitiser; table alignment from markdown-it
becomes a class. Shiki colours are set through the CSSOM, which CSP permits.

## Shiki with the JavaScript regex engine, grammars loaded per language

Shiki, its engine, the two themes and each grammar are separate chunks, loaded
from inside the app only when a document has a fenced block in that language.
The start-up bundle is ~167 KB (markdown-it, DOMPurify, Tauri API). All
grammars together add ~9.7 MB to the app bundle on disk but nothing to launch.
The JS engine avoids shipping and instantiating Oniguruma WebAssembly.

## Own plugins for task lists and heading ids

`markdown-it-task-lists` has not been updated since 2018, and heading slugs
need GitHub's rules. Both are under 60 lines in `src/render/markdown.ts`.
Footnotes use the official `markdown-it-footnote`.

## Long files render progressively

A new file is parsed in full (so footnotes and reference links resolve), then
the first 60 top-level blocks are sanitised and shown; the rest is appended in
slices of 250 blocks. Joined chunks equal the full render (tested). Documents
with raw HTML blocks are not split, because an HTML element can span several
blocks and each chunk is sanitised on its own. Off-screen blocks use
`content-visibility: auto`. Result: a 1 MB file shows in ~200 ms in a running
app (was ~830 ms).

## Live reload keeps unchanged blocks

On reload, top-level blocks whose HTML is unchanged keep their DOM node, so
images stay loaded, code stays highlighted and the scroll position holds. The
keys (original HTML) are computed lazily on the first reload; the highlighter
records a block's original HTML before colouring it.

## Theme, zoom and sidebar are app-wide settings

They are stored once (`~/Library/Application Support/nl.robertkarzijn.markdownviewer/settings.json`)
and applied to all windows when changed. The window size of the last resized
window is used for new windows. An unreadable settings file is moved to
`settings.json.broken` instead of being overwritten.

## Single instance

Launch Services already sends Finder and `open -a` opens to the running copy.
Testing showed `open -n` and running the binary directly still started a second
copy, so `tauri-plugin-single-instance` was added: a second launch hands its
file arguments to the first and exits.

## Find uses the CSS Custom Highlight API

Matches are painted with `CSS.highlights`, so the document DOM is never changed
for find. Matches spanning formatting (for example "foo **bar**" searched as
"foo bar") are not found; each text node is searched on its own.

## Test instrumentation in the shipped app

`MDV_TIMING_FILE`, `MDV_DIAG_FILE`, `MDV_DIAG_SCROLL` and `MDV_SELFTEST` let the
scripts in `scripts/` measure launch time and drive the real menu handlers
without screen-recording or accessibility permissions. All are inert unless
the environment variable is set, and they only write to the named local file.
