# Redo celebrations in the app palette with a guarded build

## Context

The 095 preview showed broken recording alongside the palette change. The palette diff itself touches no recording code, and the preview at the time was once served from a development bundle, so the redo isolates the change: app-colour palettes with a warm accent, the success ending special by scale, and a build verifier that refuses a dev-mode artifact. Recording, playback, speech and the success gating stay untouched.

## Out of Scope

- Any change to recording, playback, speech, the composite, the after-video loop, or success gating and sound.
- New dependencies or engine changes.
- Deleting the old 095 branch; this redo supersedes it from main.

## Implementation approach

Palettes are data in `step-celebration-logic.js`. Each palette carries a near-white piece (luminance >= 0.75) for the blue gradient and black frame, and a deep piece (luminance <= 0.12) for white panels, with the amber accent `#ffc24d` in three of five palettes. The success ending uses a new pure planner with three simultaneous volleys plus a closing volley, larger and longer than any step burst. The build runs a verifier that fails on a dev-mode artifact. Variant choreography is unchanged.

## Tasks

### Task 1 - App palettes with contrast rules

- every palette in the registry + relative luminance check
  - → has a piece >= 0.75 and a piece <= 0.12
  - → has at least 3 pieces
- registry + accent check
  - → `#ffc24d` appears in at least 3 and fewer than all palettes
- any variant + buildCelebrationPlan
  - → burst colors equal one of the variant palettes from the registry
  - → no legacy candy or rainbow hex remains in any palette

### Task 2 - Success ending special by scale

- fire the success plan
  - → three volleys start within 150 ms from distinct origins plus a later closing volley
  - → every volley carries more pieces and more ticks than any step burst
  - → every volley sets zIndex 100 and disableForReducedMotion
- SuccessEffects + unmount
  - → pending volleys are cancelled and no volley fires after teardown

### Task 3 - Build refuses a dev artifact

- production-shaped dist + verifier
  - → ok true
- dev-shaped dist + verifier
  - → ok false naming the missing R2 base and the dev template
- missing index.html, missing chunk reference, unreadable chunk
  - → ok false naming the problem
- `npm run build`
  - → runs vite build then the verifier

## Notes

- Visual check over the lesson gradient and white cards confirms white and navy carry visibility with amber as highlight.
- No recording assertions are added here because recording is untouched; the existing playback-video and answer-flow specs guard it.
