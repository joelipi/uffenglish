<!-- The filled story must contain 0 HTML comments and 0 empty sections. Delete unused optional sections entirely. -->

# [Story Title]

## Context

[What problem this solves and why now.]

## Out of Scope

[What is not being built or fixed here.]

## Implementation approach

<!-- Key technical decisions and why. For any data transformation or format mapping,
     state the rules explicitly — including edge cases and exception criteria
     (regex or predicate preferred over prose). -->

## Tasks

<!--
Each task's ACs must be verifiable by an automated test — list them directly under the task heading. Non-automatable requirements go in Notes.
Cover the full behavior surface: edge-case inputs, error states, empty/cleared state, domain rule exceptions.

Format: [precondition] + [action]
  - → [outcome]

Example (unrelated domain):
- valid email + form submitted
  - → success message shown
  - → input field clears
- invalid email + form submitted
  - → error shown below input
  - → form not submitted
- empty field + form submitted
  - → "required" error shown
-->

### Task [N] - [Task Name]

- [precondition] + [action]
  - → [observable outcome]
  - → [observable outcome]
- [precondition] + [action]
  - → [observable outcome]

## Bootstrap

<!-- Required when this feature creates a new app, service, or package.
     Include ALL commands to reach a working dev environment with tests passing:
     scaffold command, all dependency installs (including test/dev deps), and any
     required config. A developer copy-pasting these commands should be ready to go. -->

## Technical Context

<!-- Research and list the latest stable version for every package in Bootstrap (e.g., "React 19.1.0 — no breaking changes in 19.x"). Then add anything else the agent can't infer from the codebase. -->

## Notes

<!-- Non-obvious constraints, non-automatable requirements, UX notes. -->

