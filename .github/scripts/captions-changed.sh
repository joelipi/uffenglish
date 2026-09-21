#!/usr/bin/env bash
# Resolves the base revision and the list of changed src/config/*.json files
# for the caption workflow (stories/009-auto-caption-simple-videos).
# Outputs base=<sha> and files=<space-separated paths> via $GITHUB_OUTPUT.
set -euo pipefail

# Prefer the push event's `before` SHA when it is a usable commit; otherwise
# (new branch / force-push with before == 000..0) fetch the default branch and
# fall back to the merge-base with origin/main.
BASE=""
if [[ -n "${GITHUB_EVENT_PATH:-}" && -f "$GITHUB_EVENT_PATH" ]]; then
  BASE="$(node -e 'const e = require(process.env.GITHUB_EVENT_PATH); process.stdout.write(e.before || "")')"
fi

if [[ "$BASE" =~ ^[0-9a-f]{40}$ ]] && [[ "$BASE" != "0000000000000000000000000000000000000000" ]] && git cat-file -e "$BASE^{commit}" 2>/dev/null; then
  echo "Using push-event base $BASE"
else
  echo "Push-event base unusable; falling back to merge-base with origin/main"
  git fetch origin main
  BASE="$(git merge-base HEAD origin/main)"
fi

HEAD="${GITHUB_SHA:-HEAD}"
FILES="$(git diff --name-only "$BASE" "$HEAD" -- 'src/config/*.json' || true)"

# Multi-line values need the heredoc delimiter form of $GITHUB_OUTPUT, or
# GitHub would truncate `files` to its first line.
{
  echo "base=$BASE"
  echo "files<<EOF"
  echo "$FILES"
  echo "EOF"
} >> "$GITHUB_OUTPUT"