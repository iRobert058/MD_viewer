#!/usr/bin/env python3
"""End-to-end checks of the installed app, driven through its menu handlers.

Needs no screen-recording or accessibility permission: the app runs scripted
menu actions (MDV_SELFTEST) and writes what each window shows to a local file
(MDV_DIAG_FILE). Your real settings file is backed up and restored.

    npm run tauri build && scripts/install-app.sh && scripts/selftest.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
APP = "Markdown Viewer"
SETTINGS = Path.home() / "Library/Application Support/nl.robertkarzijn.markdownviewer/settings.json"

failures: list[str] = []


def check(name: str, ok: bool, detail: object = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if not ok and detail != "" else ""))
    if not ok:
        failures.append(name)


def running() -> bool:
    return subprocess.run(["pgrep", "-qf", f"{APP}.app/Contents/MacOS"]).returncode == 0


def quit_app() -> None:
    subprocess.run(
        ["osascript", "-e", "with timeout of 10 seconds", "-e", f'tell application "{APP}" to quit', "-e", "end timeout"],
        capture_output=True,
    )
    for _ in range(50):
        if not running():
            return
        time.sleep(0.2)
    raise SystemExit("app did not quit")


def launch(files: list[Path], env: dict[str, str]) -> None:
    args = ["open", "-a", APP]
    for k, v in env.items():
        args += ["--env", f"{k}={v}"]
    subprocess.run(args + [str(f) for f in files], check=True)


def reports(diag: Path) -> list[dict]:
    if not diag.exists():
        return []
    return [json.loads(line) for line in diag.read_text().splitlines()]


def wait_reports(diag: Path, count: int, timeout: float = 20) -> list[dict]:
    end = time.time() + timeout
    while time.time() < end:
        r = reports(diag)
        if len(r) >= count:
            return r
        time.sleep(0.2)
    return reports(diag)


def main() -> int:
    work = Path(tempfile.mkdtemp())
    shutil.copytree(REPO / "tests/fixtures", work / "f")
    gfm = work / "f/gfm.md"
    backup = work / "settings.backup.json"
    had_settings = SETTINGS.exists()

    if running():
        quit_app()
    if had_settings:
        shutil.copy2(SETTINGS, backup)
        SETTINGS.unlink()

    try:
        # 1. Menu actions in a running window.
        diag = work / "d1.jsonl"
        script = ",".join(
            [
                "report",                          # 1 defaults
                "theme-dark", "report",            # 2
                "theme-light", "zoom-in", "zoom-in", "toggle-sidebar", "report",  # 3
                "find", "find-query:duplicate", "report",  # 4
                "find-next", "report",             # 5
                "find-query:zzzz-no-match", "report",  # 6
                "settings", "report",              # 7
            ]
        )
        launch([gfm], {"MDV_DIAG_FILE": str(diag), "MDV_SELFTEST": script})
        r = [x["report"] for x in wait_reports(diag, 8)]
        check("8 reports received", len(r) >= 8, len(r))
        if len(r) >= 8:
            _, d0, d1, d2, d3, d4, d5, d6 = r[:8]
            check("defaults: system theme, zoom 1, sidebar shown",
                  d0["theme"] == "system" and d0["ui"]["zoom"] == "1" and not d0["ui"]["sidebarHidden"], d0["ui"])
            check("theme-dark sets dark theme and dark background",
                  d1["theme"] == "dark" and d1["background"] == "rgb(28, 29, 32)", (d1["theme"], d1["background"]))
            check("theme-light sets light theme and white background",
                  d2["theme"] == "light" and d2["background"] == "rgb(255, 255, 255)", (d2["theme"], d2["background"]))
            check("zoom-in twice gives 1.2 and larger text",
                  d2["ui"]["zoom"] == "1.2" and d2["fontSize"] == "20.4px", (d2["ui"]["zoom"], d2["fontSize"]))
            check("toggle-sidebar hides the outline", d2["ui"]["sidebarHidden"] and d2["ui"]["sidebarWidth"] == 0, d2["ui"])
            check("find opens the bar and counts matches",
                  d3["ui"]["findOpen"] and d3["ui"]["findStatus"] == "1 of 2" and d3["ui"]["findHighlights"] == 2,
                  d3["ui"])
            check("find-next moves to the next match", d4["ui"]["findStatus"] == "2 of 2", d4["ui"]["findStatus"])
            check("no match is reported", d5["ui"]["findStatus"] == "No matches", d5["ui"]["findStatus"])
            check("Cmd+, opens the settings dialog", d6["ui"]["settingsOpen"] is True, d6["ui"])
        quit_app()

        # 2. Settings were saved.
        saved = json.loads(SETTINGS.read_text()) if SETTINGS.exists() else {}
        check("settings saved: theme, zoom, sidebar",
              saved.get("theme") == "light" and saved.get("zoom") == 1.2 and saved.get("sidebarVisible") is False,
              saved)
        recent = [Path(p).name for p in saved.get("recentFiles", [])]
        check("recent files include gfm.md", "gfm.md" in recent, recent)

        # 3. ...and restored on the next launch, with the remembered window size.
        diag = work / "d2.jsonl"
        launch([work / "f/basic.md"], {"MDV_DIAG_FILE": str(diag)})
        r = [x["report"] for x in wait_reports(diag, 1)]
        if r:
            d = r[0]
            check("theme, zoom and sidebar restored after relaunch",
                  d["theme"] == "light" and d["ui"]["zoom"] == "1.2" and d["ui"]["sidebarHidden"], d["ui"])
        else:
            check("relaunch report received", False)
        quit_app()

        # 4. Closing the last window keeps the app running; reopening gives an empty window.
        diag = work / "d3.jsonl"
        launch([work / "f/basic.md"], {"MDV_DIAG_FILE": str(diag), "MDV_SELFTEST": "close,wait:500"})
        wait_reports(diag, 1)
        time.sleep(3)
        check("app keeps running after its last window closes", running())
        subprocess.run(["open", "-a", APP], check=True)
        r = wait_reports(diag, 2)
        check("reopening shows an empty window",
              len(r) >= 2 and r[1]["report"]["hidden"]["empty"] is False, [x["report"]["title"] for x in r])
        quit_app()
    finally:
        if running():
            quit_app()
        if had_settings:
            shutil.copy2(backup, SETTINGS)
        elif SETTINGS.exists():
            SETTINGS.unlink()
        shutil.rmtree(work, ignore_errors=True)

    print(f"\n{'All checks passed' if not failures else f'{len(failures)} check(s) failed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
