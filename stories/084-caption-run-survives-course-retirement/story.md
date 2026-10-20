# The caption run survives a course retirement (a deleted config is not a changed config)

## Context

Retiring the unused course configs (story 077) removed
`src/config/friend.json`, `gt2.json`, `t.json`, `test.json`, `test-api.json`,
`wouldrather.json`, `friendchain.json` — and the **caption workflow on `main`
started failing**:

```
Error: ENOENT: no such file or directory, open
'/home/runner/work/uffenglish/uffenglish/src/config/friend.json'
##[error]Process completed with exit code 1.
```

`.github/scripts/captions-changed.sh` resolves the configs the push touched with
`git diff --name-only "$BASE" "$HEAD" -- 'src/config/*.json'`. A **retired**
config appears in that diff as a **deletion**, so the list handed to
`scripts/generate-captions.mjs` named a file that no longer exists, and the
generator died on it. The caption run is the only thing that reads the changed
configs, so the failure was invisible in the app and only showed up as a red
workflow on `main`.

## The fix

The resolver lists only the configs that **still exist**: a deletion is not a
changed config, and a course retirement must not break the caption run.

```bash
FILES=""
while IFS= read -r file; do
  [[ -n "$file" && -f "$file" ]] && FILES="$FILES $file"
done < <(git diff --name-only "$BASE" "$HEAD" -- 'src/config/*.json' || true)
```

The existence check is on the working tree, so it also covers a config that was
renamed or moved.

## Acceptance criteria

1. a deleted config is not passed to the caption generator
   → `scripts/generate-captions.test.js` runs the resolver in a throwaway git
     repo (one config retired, one changed) and asserts the output names the
     changed config and not the retired one
2. the guard can fail
   → proved by mutation before the commit (dropping the `-f` check turns it red)
3. `npx vitest run` reports 0 failures
   → recorded in the completion report

## Out of scope

- **The caption generator itself** — it is fine; it was handed a file that does
  not exist.
- **The workflow's triggers** — unchanged.
