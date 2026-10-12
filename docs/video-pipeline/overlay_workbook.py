#!/usr/bin/env python3
"""Rebuild an overlay-master CSV as a formula-driven MAIN + INPUT workbook.

The exported CSV repeats a small set of unique cells dozens of times (one
``success_srt`` block on every row, the lesson title on every row of the
lesson, the four ``phrase`` values re-typed inside every ``subtitle_text``
overlay, ...). Those repetitions used to be spreadsheet formulas, but a CSV
export keeps values only, so the formulas were lost.

This script reconstructs them: it reads an overlay-master CSV (the 58-column
seeded master or the wider production master with ``next_step`` /
``choose_step_*`` / ``publish_lesson_id`` / ``srt_<lang>`` columns) and writes
an ``.xlsx`` workbook with two sheets:

* ``INPUT`` — every unique text value, stored exactly once: global constants
  (``title_text``, ``success_srt*``, ...), one row per lesson (``lesson_title``,
  ``recap_sources``, ``intro_video``, ...), one row per step (``response_type``,
  ``srt``, ``choose_step_*``, ...), and one row per take (``phrase``,
  ``phrase_<lang>``). This is the only sheet the operator edits.
* ``MAIN`` — the same header and row order as the CSV, but every repeatable
  cell is a formula: ``=INPUT!$B$..`` for globals, ``VLOOKUP`` by ``filename``
  / lesson / step for shared values, and ``&`` concatenation that rebuilds
  each ``subtitle_text`` overlay from its step's four ``phrase`` cells.

Only the row keys (``filename``, ``order``) and the ``_step`` helper stay
plain values on ``MAIN``. Google Sheets and Excel evaluate the formulas on
import, so File -> Download / Publish still yields the flat CSV the render
pipeline and the config generator read. Never edit that exported CSV: it
carries values only, which is how the formulas were lost in the first place.

Usage:
    python3 docs/video-pipeline/overlay_workbook.py \
        --in docs/video-pipeline/master-seeded.csv \
        --out docs/video-pipeline/overlay-master.workbook.xlsx

Requires ``openpyxl`` for the ``--out`` write step
(``pip install openpyxl``); every planning function below is stdlib-only so
the unit tests run without it.
"""

import argparse
import csv
import sys
from collections import defaultdict

INPUT_SHEET = "INPUT"
MAIN_SHEET = "MAIN"

KEY_COL = "filename"
ORDER_COL = "order"
PHRASE_COL = "phrase"
SUBTITLE_COL = "subtitle_text"
JOIN_COL = "join"
VIDEO_FILE_COL = "video_file"
LESSON_COL = "lesson_id"
PHRASE_LANG_COLS = ("phrase_es", "phrase_pt", "phrase_bn")
HELPER_STEP_COL = "_step"

# Structural keys live where the rows live; everything else must be a formula.
VALUE_COLS = (KEY_COL, ORDER_COL)
# Row identity lookups: resolved from the per-take table by filename, so they
# stay correct no matter how rows are sorted (never a circular reference).
KEY_LOOKUP_COLS = (LESSON_COL, VIDEO_FILE_COL, JOIN_COL)

PLACEHOLDER = "___________"


