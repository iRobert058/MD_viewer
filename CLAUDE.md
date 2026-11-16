# Markdown Viewer

A fast, ad-free macOS app for reading Markdown files. Its main job is to be the default app for `.md` files: I double-click a Markdown file in Finder and it opens here, rendered, immediately. It replaces "MD Viewer", which I currently use but dislike: it is full of ads and the interface is cluttered. This app should feel like a quiet reading tool, not a product.

## What to build

A viewer first. Editing is out of scope unless I ask for it.

### Must have (v1)
- Works as the default macOS app for Markdown files (see "Default app for Markdown on macOS"). This is the primary way files get opened.
- Also opens files via File > Open, drag and drop onto the window or Dock icon, and `open -a` from the terminal.
- Each file opens in its own window. Opening a file that is already open brings its window to the front instead of duplicating it.
- Render GitHub Flavored Markdown: headings, tables, task lists, footnotes, strikethrough, autolinks, fenced code blocks with syntax highlighting.
- Live reload: when the open file changes on disk, re-render and keep the scroll position.
- Relative images and relative links to other `.md` files resolve against the open file's folder. Links to other Markdown files open in the app; external links open in the default browser.
- Light and dark theme that follows the system setting, with a manual override.
- Outline sidebar generated from headings, click to jump, toggleable.
- Find in document (Cmd/Ctrl+F).
- Recent files list.
- Remembers window size, theme, sidebar state and zoom level between launches.

### Should have (v2, only after v1 works end to end)
- Open a folder and browse its Markdown files in a file tree.
- Native macOS window tabs.
- Quick Look extension so pressing Space on a `.md` file in Finder shows it rendered.
- Math (KaTeX) and Mermaid diagrams.
- YAML front matter shown as a compact metadata block instead of raw text.
- Export to PDF / print.
- Wiki-style `[[links]]` so Obsidian vault notes are readable.

### Never
- Ads, telemetry, analytics, accounts, update nags, or any network request the user did not trigger. The app must work fully offline.
- Bundled fonts or scripts loaded from a CDN. Everything ships inside the app.

## Stack

- **Tauri 2** (Rust shell) with a **TypeScript + Vite** frontend. No UI framework unless the code clearly needs one; plain TS with small modules is preferred.
- **markdown-it** with plugins for GFM features; **Shiki** for code highlighting.
- **DOMPurify** on all rendered HTML. Markdown files are untrusted input: raw HTML in a file must never run scripts or reach Tauri APIs.
- File watching through the Tauri fs/watch plugin on the Rust side, debounced.
- Target: macOS on Apple Silicon. Windows may come later, so keep platform-specific code isolated in `src-tauri/`, but do not spend effort on it now.

If one of these choices turns out to be a poor fit, stop and tell me why before switching. In particular, if Tauri gets in the way of the default-app behaviour or the launch-time budget below, propose a native Swift (AppKit/SwiftUI + WKWebView) shell instead.

## Default app for Markdown on macOS

This is the core requirement; treat it as the first vertical slice, not a finishing touch.

- **Declare the document types.** Configure `bundle.fileAssociations` in `tauri.conf.json` so the built app's `Info.plist` has a `CFBundleDocumentTypes` entry for the `net.daringfireball.markdown` type with role Viewer, covering the extensions `md`, `markdown`, `mdown`, `mkd`. Import the type declaration (`UTImportedTypeDeclarations`) so it resolves even on a Mac where nothing else has declared it.
- **Handle open events in both launch states.** macOS does not pass the file as a command-line argument; it sends an open-document event. Handle Tauri's `RunEvent::Opened { urls }`:
  - cold launch: the event can arrive before the frontend is ready, so queue the paths on the Rust side and hand them over once the window signals it has loaded;
  - app already running: open a new window for the file, or focus the existing one.
  Several files selected and opened at once must each get a window.
- **Single instance.** Never start a second copy of the app; all opens route to the running one.
- **Becoming the default.** An app cannot silently make itself the default. Provide a menu item "Make Default Markdown Viewer" that calls `NSWorkspace.setDefaultApplication(at:toOpen:)` for the Markdown type (macOS asks the user to confirm). Also document the manual route in the README: Finder > Get Info on any `.md` file > Open with > Change All.
- **No file open, no fuss.** Launched from the Dock with no file, show the empty state. Closing the last window keeps the app running, as Mac apps normally do.
- **Launch speed.** Because this is what a double-click runs, cold launch to rendered content must stay under about 500 ms for a typical note. Do not load Shiki grammars, KaTeX or Mermaid until a document needs them.
- **Testing it for real.** File associations do not work in `tauri dev`. To verify: run `npm run tauri build`, copy the `.app` to `/Applications`, then test with `open -a "Markdown Viewer" tests/fixtures/basic.md` and by double-clicking in Finder after setting the default. Test cold launch, already-running, multiple files at once, and a path containing spaces and non-ASCII characters. If Finder does not offer the app, refresh Launch Services with `lsregister -f /Applications/Markdown\ Viewer.app`.
- **Signing.** An ad-hoc signed local build is fine for my own Mac. Do not set up notarisation or a Developer ID unless I ask.

