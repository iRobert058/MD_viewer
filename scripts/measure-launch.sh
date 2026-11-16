#!/bin/sh
# Measure cold launch: time from `open` to the first document render being
# reported by the app (window shown with content). Usage:
#   scripts/measure-launch.sh [file.md] [runs]
set -eu
FILE="${1:-tests/fixtures/basic.md}"
RUNS="${2:-5}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }

for i in $(seq 1 "$RUNS"); do
  osascript -e 'quit app "Markdown Viewer"' 2>/dev/null || true
  while pgrep -qf "Markdown Viewer.app/Contents/MacOS"; do sleep 0.2; done
  rm -f "$TMP/t.jsonl"
  T0=$(now_ms)
  open -a "Markdown Viewer" --env MDV_TIMING_FILE="$TMP/t.jsonl" "$FILE"
  for _ in $(seq 1 100); do [ -s "$TMP/t.jsonl" ] && break; sleep 0.05; done
  [ -s "$TMP/t.jsonl" ] || { echo "run $i: no timing reported" >&2; continue; }
  python3 - "$TMP/t.jsonl" "$T0" "$i" <<'PY'
import json, sys
d = json.loads(open(sys.argv[1]).readline())
print(f"run {sys.argv[3]}: open->shown {d['epochMs'] - int(sys.argv[2])} ms "
      f"(process start->shown {d['sinceProcessStartMs']:.0f} ms, frontend {d['renderMs']:.0f} ms)")
PY
done