def read_csv_rows(path):
    """Read an overlay-master CSV. Returns (headers, rows as list of dicts)."""
    with open(path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        headers = list(reader.fieldnames or [])
        rows = [dict(row) for row in reader]
    for row in rows:
        for key in headers:
            if row.get(key) is None:
                row[key] = ""
    return headers, rows


def step_key_for_row(row):
    """A step is the ``join`` value when non-blank, else ``video_file``.

    Blank means exactly ``""`` (matching the ``=IF(join="",video,join)`` MAIN
    formula). No whitespace normalization: a value of ``"  "`` is content, so
    Python and the sheet always derive the same key.
    """
    join = row.get(JOIN_COL) or ""
    if join != "":
        return join
    return row.get(VIDEO_FILE_COL) or ""


def sibling_groups(rows):
    """Map step_key -> list of row indices, in sheet order."""
    groups = defaultdict(list)
    for index, row in enumerate(rows):
        groups[step_key_for_row(row)].append(index)
    return dict(groups)


def subtitle_groups(rows):
    """Map video_file -> list of row indices, in sheet order.

    The burnt-in overlay is rendered per take-group (``video_file``, always a
    block of takes 1-4), not per joined step: the two halves of a join
    (``wouldyourather_b01_i`` / ``_ii``) each carry their own four-take
    overlay. Rows with a blank ``video_file`` (intros, branching questions)
    stand alone and always fall back to a stored overlay value.
    """
    groups = defaultdict(list)
    for index, row in enumerate(rows):
        key = row.get(VIDEO_FILE_COL) or ""
        groups[(VIDEO_FILE_COL, key) if key else ("row", index)].append(index)
    return dict(groups)


def order_of(row):
    """Numeric take order; non-numeric orders sort last."""
    try:
        return int(str(row.get(ORDER_COL, "")).strip())
    except ValueError:
        return 10**9


def classify_columns(headers, rows):
    """Classify every header by how its values repeat.

    Kinds: ``value`` (row keys, kept as values), ``key`` (looked up by
    filename), ``phrase`` (per-take text), ``subtitle`` (concatenated overlay),
    ``global`` (one non-blank value file-wide), ``blank`` (blank file-wide),
    ``lesson`` (constant within each lesson), ``step`` (constant within each
    step), ``per_row`` (varies inside a step; stored per filename).
    """
    kinds = {}
    for col in headers:
        if col in VALUE_COLS:
            kinds[col] = "value"
            continue
        if col in KEY_LOOKUP_COLS:
            kinds[col] = "key"
            continue
        if col == PHRASE_COL or col in PHRASE_LANG_COLS:
            kinds[col] = "phrase"
            continue
        if col == SUBTITLE_COL:
            kinds[col] = "subtitle"
            continue
        values = [row.get(col, "") for row in rows]
        if len(set(values)) == 1:
            kinds[col] = "blank" if values[0] == "" else "global"
            continue
        by_lesson = defaultdict(set)
        for row in rows:
            by_lesson[row.get(LESSON_COL, "")].add(row.get(col, ""))
        if all(len(seen) == 1 for seen in by_lesson.values()):
            kinds[col] = "lesson"
            continue
        by_step = defaultdict(set)
        for row in rows:
            by_step[step_key_for_row(row)].add(row.get(col, ""))
        if all(len(seen) == 1 for seen in by_step.values()):
            kinds[col] = "step"
            continue
        kinds[col] = "per_row"
    return kinds


def excel_col_letter(number):
    """1-based column number -> Excel letters (1 -> 'A', 28 -> 'AB')."""
    letters = ""
    while number > 0:
        number, rest = divmod(number - 1, 26)
        letters = chr(65 + rest) + letters
    return letters


def excel_quote(text):
    """Quote a literal for inside an Excel string (double the quotes)."""
    return '"%s"' % text.replace('"', '""')


def vlookup_formula(key_cell, table_range, col_index):
    """Exact-match lookup that stays blank when the key is blank/missing."""
    return '=IFERROR(VLOOKUP(%s,%s,%d,FALSE),"")' % (key_cell, table_range, col_index)


def global_ref(cell):
    """Absolute reference to one INPUT globals value cell, e.g. INPUT!$B$5."""
    return "=INPUT!%s" % cell


def split_phrases_out(subtitle, phrases_in_order):
    """Split ``subtitle`` around each phrase, in order.

    Returns (ok, fragments) with ``subtitle == f0 + P1 + f1 + ... + Pn + fn``
    when every phrase is found after the previous one, else (False, []).
    """
    fragments = []
    pos = 0
    for phrase in phrases_in_order:
        if not phrase:
            return False, []
        found = subtitle.find(phrase, pos)
        if found < 0:
            return False, []
        fragments.append(subtitle[pos:found])
        pos = found + len(phrase)
    fragments.append(subtitle[pos:])
    return True, fragments


def _is_reconstructable(index, rows, members):
    """Core overlay check given the row's take-group member list."""
    if len(members) < 2:
        return False, []
    ordered = sorted(members, key=lambda i: (order_of(rows[i]), i))
    position = ordered.index(index)
    if not (rows[index].get(PHRASE_COL) or "").strip():
        return False, []
    subtitle = rows[index].get(SUBTITLE_COL, "")
    if not (rows[index].get(PHRASE_COL, "") in subtitle):
        return False, []
    earlier = [rows[i].get(PHRASE_COL, "") for i in ordered[: position + 1]]
    later = [rows[i].get(PHRASE_COL, "") for i in ordered[position + 1:]]
    if any((phrase or "") in subtitle for phrase in later if phrase):
        return False, []
    ok, _fragments = split_phrases_out(subtitle, [p for p in earlier if p])
    if not ok:
        return False, []
    return True, ordered[: position + 1]


def subtitle_is_reconstructable(row_index, rows, groups_by_step):
    """Check the overlay embeds exactly its take-group's phrases up to its order.

    The overlay shows takes 1..k as text and later takes as ``___________``
    placeholders, so the row's own phrase and every earlier take's phrase must
    appear while no later take's phrase may. Single-row groups (intros,
    branching questions) and rows with a blank phrase fall back to a stored
    value instead of a concatenation formula.

    ``groups_by_step`` maps any group key to member row indices; hot callers
    should precompute one ``index -> members`` map and call
    ``_is_reconstructable`` directly instead of rescanning per row.
    """
    for _key, members in groups_by_step.items():
        if row_index in members:
            return _is_reconstructable(row_index, rows, members)
    return False, []


def group_member_map(groups):
    """Map every row index to its group's member list (built once, O(rows))."""
    return {index: members for members in groups.values() for index in members}


def subtitle_concat_formula(subtitle, phrase_cells_in_order):
    """Build ``=frag & $H$2 & frag ...`` reproducing ``subtitle`` exactly."""
    phrases = [phrase for phrase, _ref in phrase_cells_in_order]
    ok, fragments = split_phrases_out(subtitle, phrases)
    if not ok:  # pragma: no cover - callers check reconstructability first
        raise ValueError("subtitle does not embed its phrases in order")
    parts = []
    for pos, (_phrase, ref) in enumerate(phrase_cells_in_order):
        if fragments[pos]:
            parts.append(excel_quote(fragments[pos]))
        parts.append(ref)
    if fragments[-1]:
        parts.append(excel_quote(fragments[-1]))
    if not parts:  # pragma: no cover - a subtitle is never blank here
        raise ValueError("subtitle has no content")
    return "=" + "&".join(parts)


def build_input_tables(headers, rows, kinds):
    """Collect the deduplicated INPUT tables. Stdlib-only; no openpyxl."""
    if not rows:
        raise ValueError("build_input_tables: no rows")
    present = set(headers)
    globals_rows = [(col, rows[0].get(col, "")) for col in headers if kinds[col] == "global"]
    lesson_cols = [col for col in headers if kinds[col] == "lesson"]
    step_cols = [col for col in headers if kinds[col] == "step"]
    per_row_cols = [col for col in headers if kinds[col] == "per_row"]
    phrase_cols = ["filename", "order", "video_file", "join", "lesson_id"]
    phrase_cols += [col for col in [PHRASE_COL, *PHRASE_LANG_COLS] if col in present]

    lessons_header = [LESSON_COL] + lesson_cols
    # Lesson-constant columns are identical on every row of the lesson, so the
    # first-seen row is representative (single pass, first-seen lesson order).
    first_of_lesson = {}
    for row in rows:
        first_of_lesson.setdefault(row.get(LESSON_COL, ""), row)
    lessons_rows = [[lesson] + [first.get(col, "") for col in lesson_cols]
                     for lesson, first in first_of_lesson.items()]

    groups = sibling_groups(rows)
    step_keys = list(groups)
    steps_header = ["step_key"] + step_cols
    steps_rows = []
    for key in step_keys:
        member = rows[groups[key][0]]
        steps_rows.append([key] + [member.get(col, "") for col in step_cols])

    take_groups = subtitle_groups(rows)
    member_of = group_member_map(take_groups)

    phrases_header = phrase_cols
    phrases_rows = [[row.get(col, "") for col in phrase_cols] for row in rows]

    contents_header = ["filename"] + per_row_cols
    contents_rows = [[row.get("filename", "")] + [row.get(col, "") for col in per_row_cols]
                      for row in rows] if per_row_cols else []

    subtitles_rows = []
    for index, row in enumerate(rows):
        ok, _ordered = _is_reconstructable(index, rows, member_of[index])
        if kinds.get(SUBTITLE_COL) == "subtitle" and not ok:
            subtitles_rows.append([row.get("filename", ""), row.get(SUBTITLE_COL, "")])
    subtitles_header = ["filename", SUBTITLE_COL]

    return {
        "globals": globals_rows,
        "lessons_header": lessons_header,
        "lessons_rows": lessons_rows,
        "steps_header": steps_header,
        "steps_rows": steps_rows,
        "step_keys": step_keys,
        "phrases_header": phrases_header,
        "phrases_rows": phrases_rows,
        "contents_header": contents_header,
        "contents_rows": contents_rows,
        "subtitles_header": subtitles_header,
        "subtitles_rows": subtitles_rows,
        "groups": groups,
        "take_groups": take_groups,
    }


def build_workbook_plan(headers, rows):
    """Plan every MAIN cell as ('value', text) or ('formula', excel).

    Returns a dict with the INPUT ``tables`` plus ``main`` (list of rows of
    (kind, payload) cells) and ``main_header``. ``expected`` parallels ``main``
    with the evaluated value each cell must show, so tests can prove the
    formulas reproduce the CSV exactly without an Excel engine.
    """
    kinds = classify_columns(headers, rows)
    if not rows:
        raise ValueError("build_workbook_plan: no rows")
    seen_keys = set()
    dupes = set()
    for row in rows:
        key = row.get(KEY_COL, "")
        if not key:
            continue  # blank keys carry no VLOOKUP identity; each stands alone
        if key in seen_keys:
            dupes.add(key)
        seen_keys.add(key)
    if dupes:
        raise ValueError("duplicate %s keys: %s" % (KEY_COL, ", ".join(sorted(dupes))))
    tables = build_input_tables(headers, rows, kinds)
    main_header = list(headers) + [HELPER_STEP_COL]

    # INPUT table addresses come from the single layout helper the writer uses.
    layout = layout_input_tables(tables)
    main_letters = {col: excel_col_letter(idx + 1) for idx, col in enumerate(main_header)}
    filename_cell = lambda excel_row: "$%s$%d" % (main_letters[KEY_COL], excel_row)
    lesson_cell = lambda excel_row: "$%s$%d" % (main_letters[LESSON_COL], excel_row)
    step_cell = lambda excel_row: "$%s$%d" % (main_letters[HELPER_STEP_COL], excel_row)
    phrase_cell = lambda col, excel_row: "$%s$%d" % (main_letters[col], excel_row)

    def col_index(header, col):
        return header.index(col) + 1

    main = []
    expected = []
    take_groups = subtitle_groups(rows)
    member_of = group_member_map(take_groups)
    for index, row in enumerate(rows):
        excel_row = index + 2
        plan_row = []
        expect_row = []
        ok, ordered = _is_reconstructable(index, rows, member_of[index])
        for col in main_header:
            if col == HELPER_STEP_COL:
                join_ref = phrase_cell(JOIN_COL, excel_row) if JOIN_COL in main_letters else '""'
                video_ref = phrase_cell(VIDEO_FILE_COL, excel_row) if VIDEO_FILE_COL in main_letters else '""'
                # Step key: the join value when non-blank, else video_file.
                # An exact blank test (not TRIM) matches step_key_for_row's
                # `!= ""` rule: TRIM would also collapse internal double
                # spaces, making the sheet's key differ from the CSV's.
                formula = "=IF(%s=\"\",%s,%s)" % (join_ref, video_ref, join_ref)
                plan_row.append(("formula", formula))
                expect_row.append(step_key_for_row(row))
            elif col in VALUE_COLS:
                plan_row.append(("value", row.get(col, "")))
                expect_row.append(row.get(col, ""))
            elif col in KEY_LOOKUP_COLS:
                rng = layout["phrases_range"]
                formula = vlookup_formula(filename_cell(excel_row), rng,
                                          col_index(tables["phrases_header"], col))
                plan_row.append(("formula", formula))
                expect_row.append(row.get(col, ""))
            elif kinds[col] == "phrase":
                rng = layout["phrases_range"]
                formula = vlookup_formula(filename_cell(excel_row), rng,
                                          col_index(tables["phrases_header"], col))
                plan_row.append(("formula", formula))
                expect_row.append(row.get(col, ""))
            elif kinds[col] == "subtitle":
                if ok:
                    refs = [(rows[i].get(PHRASE_COL, ""),
                             phrase_cell(PHRASE_COL, i + 2)) for i in ordered]
                    formula = subtitle_concat_formula(row.get(col, ""), refs)
                    plan_row.append(("formula", formula))
                    expect_row.append(row.get(col, ""))
                elif tables["subtitles_rows"]:
                    rng = layout["subtitles_range"]
                    formula = vlookup_formula(filename_cell(excel_row), rng, 2)
                    plan_row.append(("formula", formula))
                    expect_row.append(row.get(col, ""))
                else:  # pragma: no cover - defensive; tables exist when needed
                    plan_row.append(("value", row.get(col, "")))
                    expect_row.append(row.get(col, ""))
            elif kinds[col] == "global":
                addr = layout["global_cells"][col]
                plan_row.append(("formula", global_ref(addr)))
                expect_row.append(row.get(col, ""))
            elif kinds[col] == "blank":
                plan_row.append(("value", ""))
                expect_row.append("")
            elif kinds[col] == "lesson":
                rng = layout["lessons_range"]
                formula = vlookup_formula(lesson_cell(excel_row), rng,
                                          col_index(tables["lessons_header"], col))
                plan_row.append(("formula", formula))
                expect_row.append(row.get(col, ""))
            elif kinds[col] == "step":
                rng = layout["steps_range"]
                formula = vlookup_formula(step_cell(excel_row), rng,
                                          col_index(tables["steps_header"], col))
                plan_row.append(("formula", formula))
                expect_row.append(row.get(col, ""))
            else:  # per_row content keyed by filename
                rng = layout["contents_range"]
                formula = vlookup_formula(filename_cell(excel_row), rng,
                                          col_index(tables["contents_header"], col))
                plan_row.append(("formula", formula))
                expect_row.append(row.get(col, ""))
        main.append(plan_row)
        expected.append(expect_row)
    return {
        "kinds": kinds,
        "tables": tables,
        "layout": layout,
        "main_header": main_header,
        "main": main,
        "expected": expected,
    }


def input_sections(tables):
    """The INPUT sheet's ordered sections — the single source of truth.

    Both ``layout_input_tables`` (which computes the addresses MAIN's formulas
    cite) and ``write_workbook`` (which writes the cells) consume this list, so
    the planned ranges and the written rows can never drift apart.
    """
    sections = [
        {"name": "globals",
         "label": "globals — one value used file-wide (MAIN references the cell)",
         "header": ["key", "value"], "rows": list(tables["globals"])},
        {"name": "lessons",
         "label": "lessons — one row per lesson_id (MAIN VLOOKUPs by lesson_id)",
         "header": tables["lessons_header"], "rows": tables["lessons_rows"]},
        {"name": "steps",
         "label": "steps — one row per step (join else video_file; MAIN VLOOKUPs by _step)",
         "header": tables["steps_header"], "rows": tables["steps_rows"]},
        {"name": "phrases",
         "label": "takes — one row per filename; the phrase source of truth "
                  "(MAIN VLOOKUPs phrase* by filename; subtitle formulas point at MAIN phrase cells)",
         "header": tables["phrases_header"], "rows": tables["phrases_rows"]},
    ]
    if tables["contents_rows"]:
        sections.append({"name": "contents",
                         "label": "contents — per-take values that vary inside a step "
                                  "(MAIN VLOOKUPs by filename)",
                         "header": tables["contents_header"], "rows": tables["contents_rows"]})
    if tables["subtitles_rows"]:
        sections.append({"name": "subtitles",
                         "label": "overlays — full subtitle_text for single-take rows "
                                  "(intros/branching), which no concatenation can rebuild",
                         "header": tables["subtitles_header"], "rows": tables["subtitles_rows"]})
    return sections


def layout_input_tables(tables, note_row=1):
    """Assign every INPUT section its label/header/data rows, once.

    Row math is applied only here; ``write_workbook`` writes at the rows this
    returns. Layout: note in ``note_row``, a blank row, then each section as
    label, header, data, one blank gap.
    """
    layout = {"global_cells": {}, "sections": {}}
    row = note_row + 2  # first section label (note row + one gap row)
    for section in input_sections(tables):
        header_row = row + 1
        first_data = row + 2
        last_data = first_data + len(section["rows"]) - 1
        last_col = excel_col_letter(len(section["header"]))
        placed = dict(section, label_row=row, header_row=header_row,
                      first_data=first_data, last_data=last_data,
                      range="INPUT!$A$%d:$%s$%d" % (header_row, last_col, last_data))
        layout["sections"][section["name"]] = placed
        layout["%s_range" % section["name"]] = placed["range"]
        layout["%s_header_row" % section["name"]] = header_row
        layout["%s_first_data" % section["name"]] = first_data
        row = last_data + 2
    # Globals live key|value in columns A|B; MAIN cites the value cells.
    globals_section = layout["sections"]["globals"]
    for pos, (col, _value) in enumerate(tables["globals"]):
        layout["global_cells"][col] = "$B$%d" % (globals_section["first_data"] + pos)
    return layout


def write_workbook(plan, out_path):  # pragma: no cover - needs openpyxl
    """Materialize a plan from build_workbook_plan as an .xlsx file."""
    try:
        import openpyxl
        from openpyxl.formatting.rule import CellIsRule
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
        from openpyxl.worksheet.datavalidation import DataValidation
    except ImportError:
        raise SystemExit("ERROR: openpyxl is not installed. Run "
                         "'pip install openpyxl' and retry.")
    kinds = plan["kinds"]
    wb = openpyxl.Workbook()

    note = ("INPUT — the ONLY sheet to edit. Every unique text value lives here once; "
            "MAIN is formulas. To add takes, append rows to the takes table, then append "
            "matching MAIN rows reusing the neighboring formulas. Never edit the exported "
            "CSV: it carries values only, which is how the formulas were lost.")

    ws_in = wb.active
    ws_in.title = INPUT_SHEET
    ws_in.sheet_properties.tabColor = "F2C230"
    ws_in["A1"] = note
    ws_in["A1"].alignment = Alignment(wrap_text=True, vertical="top")
    ws_in.merge_cells("A1:H1")
    ws_in.row_dimensions[1].height = 45

    header_fill = PatternFill("solid", fgColor="1F4E5F")
    header_font = Font(bold=True, color="FFFFFF")
    label_fill = PatternFill("solid", fgColor="D9E6EC")
    label_font = Font(bold=True, color="1F4E5F")
    helper_fill = PatternFill("solid", fgColor="F2F2F2")

    def write_section(section):
        start_row = section["label_row"]
        ws_in["A%d" % start_row] = section["label"]
        ws_in["A%d" % start_row].fill = label_fill
        ws_in["A%d" % start_row].font = label_font
        header_row = section["header_row"]
        for cix, col in enumerate(section["header"], start=1):
            cell = ws_in.cell(row=header_row, column=cix, value=col)
            cell.fill = header_fill
            cell.font = header_font
        for rix, values in enumerate(section["rows"], start=section["first_data"]):
            for cix, value in enumerate(values, start=1):
                ws_in.cell(row=rix, column=cix, value=value)
        if section["rows"]:
            ws_in.auto_filter.ref = "A%d:%s%d" % (
                header_row, get_column_letter(len(section["header"])), section["last_data"])

    # Write every section at exactly the rows layout_input_tables computed, so
    # the addresses MAIN's formulas cite always match the written cells.
    for section in plan["layout"]["sections"].values():
        write_section(section)

    for cix, width in enumerate((28, 80, 22, 22, 16, 60, 30, 30, 30), start=1):
        ws_in.column_dimensions[get_column_letter(cix)].width = width
    ws_in.freeze_panes = "A2"
    for ws_row in ws_in.iter_rows():
        for cell in ws_row:
            cell.alignment = Alignment(wrap_text=True, vertical="top")

    ws = wb.create_sheet(MAIN_SHEET, 0)
    ws.sheet_properties.tabColor = "2E7D32"
    for cix, col in enumerate(plan["main_header"], start=1):
        cell = ws.cell(row=1, column=cix, value=col)
        cell.fill = header_fill
        cell.font = header_font
        if col == HELPER_STEP_COL:
            cell.fill = helper_fill
            cell.font = Font(bold=True, italic=True, color="555555")
    for rix, plan_row in enumerate(plan["main"], start=2):
        for cix, (kind, payload) in enumerate(plan_row, start=1):
            ws.cell(row=rix, column=cix, value=payload)
    last_col = get_column_letter(len(plan["main_header"]))
    ws.auto_filter.ref = "A1:%s%d" % (last_col, len(plan["main"]) + 1)
    ws.freeze_panes = "A2"
    widths = {"filename": 26, "order": 8, "phrase": 52, "subtitle_text": 60,
              "video_file": 26, "join": 26, "srt": 40, "success_srt": 40,
              HELPER_STEP_COL: 26}
    for cix, col in enumerate(plan["main_header"], start=1):
        if col in widths:
            ws.column_dimensions[get_column_letter(cix)].width = widths[col]
        elif kinds.get(col) in ("global", "lesson", "step"):
            ws.column_dimensions[get_column_letter(cix)].width = 30
        else:
            ws.column_dimensions[get_column_letter(cix)].width = 22
    if ORDER_COL in plan["main_header"]:
        order_col = get_column_letter(plan["main_header"].index(ORDER_COL) + 1)
        validation = DataValidation(type="whole", operator="between", formula1="1", formula2="4")
        validation.error = "Order must be 1-4 within its step."
        ws.add_data_validation(validation)
        validation.add("%s2:%s%d" % (order_col, order_col, len(plan["main"]) + 1))
    ws.conditional_formatting.add(
        "A2:%s%d" % (last_col, len(plan["main"]) + 1),
        CellIsRule(operator="equal", formula=['""'], font=Font(color="AAAAAA")),
    )
    try:
        from openpyxl.workbook.defined_name import DefinedName
        for name, rng in (("Globals", plan["layout"].get("globals_range", "")),
                          ("Lessons", plan["layout"].get("lessons_range", "")),
                          ("Steps", plan["layout"].get("steps_range", "")),
                          ("Takes", plan["layout"].get("phrases_range", ""))):
            if rng:
                wb.defined_names[name] = DefinedName(name, attr_text=rng)
    except Exception as error:  # names are a convenience; addresses carry the formulas
        print("WARN: could not add defined names (%s)" % error, file=sys.stderr)
    wb.save(out_path)
    return out_path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--in", dest="src", required=True, help="overlay-master CSV path")
    parser.add_argument("--out", dest="out", required=True, help="output .xlsx path")
    args = parser.parse_args(argv)
    headers, rows = read_csv_rows(args.src)
    if not headers or not rows:
        raise SystemExit("ERROR: no rows in %s" % args.src)
    plan = build_workbook_plan(headers, rows)
    kinds = plan["kinds"]
    counts = defaultdict(int)
    for kind in kinds.values():
        counts[kind] += 1
    formulas = sum(1 for r in plan["main"] for (kind, payload) in r if payload.startswith("="))
    print("rows=%d cols=%d kinds=%s" % (len(rows), len(headers), dict(counts)))
    print("MAIN formula cells: %d of %d" % (formulas, len(rows) * len(plan["main_header"])))
    print("INPUT: %d globals, %d lessons, %d steps, %d takes, %d stored overlays"
          % (len(plan["tables"]["globals"]), len(plan["tables"]["lessons_rows"]),
             len(plan["tables"]["steps_rows"]), len(plan["tables"]["phrases_rows"]),
             len(plan["tables"]["subtitles_rows"])))
    write_workbook(plan, args.out)
    print("wrote %s" % args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
