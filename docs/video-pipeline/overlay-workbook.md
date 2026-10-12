# Overlay workbook: a formula-driven MAIN + INPUT master sheet

The exported overlay-master CSV repeats a small set of unique cells hundreds
of times: the lesson title on every row of the lesson, the six-block
`success_srt` on every row of the file, and each step's four `phrase` values
re-typed inside every `subtitle_text` overlay. Those repetitions used to be
spreadsheet formulas (concatenation + cell references), but a CSV export keeps
values only — so the formulas were lost, and every edit since has meant
retyping the same text in dozens of places.

`docs/video-pipeline/overlay_workbook.py` rebuilds them. It reads any
overlay-master CSV (the 58-column seeded master or the wider production master
with `next_step` / `choose_step_*` / `publish_lesson_id` / `srt_<lang>`
columns) and writes an `.xlsx` workbook with two sheets:

- **INPUT — the only sheet to edit.** Every unique text value stored exactly
  once: `globals` (one value file-wide: `title_text`, `success_srt*`, …),
  `lessons` (one row per `lesson_id`), `steps` (one row per step — the `join`
  value when set, else `video_file`), and `takes` (one row per `filename`:
  the `phrase` / `phrase_<lang>` source of truth). Single-take rows whose
  overlay no concatenation can rebuild (intros, branching questions) keep
  their full `subtitle_text` in a small `overlays` table.
- **MAIN — formulas only.** Same header and row order as the CSV: globals as
  `=INPUT!$B$..`, shared values as `VLOOKUP` by `filename` / lesson / step
  (the `_step` helper holds `join`-else-`video_file`), and each take-group
  overlay as a `&` concatenation that splices its four `phrase` cells into the
  observed template (progressive `<strong>` highlight, `___________`
  placeholders for later takes). Only `filename`, `order`, and `_step` are
  plain values.

## Regenerate

```sh
python3 docs/video-pipeline/overlay_workbook.py \
  --in docs/video-pipeline/master-seeded.csv \
  --out docs/video-pipeline/overlay-master.workbook.xlsx
```

Needs `openpyxl` (`pip install openpyxl`). Point `--in` at the production
export for the real file. Import the `.xlsx` into Google Sheets (File →
Import → Upload, replace) and share it as the new master; the published CSV
the render pipeline and the config generator read is produced from the
*evaluated* sheet, so formulas survive going forward.

## Rules that keep it working

- **Edit text only on INPUT.** A MAIN cell showing the old text means its
  INPUT source still holds it — fix it there once, every row follows.
- **Never edit the exported CSV.** It carries values only, which is how the
  formulas were lost. The `.xlsx` / Google Sheet is the source of truth.
- **Keep a take-group's four rows together** in take order (`order` 1–4):
  each overlay formula points at its group's four `phrase` cells. To add
  takes, append rows to the INPUT `takes` table, then append MAIN rows reusing
  the neighboring formulas (adjust the `&` refs to the new phrase cells).
- **`srt` stays pipeline-written.** The render computes it and the sync-srt
  Action writes it back; its MAIN cells are lookups, not concatenations, so a
  re-render never fights an operator formula. `subtitle_text` is the opposite:
  operator-owned overlay markup, rebuilt live from `phrase`.
- **Joined steps, separate overlays.** The two halves of a join
  (`wouldyourather_b01_i` / `_ii`) share one config step but each renders its
  own four-take overlay — the formulas follow the `video_file` group, not the
  join, so editing one half never touches the other.
