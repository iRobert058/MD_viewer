#!/bin/sh
# Open fixtures in the installed app and print what each window rendered.
# Fixtures are copied to a temp folder first so macOS privacy prompts for
# ~/Documents do not interfere. Usage:
#   scripts/check-fixtures.sh [fixture.md ...]   (default: all top-level fixtures)
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -R "$REPO/tests/fixtures" "$WORK/fixtures"
DIAG="$WORK/diag.jsonl"

if [ "$#" -eq 0 ]; then
  set -- gfm.md images.md xss.md links.md basic.md "folder with spaces/naïve café.md" sub/nested.md
fi
COUNT=$#
ARGS=""
for f in "$@"; do ARGS="$ARGS\n$WORK/fixtures/$f"; done

osascript -e 'with timeout of 10 seconds' -e 'tell application "Markdown Viewer" to quit' -e 'end timeout' 2>/dev/null || true
while pgrep -qf "Markdown Viewer.app/Contents/MacOS"; do sleep 0.2; done

printf "%b" "$ARGS" | sed '1d' | tr '\n' '\0' |
  xargs -0 open -a "Markdown Viewer" --env MDV_DIAG_FILE="$DIAG"

for _ in $(seq 1 150); do
  [ -f "$DIAG" ] && [ "$(wc -l < "$DIAG")" -ge "$COUNT" ] && break
  sleep 0.1
done
python3 - "$DIAG" "$COUNT" <<'PY'
import json, sys
path, want = sys.argv[1], int(sys.argv[2])
try:
    lines = open(path).read().splitlines()
except FileNotFoundError:
    lines = []
print(f"{len(lines)}/{want} windows reported")
for l in lines:
    d = json.loads(l)
    print(json.dumps({"window": d["label"], **d["report"]}, ensure_ascii=False))
PY