## Interface principles

- Content is the interface. No toolbar by default; controls live in the menu bar, keyboard shortcuts, and a sidebar that can be hidden.
- Readable measure: body text column capped at roughly 70–80 characters, generous line height, system font stack for prose, monospace for code.
- Behaves like a native Mac app: standard menu bar (File, Edit, View, Window, Help), standard shortcuts (Cmd+O, Cmd+W, Cmd+F, Cmd+Plus/Minus, Cmd+,), a proper app icon, and the file name with a proxy icon in the title bar.
- Opening a file should feel instant. Budget for an already-running app: a 1 MB file rendered in under 300 ms.
- Accessible: semantic HTML in the rendered output, visible focus states, WCAG AA contrast in both themes, respects reduced-motion.
- Empty state (no file open) shows only a short hint: drop a file or press Cmd+O.

## Reference app: MD Viewer

MD Viewer is the app this replaces. You may inspect it with the reverse-engineering skill and its `rea` tools when that helps, for example to:
- list the features and Markdown extensions it supports, so nothing I rely on is missing,
- see how it handles file associations, live reload, or relative paths,
- note its keyboard shortcuts.

Rules for doing so:
- Treat it as a behaviour reference only. Do not copy its code, assets, icons, styles or strings into this project.
- Do not replicate its interface. The layout and visual design here are deliberately different.
- Write findings to `docs/reference-notes.md` as plain observations ("supports footnotes", "reloads on save"), then implement from those notes.
- Only do this when a concrete question needs it. Building v1 from the list above does not require it.
- Ask me where the app is installed rather than searching the disk.

## Project layout

```
src/            frontend (TypeScript)
  render/       markdown-it setup, plugins, sanitising
  ui/           sidebar, find bar, theme, empty state
  state/        settings and recent files
src-tauri/      Rust shell: window, menu, file open, watcher, file associations
tests/fixtures/ sample .md files covering every supported feature
docs/           notes and decisions
```

## Commands

```
npm install           install dependencies
npm run tauri dev     run the app in development
npm run build         type-check and build the frontend
npm run tauri build   produce the installable app
npm test              unit tests (Vitest)
npm run lint          ESLint + Prettier check
cd src-tauri && cargo test && cargo clippy --all-targets    Rust tests and lints

scripts/install-app.sh               copy the built app to /Applications + lsregister
scripts/check-fixtures.sh [files]    open fixtures in the installed app, print render reports
scripts/selftest.py                  end-to-end checks via scripted menu actions
scripts/measure-launch.sh [file] [n] cold-launch time (open -> window shown)
node scripts/make-large-fixture.mjs  generate tests/fixtures/large.md (~1 MB, gitignored)
```

The scripts use env-gated hooks in the app (`MDV_TIMING_FILE`, `MDV_DIAG_FILE`,
`MDV_DIAG_SCROLL`, `MDV_SELFTEST`); they need no screen-recording or
accessibility permission. Fixtures are copied to a temp folder first, because
reading from `~/Documents` triggers a macOS privacy prompt.

Keep this section accurate. If you add or rename a script, update it here in the same change.

## How to work

- Build in vertical slices. The first slice is: double-click a `.md` file in Finder and see it rendered in the built app. Then work through the rest of the v1 list in order.
- After each slice, run the app and check it against the fixtures in `tests/fixtures/`. Do not report something as working unless you ran it.
- Rendering logic gets unit tests (input Markdown → expected HTML). Include tests proving `<script>`, `onerror=` and `javascript:` links are neutralised.
- TypeScript in strict mode, no `any`. Rust code passes `cargo clippy` without warnings.
- Keep dependencies few. Before adding one, say what it is for and what it costs in bundle size.
- Small, focused commits with plain descriptive messages. Do not add a `Co-Authored-By` line or a session link to commits.
- Record non-obvious decisions in `docs/decisions.md`, one short paragraph each.
- If something on the v1 list is ambiguous, pick the simplest behaviour, note it in `docs/decisions.md`, and continue. Ask before starting anything from v2.
