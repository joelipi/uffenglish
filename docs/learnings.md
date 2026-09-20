# Learnings

## Inspect `git diff` before staging — pre-existing working-tree changes get swept into commits
**Date**: 2026-09-20
**Area**: workflow
**What happened**: A `.gitignore` commit intended to remove `/docs` accidentally also committed a pre-existing uncommitted `.env` ignore line that was sitting in the working tree. The code reviewer flagged it as a no-op that contradicted the adjacent comment.
**Takeaway**: Before `git add`, run `git diff` on each file you are about to stage and confirm every hunk is yours. Pre-existing uncommitted changes (e.g. from the environment) are easy to sweep in.

---

## `.env` is tracked but carries an uncommitted sandpod-managed token block — never stage it
**Date**: 2026-09-20
**Area**: workflow | security
**What happened**: The working-tree `.env` contains a sandpod-managed block (`EXPO_TOKEN`, `GH_TOKEN`, `GH_NEW_TOKEN`) that is uncommitted; the committed `.env` only holds public `VITE_*` keys. A reviewer flagged the token as a credential risk.
**Takeaway**: Never `git add .env`. If you must change it, edit only the committed `VITE_*` keys. The sandpod block is overwritten by the environment and must not be committed.

---