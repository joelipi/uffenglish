# Reuse the already-deployed `video-background-removal` app so the lesson pipeline deploys without a payment method

## Context

Modal now refuses to deploy a **new persistent GPU function** unless the account has a payment method (`Please add a payment method to use T4 GPU functions`). `modal deploy docs/video-pipeline/modal_app.py` therefore fails on `uff-lesson-video`'s `@app.function(gpu="T4")` — `process_video_background_modal` at `video_pipeline.py:657`. The operator will not add a payment method.

The account already has a **deployed** T4 BiRefNet app, `video-background-removal` (created 2025‑11‑15, still `deployed`), whose `process_video_background_modal(input_video_bytes, background_bytes, is_video_bg, fps=0, fast_mode=True, max_workers=10)` has the **identical signature** to the current code (`git show ff22a55:docs/video-pipeline/video_pipeline.py`). This story makes the pipeline call that deployed function by name and stops registering a GPU function on `uff-lesson-video`, so `modal deploy` ships only CPU functions. BiRefNet and the background-removal behavior are unchanged.

## Out of Scope

- **No payment method, no change to BiRefNet or the background-removal behavior.**
- No redeploy or alteration of the existing `video-background-removal` app — it stays exactly as deployed.
- No change to Stage 1 / Stage 3, the R2 layout, the recorder, or the Pages Functions.
- No change to the one-click dispatch or the sheet tooling.

## Implementation approach

**Separate, not-deployed definition.** Move the GPU function's BiRefNet body and the `modal.Image` it needs into a new module `docs/video-pipeline/background_removal_app.py`, which defines `modal.App("video-background-removal")` and `@bg_app.function(image=..., gpu="T4", timeout=3600) def process_video_background_modal(...)` with the same signature. This module is the redeploy target for the existing deployed app and **must not be imported** by `modal_app.py` or `video_pipeline.py`, so `modal deploy docs/video-pipeline/modal_app.py` never includes a GPU function.

**Resolve the deployed function by name.** In `video_pipeline.py`:
- delete the `@app.function(image=image, gpu="T4", timeout=3600)` registration of `process_video_background_modal`;
- add a resolver, e.g. `def background_removal_remote(): return modal.Function.from_name("video-background-removal", "process_video_background_modal")` (resolved lazily at call time, so an import never fails when the app is absent);
- `process_video_background` calls `background_removal_remote().remote(input_video_bytes, background_bytes, is_video_bg, fps=0, fast_mode=True, max_workers=10)`. A **deployed** function needs no `app.run()` context, so drop that wrapper. If the lookup fails (app/function missing), surface a clear error naming `video-background-removal`.

**App import.** `modal_app.py` drops the load-bearing `process_video_background_modal` import (the `uff-lesson-video` app no longer defines it) and the comment that references it; the app it deploys is `uff-lesson-video` with only the orchestrator + trigger.

## Tasks

### Task 1 - Redeploy module `background_removal_app.py`

- `docs/video-pipeline/background_removal_app.py` exists and defines `modal.App("video-background-removal")` plus a `gpu="T4"` function named `process_video_background_modal` with the exact signature `(input_video_bytes, background_bytes, is_video_bg, fps=0, fast_mode=True, max_workers=10)`
  - → source guard asserts the app name, the function name and `gpu="T4"` are present
- `modal_app.py` and `video_pipeline.py` do not import `background_removal_app`
  - → source guard asserts neither file mentions `background_removal_app` (so the deploy graph excludes the GPU function)

### Task 2 - `video_pipeline.py` resolves the deployed function

- `video_pipeline.py` source
  - → contains no `gpu="T4"` (the `uff-lesson-video` app registers no GPU function)
  - → still contains `app = modal.App("uff-lesson-video")`
  - → contains a resolver referencing `modal.Function.from_name("video-background-removal", "process_video_background_modal")`
- `process_video_background` + a stubbed resolver returning a fake object with `.remote`
  - → calls `.remote(input_video_bytes, background_bytes, is_video_bg, fps=0, fast_mode=True, max_workers=10)` and returns its result
  - → does not open an `app.run()` context
- the resolver with a stubbed `modal.Function.from_name` that raises
  - → raises an error whose message names `video-background-removal`

### Task 3 - Deploy graph has no GPU function

- a source guard over the import graph of `modal_app.py` (`modal_app.py` + `video_pipeline.py`, excluding `background_removal_app.py`)
  - → contains no `gpu=` argument and no `@app.function` with a GPU

### Task 4 - Update existing source guards

- `docs/video-pipeline/tests/test_pipeline_source.py`
  - → the old assertions (`assertIn("def process_video_background_modal")`, `assertIn('gpu="T4"')`, `assertNotIn("video-background-removal")` in the same file) are replaced to match the new wiring, and still fail if the new wiring is removed

## Technical Context

- Deployed app: Cloudflare-independent; Modal app `video-background-removal` (created 2025‑11‑15) with `process_video_background_modal` under `@app.function(image=image, gpu="T4", timeout=3600)` — identical signature to the current code.
- Current call sites: `video_pipeline.py:657-658` (definition), `:774` (`process_video_background`), `:787-793` (`app.run()` + `.remote()`); `modal_app.py:9,23` (load-bearing import + comment).
- `modal.Function.from_name(app_name, function_name)` resolves a deployed function; `.remote(...)` calls it from anywhere (including inside a Modal container).
- Existing guard: `docs/video-pipeline/tests/test_pipeline_source.py:167-170` asserts `app = modal.App("uff-lesson-video")`, **not** `video-background-removal`, `def process_video_background_modal`, and `gpu="T4"`.
- Test runner: `npm run test:python` (unittest).

## Notes

- **Risk:** the deployed `video-background-removal` function is whatever was deployed 2025‑11‑15; its internals may differ from the current repo's BiRefNet. The operator has used it without issue. If it errors or the function name differs, the render fails with a clear lookup error.
- **Dependency:** the pipeline now depends on that app staying deployed; deleting it breaks background removal (and the repo can re-create it via `modal deploy docs/video-pipeline/background_removal_app.py` only if a payment method is later added).
- Deploy after this change: `modal deploy docs/video-pipeline/modal_app.py` on `uff-lesson-video` (no GPU function → no payment-method gate).
