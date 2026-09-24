# OpenChamber workflow for this repo

Several AI agents work on this repo at the same time. If two agents share one
checkout, they move each other's git branch and commits land in the wrong
place. The fix is **git worktrees**: each agent gets its own folder and its own
branch, sharing one `.git`.

## The one rule

**Start every new chat as a worktree session** — the worktree button at the top
of the session sidebar — **not** as a regular session.

Regular sessions run in the project root and inherit whatever branch that folder
happens to be on. That is what made branches change underneath agents, and why
you could never get back to `main`. Worktree sessions pick their own branch at
creation, so the root's branch stops mattering.

## Start a new story

1. Session sidebar → **new worktree** button.
2. Choose **new branch**, start from **`main`**. The name does not matter — the
   planner agent runs `peck story create` inside the chat and that creates the
   real `NNN-story-name` branch.
3. In that chat, ask for the feature to be planned. The planner runs
   `peck story create "<name>"` inside the worktree, which creates the story
   branch and the `stories/NNN-.../story.md` scaffold.
4. Plan, implement, and review — all in that one chat.
5. When it is done: **Git view → Integrate** to land the commits on `main`, then
   archive/delete the session to remove the worktree.

For a story that is already planned (the branch already exists), create the
worktree session on the **existing branch** instead.

## What worktree setup does automatically

When a worktree is created, the setup commands run inside it:

- run `npm install` in the root if `node_modules` is missing;
- symlink `node_modules` from the root (avoids a 1.4 GB copy per worktree);
- copy `.env`;
- copy the `.opencode/` config — `peck.json`, the agent definitions, and the
  OpenCode project config — and symlink its `node_modules`;
- run `scripts/openchamber-worktree-setup.mjs`, which installs the custom agents
  into the **global** OpenCode config (`~/.config/opencode/agents/`) and adds
  the subagent-completion plugin to the global plugin list. Worktree instances
  do **not** discover the worktree's own `.opencode/agents`, so the agents must
  be global or worktree chats crash (see below).

Setup lives in two places: `.openchamber/project.json` (committed, for anyone
who clones) and your personal OpenChamber project settings. Your personal copy
uses `replace` mode, so it applies no matter what branch the root is on.

## New machine / fresh install

`.opencode/agents/`, `.opencode/peck.json`, `.opencode/opencode.jsonc`, and
`scripts/openchamber-worktree-setup.mjs` are committed, so a clone has
everything the worktrees need. The first worktree bootstraps the rest:
`npm install` runs in the root, then the setup script installs the global agents
and plugin.

The one thing that cannot be committed: create `.env` in the repo root with the
Supabase/PostHog keys (`.env.example` is a template). It is gitignored, and the
setup copies it into each worktree. The OpenCode provider key lives in the
machine-global `~/.config/opencode/opencode.jsonc`, so set that up too (or run
OpenChamber's provider login).

## Rules of thumb

- One branch = one worktree; one active chat per worktree.
- Do not reuse a worktree for a different story.
- Do not worry about the root's branch — worktree sessions choose their start
  point themselves.
- Give parallel worktrees different dev ports: `npm run dev` defaults to 3000
  and Playwright uses 5173, so two servers collide on the same port.
- Shared `node_modules` is symlinked; for a story that adds a dependency, run
  the install in the root so all worktrees see it.

## If something breaks

- **`peck config not found`** — the worktree is missing `.opencode`, so setup
  did not run. Check Settings → Projects → worktree setup commands.
- **Stale worktrees** — `git worktree list` to see them; archive the session in
  OpenChamber, or `git worktree remove <path>`.
- **A branch changed under an agent** — that agent was running in the shared
  root checkout, not in a worktree.
- **Worktree flagged as detached / missing** — see the OpenChamber
  Worktrees & Git troubleshooting page.
- **A worktree chat stops immediately with `UnknownError` /
  `SessionPrompt.createUserMessage`** — the custom agents are not visible to
  that worktree's OpenCode instance. OpenCode only loads project `.opencode`
  from the directory the server was started in, so a worktree's own
  `.opencode/agents` is ignored. Confirm `~/.config/opencode/agents/` contains
  `planner.md`, `implementer.md`, `code-reviewer.md`, `acceptance-reviewer.md`
  and that `opencode-subagent-completion-hook` is in the global plugin list in
  `~/.config/opencode/opencode.jsonc`. Then restart OpenCode or create a fresh
  worktree — instances created before the fix keep the empty agent list cached.
