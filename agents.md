# Agent Instructions (`agents.md`)

## 1. Code Architecture & Organization

**Pure React — No DOM Manipulation**
This codebase is moving strictly to React patterns. Never use `document.querySelector`, `getElementById`, `classList`, `style.setProperty`, `appendChild`, or any direct DOM API. Drive all UI changes through React state, refs (for focus/measurement only), and CSS classes on React elements. Violations of this rule will be treated as bugs.

**Modular Structure**
Keep logic in the module where it conceptually belongs. Do not co-locate unrelated concerns.

**Resource & Cost Optimization**
Minimize external operations. All data fetching and mutations must go through TanStack Query and Zustand — never call Appwrite or any external service directly from components or hooks. Prefer in-browser, client-side model operations over external LLM API calls to reduce cost and lay groundwork for offline mode. Balance local-first execution against device CPU/memory constraints.

**Version Control**
Primary branch is `main`.

---

## 2. Comments & Logging

- **Preserve comments.** Update them when the code they describe changes. Only delete a comment if its code is deleted.
- **Preserve `console.log` statements.** Do not remove existing logs unless the code they relate to has also been removed; comment them out if suppression is needed.
- **Add debug and success logging.** Every significant function or event should log both on failure (with detail) and on success (so it's immediately clear the path fired).

---

## 3. Autonomy & Approvals

Execute small, incremental changes and routine bug fixes immediately without asking for approval.

---

## 4. Testing & Console Monitoring

**Automated browser testing** via Playwright unless the user says they will test manually.

**Console discipline — treat these as bugs:**
- Any unexpected or relevant console error or warning
- Any expected debug/success log that does not appear (silent failures must be investigated)

**Clean up after deletions.** After removing any export, verify all imports of that export are also removed. Run the smoke test to catch load-time errors:
```
tests/answer-flow.spec.js
```

**Test URL:** `http://localhost:3000/course/model/lesson/g`
Lessons require a full URL where `course` and `model` map to valid JSON files and `lesson` is a valid key within that JSON, unless lesson data is already in memory.

---

## 5. App-Specific Testing Workarounds

**Speech-to-Text / Microphone**
You cannot use a microphone. Bypass it using built-in testing functions, or invoke `handleAnswer` (or equivalent) directly to simulate audio input.

**Authentication**
Do not log in unless the task explicitly requires it — login interferes with guest-user testing.
Credentials (use only when required):
- Email: `jules@example.com`
- Password: `testtest`