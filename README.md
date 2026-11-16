# Markdown Viewer

A fast, quiet Markdown viewer for macOS. Double-click a `.md` file in Finder and
it opens rendered, in its own window. No ads, accounts, telemetry or network
requests; everything ships inside the app.

## Features

- GitHub Flavored Markdown: tables, task lists, footnotes, strikethrough,
  autolinks, fenced code with syntax highlighting.
- Live reload when the file changes on disk, keeping your place.
- Relative images and links to other Markdown files resolve against the file's
  folder. Links to Markdown files open in the app; web links open in your browser.
- Outline sidebar (⌃⌘S), find (⌘F, ⌘G, ⇧⌘G), zoom (⌘=, ⌘-, ⌘0).
- Light and dark themes that follow the system, with an override under
  View › Appearance or Settings (⌘,).
- Remembers theme, zoom, sidebar and window size. Recent files are under
  File › Open Recent.

Remote images (`![](https://…)`) are not loaded, so opening a file never makes
a network request. They show as a small placeholder with the image's alt text.

## Make it the default app for Markdown

Either:

- choose **Markdown Viewer › Make Default Markdown Viewer…** (macOS asks you to
  confirm), or
- in Finder, select any `.md` file, choose **File › Get Info**, pick
  Markdown Viewer under **Open with**, and click **Change All…**.

The first time a document shows images from a protected folder such as
Documents or Desktop, macOS asks whether Markdown Viewer may access that folder.

## Build and install

Requirements: Node.js, Rust (via [rustup](https://rustup.rs)), Xcode command
line tools.

```sh
npm install
npm run tauri build        # builds src-tauri/target/release/bundle/macos/Markdown Viewer.app
scripts/install-app.sh     # copies it to /Applications and refreshes Launch Services
```

The build is ad-hoc signed for use on your own Mac; it is not notarised.

## Development

```sh
npm run tauri dev          # run with hot reload (file associations do not work here)
npm test                   # unit tests (Vitest)
npm run lint               # ESLint + Prettier
cd src-tauri && cargo test && cargo clippy --all-targets
```

Checks against the installed app (no screen-recording permission needed):

```sh
scripts/check-fixtures.sh     # open the fixtures, report what each window rendered
scripts/selftest.py           # drive menus, find, links, settings, reopen
scripts/measure-launch.sh     # cold-launch time, open -> window shown
node scripts/make-large-fixture.mjs   # writes tests/fixtures/large.md (~1 MB)
```

See `docs/decisions.md` for design decisions.

## License

MIT, see [LICENSE](LICENSE).
