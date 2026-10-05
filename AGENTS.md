# Repository guidance

Standing rules for working in this repository. Detailed incident write-ups live in `docs/learnings.md`.

## Source-guard tests must be able to fail

This repo relies heavily on tests that assert on source text ("guards"). Three separate incidents (see git history and `docs/learnings.md`) produced a guard that could never fail. When writing or editing one:

- **Do not strip comments before scheme/URL assertions.** A `/\/\/.*$/gm` stripper reads the `//` in `https://` as a comment and erases the URL, so the assertion can never fail. Assert on the raw source for scheme checks; use the stripped source only for bare-identifier checks (`window`/`document`).
- **Whole-file `toContain` only works for tokens that appear exactly once.** Over an entire stylesheet/source file it stays green even when the specific rule is deleted. Scope the slice to the specific block (`slice(indexOf(selector), …)`) and assert every property in it.
- **Never slice a function body to EOF.** End the slice at the next top-level marker (`indexOf('export const …')` / the next `export async function …`). A function appended later otherwise silently joins the slice and the guard passes on strings that are not in the target function.

Before trusting a guard, prove it can fail by temporarily injecting the thing it forbids.

## A new `src/**` test file must not mention the recorder page

`src/modules/video/recorder-page.test.js` scans every file under `src/**` for a reference to the operator-only recorder page (`/recorder` / `recorder.html`) and fails on any hit. A new guard test that lives in `src/**` and mentions that page — even in a path constant or a comment — breaks that hidden-page guard. Avoid the literal token in `src/**` (build paths from parts, e.g. `'recorder' + '.html'`), or add the file to the scanner's exclude set.

## New public top-level routes must be registered in `PUBLIC_ROUTES`

`useGuestModalGuard` opens the guest language/login modal for anonymous visitors on every non-auth route unless `isPublicHomeRoute(path)` is true (`src/modules/user/guest-modal-logic.js`). Any page that must be readable without that modal (e.g. `/privacy`, `/terms`) has to be added to `PUBLIC_ROUTES`; the lookup normalizes trailing slashes and case to mirror React Router's matching (`/Privacy`, `/privacy/` resolve to the page). Declare static routes before the single-segment `/:shareCode` catch-all, and cover the non-canonical forms in `guest-modal-logic.test.js`.

## If local `main` advanced without the worktree following, sync before editing

A ref can move ahead of the worktree when another process fetches/updates `main` without checking it out: `git status` then shows the whole delta as one huge staged changeset (here, ~14k deletions of the video pipeline and stories 040–046), and `git log` HEAD is a commit you never checked out. Confirm with `git rev-parse HEAD origin/main` and check whether the index equals another branch's tree (`git write-tree` vs `git rev-parse <ref>^{tree}`). If no work is unique, back it up (`git diff HEAD > /tmp/backup.patch`) and `git reset --hard HEAD` to sync the worktree to the real `main` before editing — never commit or discard a large diff you did not create without that check.

