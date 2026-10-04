# Repository guidance

Standing rules for working in this repository. Detailed incident write-ups live in `docs/learnings.md`.

## Source-guard tests must be able to fail

This repo relies heavily on tests that assert on source text ("guards"). Three separate incidents (see git history and `docs/learnings.md`) produced a guard that could never fail. When writing or editing one:

- **Do not strip comments before scheme/URL assertions.** A `/\/\/.*$/gm` stripper reads the `//` in `https://` as a comment and erases the URL, so the assertion can never fail. Assert on the raw source for scheme checks; use the stripped source only for bare-identifier checks (`window`/`document`).
- **Whole-file `toContain` only works for tokens that appear exactly once.** Over an entire stylesheet/source file it stays green even when the specific rule is deleted. Scope the slice to the specific block (`slice(indexOf(selector), …)`) and assert every property in it.
- **Never slice a function body to EOF.** End the slice at the next top-level marker (`indexOf('export const …')` / the next `export async function …`). A function appended later otherwise silently joins the slice and the guard passes on strings that are not in the target function.

Before trusting a guard, prove it can fail by temporarily injecting the thing it forbids.
