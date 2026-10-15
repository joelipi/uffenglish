"""Source guards for docs/video-pipeline/video_pipeline.py (story 040, Task 5).

The pure decisions live in pipeline_lib and are unit-tested there; these guards
prove the wiring is actually present in the (import-heavy) pipeline script that
CI cannot execute without moviepy/modal/torch. Guards are written to be able to
fail: each slices the specific region and asserts a token that exists once.
"""

import ast
import os
import re
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PIPELINE = REPO_ROOT / "docs" / "video-pipeline" / "video_pipeline.py"
MODAL_APP = REPO_ROOT / "docs" / "video-pipeline" / "modal_app.py"
TRIGGER = REPO_ROOT / "docs" / "video-pipeline" / "trigger_app.py"


def read() -> str:
    return PIPELINE.read_text(encoding="utf-8")


def slice_between(text: str, start: str, end: str) -> str:
    i = text.index(start)
    j = text.index(end, i + len(start))
    return text[i:j]


def assert_title_band_pins(overlay: str) -> None:
    """Story 068 title-pill pins, asserted over raw overlay source.

    Exists as a module function so the mutation proof can check a mutated copy
    instead of re-reading the file (which would always pass).
    """
    assert "BODY_TOP = COMPACT_BLUR_RATIO" in overlay, "title band must derive from the blur ratio"
    assert "TITLE_TOP = 0.07" in overlay, "title must keep the chrome margin"
    assert "body_min = max(10, int(video_height * 0.018))" in overlay, "body floor pin"
    assert "title_base = max(12, int(body_min * 1.5))" in overlay, "title must be 1.5x the body floor"
    assert "title_base = max(10, int(video_height * 0.05))" not in overlay, "old oversized base"


def extract_overlay_constants():
    """Read the overlay's numeric constants out of ``create_overlay_html``.

    The module cannot be imported in CI (it needs moviepy/cv2/modal), so the
    arithmetic property tests below re-derive the layout from the source's own
    literal assignments instead of asserting on their spelling. Raises
    AssertionError with the missing name so a rename fails loudly.
    """
    overlay = slice_between(read(), "def create_overlay_html", "def add_background_sound")
    module_text = read()
    values = {}
    # COMPACT_BLUR_RATIO lives at module level; APP_CAPTION_TOP is assigned
    # inside create_overlay_html (indented), so search both scopes.
    for name in ("COMPACT_BLUR_RATIO", "APP_CAPTION_TOP"):
        match = re.search(rf"^{name}\s*=\s*([0-9.]+)", module_text, re.M) \
            or re.search(rf"^\s+{name}\s*=\s*([0-9.]+)", module_text, re.M)
        if not match:
            raise AssertionError(f"{name} not found in video_pipeline.py")
        values[name] = float(match.group(1))
    for name, pattern in (
        ("TITLE_TOP", r"TITLE_TOP\s*=\s*([0-9.]+)"),
        ("BODY_TOP", r"BODY_TOP\s*=\s*([0-9.]+|COMPACT_BLUR_RATIO)"),
        ("TITLE_PADDING_COEF", r"TITLE_PADDING_Y\s*=\s*max\(4, int\(video_height \* ([0-9.]+)\)\)"),
        ("BODY_MIN_COEF", r"body_min\s*=\s*max\(10, int\(video_height \* ([0-9.]+)\)\)"),
        ("TITLE_RATIO", r"title_base\s*=\s*max\(12, int\(body_min \* ([0-9.]+)\)\)"),
    ):
        match = re.search(pattern, overlay)
        if not match:
            raise AssertionError(f"{name} literal not found in create_overlay_html")
        values[name] = values.get("COMPACT_BLUR_RATIO") if match.group(1) == "COMPACT_BLUR_RATIO" else (
            float(match.group(1)) if re.match(r"^[0-9.]+$", match.group(1)) else match.group(1)
        )
    return values


# The CSS line-height the .title rule uses; the clamp divides the band budget
# by it so one line box always fits.
TITLE_LINE_HEIGHT = 1.6


def title_band_parts(height: int):
    """Every number the title-pill math derives, at one frame height.

    Width plays no part (the band is a fraction of the height), so it is not a
    parameter. Mirrors ``create_overlay_html`` exactly — including the float
    truncation of ``BODY_TOP - TITLE_TOP`` — so a property test needs no import
    of the (cv2-dependent) module.
    """
    c = extract_overlay_constants()
    padding = max(4, int(height * c["TITLE_PADDING_COEF"]))
    body_min = max(10, int(height * c["BODY_MIN_COEF"]))
    desired_base = max(12, int(body_min * c["TITLE_RATIO"]))
    cap = int((c["BODY_TOP"] - c["TITLE_TOP"]) * height - 2 * padding - 2)
    return {
        "padding": padding,
        "body_min": body_min,
        "desired_base": desired_base,
        "cap": cap,
        "base": min(desired_base, max(12, int(cap / TITLE_LINE_HEIGHT))),
        "block_height": max(12, cap),
        "bottom": c["TITLE_TOP"] * height + max(12, cap) + 2 * padding,
        "blur_line": c["BODY_TOP"] * height,
    }


def pill_bottom_ratio(height: int):
    """(pill_bottom_px, blur_line_px, title_base, body_min) for one frame.

    The pill is ``top + max-height + 2 * padding`` tall and must end at or
    below the blur line.
    """
    p = title_band_parts(height)
    return p["bottom"], p["blur_line"], p["base"], p["body_min"]


def title_box_budget(height: int):
    """(line_box_px, cap_px) for the pill at one frame height."""
    parts = title_band_parts(height)
    return parts["desired_base"] * TITLE_LINE_HEIGHT, parts["block_height"]


def module_defined_names(tree: ast.AST) -> set:
    """Every top-level name the module binds: imports, defs, assignments."""
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add((alias.asname or alias.name).split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                names.add(alias.asname or alias.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            names.add(node.id)
        elif isinstance(node, ast.arg):
            names.add(node.arg)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)
    return names


def module_attribute_roots(tree: ast.AST) -> set:
    """Names used as `X.attr` (e.g. `time` in `time.time()`)."""
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            roots.add(node.value.id)
    return roots


class UndefinedImportGuardTest(unittest.TestCase):
    def test_every_attribute_root_is_bound(self):
        # `time.time()` with no `import time` is a NameError the string guards
        # cannot see (CI cannot import this module). Assert every `X.attr` root
        # is a name the module binds.
        tree = ast.parse(read())
        defined = module_defined_names(tree)
        builtins = set(dir(__builtins__)) if not isinstance(__builtins__, dict) else set(__builtins__)
        undefined = sorted(
            root for root in module_attribute_roots(tree)
            if root not in defined and root not in builtins
        )
        self.assertEqual(undefined, [])

    def test_guard_can_fail(self):
        bad = ast.parse("import os\nos.path.join('a', time.time())\n")
        defined = module_defined_names(bad)
        undefined = [r for r in module_attribute_roots(bad) if r not in defined]
        self.assertIn("time", undefined)


class WorkdirGuardTest(unittest.TestCase):
    def test_imports_pure_decisions_from_pipeline_lib(self):
        text = read()
        self.assertIn("from pipeline_lib import", text)
        for name in ("resolve_work_dir", "resolve_web_profile", "chrome_flags",
                     "missing_required_fonts", "select_rows"):
            self.assertIn(name, text, name)

    def test_derives_every_directory_constant_from_work_dir(self):
        text = read()
        block = slice_between(text, "WORK_DIR = resolve_work_dir", "VIDEO_EXTENSION")
        for name in ("VIDEO_DIRECTORY", "NO_SILENCE_DIRECTORY", "AUDIO_DIRECTORY",
                     "FONT_DIRECTORY", "BACKGROUNDS_DIRECTORY", "RAWVIDEOS_DIRECTORY",
                     "OVERLAYS_DIRECTORY", "OVERLAYS_TEMP_DIRECTORY", "CSV_FILE"):
            self.assertIn(name, block, name)
            self.assertIn("WORK_DIR", block.split(name, 1)[1].split("\n", 1)[0], name)

    def test_output_dirs_derive_from_work_dir(self):
        text = read()
        block = slice_between(text, "OUTPUT_ROOT =", "def ")
        for name in ("SOCIAL_DIR", "WEB_DIR"):
            self.assertIn(name, block, name)
            self.assertIn("OUTPUT_ROOT", block.split(name, 1)[1].split("\n", 1)[0], name)
        self.assertIn("WORK_DIR", block.split("OUTPUT_ROOT =", 1)[1].split("\n", 1)[0])

    def test_background_removal_always_returns_seconds(self):
        # The early-exit and normal paths must both return a number so the
        # orchestrator's estimate_cost never receives None.
        body = slice_between(read(), "def run_background_removal(", "def group_videos_by_prefix")
        self.assertIn("return 0.0", body)
        self.assertIn("return gpu_seconds", body)

    def test_no_getcwd(self):
        self.assertNotIn("os.getcwd()", read())

    def test_no_windows_only_launch_tokens(self):
        text = read()
        self.assertNotIn("os.startfile", text)
        self.assertNotIn("shell=True", text)
        self.assertNotIn(".exe", text)


class FontAndWebProfileGuardTest(unittest.TestCase):
    def test_font_urls_use_absolute_directory_and_missing_check(self):
        text = read()
        self.assertIn("missing_required_fonts(FONT_DIRECTORY)", text)
        # create_overlay_html builds file:// URLs from the (now absolute) FONT_DIRECTORY.
        overlay = slice_between(text, "def create_overlay_html", "def add_background_sound")
        self.assertIn('f"file:///{os.path.abspath(os.path.join(FONT_DIRECTORY', overlay)

    def test_missing_fonts_abort_setup(self):
        text = read()
        body = slice_between(text, "def setup_environment(", "def ")
        self.assertIn("if missing_fonts:", body)
        # A missing font must fail the run, not just warn.
        self.assertIn("return False", body)

    def test_web_profile_and_chrome_flags_wired(self):
        text = read()
        self.assertIn("resolve_web_profile(os.environ)", text)
        self.assertIn("chrome_flags(os.environ)", text)
        # The inline --default-background-color flag must be gone (moved to chrome_flags).
        self.assertNotIn("--default-background-color=00000000", text)


class OnlyScopeGuardTest(unittest.TestCase):
    def test_stage_functions_accept_only(self):
        text = read()
        self.assertIn("def run_silence_removal(args, background_mapping, mirror_mapping, only=None):", text)
        self.assertIn("def run_background_removal(background_mapping, mirror_mapping, only=None):", text)
        self.assertIn("def process_video_batch(csv_file, max_workers=1, only=None):", text)

    def test_process_video_batch_filters_with_select_rows(self):
        text = read()
        body = slice_between(text, "def process_video_batch", "def processed_to_original")
        self.assertIn("select_rows(", body)

    def test_parse_args_registers_only_and_main_wires_it(self):
        text = read()
        self.assertIn("'--only'", text)
        self.assertIn("only = [s.strip() for s in args.only.split(',')", text)
        self.assertIn("only=only", text)


class ModalGuardTest(unittest.TestCase):
    """Story 053: no GPU function on the lesson app; background removal calls
    the separately deployed `video-background-removal` function by name. This is
    the single home for the video_pipeline/deploy-graph source guards; the
    behavioral tests live in test_background_removal_wiring.py."""

    @staticmethod
    def _decorators(text):
        # `@app.function(...)` up to its closing paren (one level of nesting).
        return re.findall(r"@app\.function\((?:[^()]|\([^()]*\))*\)", text)

    def _assert_resolver(self, text):
        resolver = slice_between(
            text, "def background_removal_remote(", "def process_video_background(")
        self.assertIn(
            'modal.Function.from_name("video-background-removal", "process_video_background_modal")',
            resolver,
        )
        # A lookup failure must name the app so the operator can act on it.
        self.assertIn("video-background-removal", resolver.split("except", 1)[1])

    def _assert_call(self, text):
        body = slice_between(text, "def process_video_background(", "def get_original_filename")
        self.assertIn("background_removal_remote().remote(", body)
        self.assertIn("fps=0, fast_mode=True, max_workers=10", body)
        # A deployed function needs no app run context, locally or otherwise.
        self.assertNotIn("with app.run():", body)
        self.assertNotIn("modal.is_local()", body)

    def test_app_name_lives_in_the_trigger_module_not_the_pipeline(self):
        text = read()
        # Story 054: video_pipeline no longer creates the `uff-lesson-video` app
        # handle (only modal_app.py imported it); the app is created in the
        # lightweight trigger module that Modal imports in the fastapi-only
        # trigger container. Keep the name so MODAL_RENDER_URL is unchanged.
        self.assertNotIn("app = modal.App(", text)
        # The T4 BiRefNet function moved to background_removal_app.py.
        self.assertNotIn("def process_video_background_modal", text)
        trigger = TRIGGER.read_text(encoding="utf-8")
        self.assertIn('app = modal.App("uff-lesson-video")', trigger)

    def _assert_no_gpu(self, text, label):
        self.assertNotIn("gpu=", text, label)
        for decorator in self._decorators(text):
            self.assertNotIn("gpu", decorator, label)

    def test_deploy_graph_registers_no_gpu_function(self):
        # Task 3: every module in the deploy graph that registers `@app.function`s
        # -- modal_app.py and trigger_app.py -- must register no GPU function.
        seen = 0
        for path in (PIPELINE, MODAL_APP, TRIGGER):
            text = path.read_text(encoding="utf-8")
            self._assert_no_gpu(text, str(path))
            seen += len(self._decorators(text))
        # The scan is not vacuous: the graph does register CPU functions.
        self.assertGreater(seen, 0)

    def test_resolves_the_deployed_function_by_name(self):
        self._assert_resolver(read())

    def test_background_removal_calls_deployed_function_without_app_run(self):
        self._assert_call(read())

    def test_guards_can_fail(self):
        good = read()
        resolver_literal = (
            'modal.Function.from_name("video-background-removal", "process_video_background_modal")')
        with self.assertRaises(AssertionError):
            self._assert_resolver("SENTINEL".join(good.split(resolver_literal)))
        with self.assertRaises(AssertionError):
            self._assert_call(good.replace(
                "output_bytes = background_removal_remote().remote(",
                "with app.run():\n            output_bytes = background_removal_remote().remote(",
            ))
        # A GPU decorator in the deploy graph must fail the no-GPU scan.
        mutated_app = MODAL_APP.read_text(encoding="utf-8").replace(
            "@app.function(image=cpu_image",
            '@app.function(image=cpu_image, gpu="T4"',
        )
        self.assertNotEqual(mutated_app, MODAL_APP.read_text(encoding="utf-8"))
        with self.assertRaises(AssertionError):
            self._assert_no_gpu(mutated_app, "mutated modal_app.py")


class SyntaxGuardTest(unittest.TestCase):
    def test_pipeline_parses(self):
        ast.parse(read())


class TitleBandParityGuardTest(unittest.TestCase):
    """Story 068 Task 2 (Python side): the pipeline's title band and the app's
    compact blur are the SAME number, read from both sources.

    The JS mirror test (`src/modules/video/video-header-logic.test.js`) already
    compares both files; this guard pins the other direction so a Python-only
    edit cannot drift unnoticed. Raw text on both sides (no comment stripping:
    the files carry CSS/JS with `//`)."""

    JS = Path(REPO_ROOT) / "src" / "modules" / "video" / "video-header-logic.js"

    @staticmethod
    def _py_ratio(py_text: str):
        match = re.search(r"^COMPACT_BLUR_RATIO\s*=\s*([0-9.]+)", py_text, re.M)
        if not match:
            raise AssertionError("COMPACT_BLUR_RATIO not found in video_pipeline.py")
        return match.group(1)

    @staticmethod
    def _js_ratio(js_text: str):
        match = re.search(r"VIDEO_HEADER_COMPACT_RATIO\s*=\s*([0-9.]+)", js_text)
        if not match:
            raise AssertionError("VIDEO_HEADER_COMPACT_RATIO not found in video-header-logic.js")
        return match.group(1)

    def _assert_parity(self, js_text: str, py_text: str) -> None:
        self.assertEqual(self._js_ratio(js_text), self._py_ratio(py_text),
                         "pipeline COMPACT_BLUR_RATIO != app VIDEO_HEADER_COMPACT_RATIO")

    def test_title_band_matches_the_app_blur(self):
        self._assert_parity(self.JS.read_text(encoding="utf-8"), read())

    def test_guard_fails_when_the_js_ratio_drifts(self):
        js = self.JS.read_text(encoding="utf-8")
        mutated = js.replace("VIDEO_HEADER_COMPACT_RATIO = 0.12",
                             "VIDEO_HEADER_COMPACT_RATIO = 0.15")
        self.assertNotEqual(mutated, js)
        with self.assertRaises(AssertionError):
            self._assert_parity(mutated, read())

    def test_guard_fails_when_the_py_ratio_drifts(self):
        # In-memory like the sibling JS case — never a write-then-restore on
        # the checked-in source (a crash between them leaves the file mutated).
        py = read().replace("COMPACT_BLUR_RATIO = 0.12", "COMPACT_BLUR_RATIO = 0.15")
        self.assertNotEqual(py, read())
        with self.assertRaises(AssertionError):
            self._assert_parity(self.JS.read_text(encoding="utf-8"), py)


class OverlayBandGuardTest(unittest.TestCase):
    """create_overlay_html keeps every burned block above the app's captions.

    The app draws its own *timed* SRT captions near the bottom on a response
    step, so no burned-in block may cross APP_CAPTION_TOP (80% from the top).
    """

    def test_bands_derive_from_one_caption_floor(self):
        overlay = slice_between(read(), "def create_overlay_html", "def add_background_sound")
        self.assertIn("APP_CAPTION_TOP = 0.80", overlay)
        # The blocks below the title derive their bounds from the one floor.
        self.assertIn("FOOTER_TOP = APP_CAPTION_TOP -", overlay)
        self.assertIn("BODY_BOTTOM = FOOTER_TOP -", overlay)

    def test_every_block_below_the_title_is_bounded(self):
        overlay = slice_between(read(), "def create_overlay_html", "def add_background_sound")
        for selector in (".footer {{", "mark {{", "aside {{"):
            block = slice_between(overlay, selector, "}}")
            self.assertIn("max-height", block, selector)
            self.assertIn("overflow: hidden", block, selector)
        # The footer's cap is exactly the gap up to the caption floor.
        footer = slice_between(overlay, ".footer {{", "}}")
        self.assertIn("(APP_CAPTION_TOP - FOOTER_TOP) * video_height", footer)


class OverlayTitleBandGuardTest(unittest.TestCase):
    """The title pill fits inside the band the app blurs over a normal step.

    The app draws only a compact blur (`VIDEO_HEADER_COMPACT_RATIO` in
    src/modules/video/video-header-logic.js) above an ordinary video, so a
    burned title poking past that line renders unblurred under the progress /
    mission overlay. Story 068 restyles the pill to 1.5x the body legibility
    floor and derives the whole band from the blur ratio.
    """

    def test_band_bottom_is_the_compact_blur_ratio(self):
        overlay = slice_between(read(), "def create_overlay_html", "def add_background_sound")
        # One variable ties the pipeline's band to the app's blur layer.
        assert "BODY_TOP = COMPACT_BLUR_RATIO" in overlay
        assert "COMPACT_BLUR_RATIO = 0.12" in read()

    def test_title_top_keeps_the_chrome_margin(self):
        assert "TITLE_TOP = 0.07" in slice_between(
            read(), "def create_overlay_html", "def add_background_sound")

    def test_title_base_is_one_and_a_half_times_the_body_floor(self):
        overlay = slice_between(read(), "def create_overlay_html", "def add_background_sound")
        # body_min is defined by the overlay (1.8% of height); the pill's base
        # size derives from it instead of a raw frame fraction.
        assert "body_min = max(10, int(video_height * 0.018))" in overlay
        assert "title_base = max(12, int(body_min * 1.5))" in overlay
        assert "title_base = max(10, int(video_height * 0.05))" not in overlay

    def test_title_height_budget_accounts_for_the_pill_padding(self):
        # The cap subtracts both padding margins so the rendered block (text +
        # 2 * padding) cannot cross the band bottom.
        overlay = slice_between(read(), "def create_overlay_html", "def add_background_sound")
        self.assertIn("_title_height_cap = int((BODY_TOP - TITLE_TOP) * video_height",
                      overlay)
        self.assertIn("- 2 * TITLE_PADDING_Y - 2)", overlay)
        # The base is capped to the line box that box can hold.
        self.assertIn("title_base = min(title_base, max(12, int(_title_height_cap / 1.6)))",
                      overlay)

    # Arithmetic property, not string pins: the pill (text + 2*padding) must
    # end at or below the compact-blur line on real frame sizes.
    def test_pill_bottom_sits_inside_the_blur_line(self):
        for height in (1280, 1920, 693, 2844):
            bottom, blur, _, _ = pill_bottom_ratio(height)
            self.assertLessEqual(bottom, blur,
                                 f"height {height}: pill bottom {bottom} > blur {blur}")

    def test_title_base_is_1_5x_body_floor_unless_the_cap_binds(self):
        for height in (1280, 1920):
            parts = title_band_parts(height)
            expected = min(parts["desired_base"],
                           max(12, int(parts["cap"] / TITLE_LINE_HEIGHT)))
            self.assertEqual(parts["base"], expected,
                             f"height {height}: {parts['base']} != {expected}")

    def test_clamp_is_necessary_at_720(self):
        # At 720x1280 the authored 1.5x base does NOT fit the blur band on its
        # own, so the clamp is load-bearing (this is why it exists at all).
        line_box, cap = title_box_budget(1280)
        self.assertGreater(line_box, cap + 1,
                           "if 1.5x base now fits, the clamp may be removable")

    def test_base_cap_pin_fails_without_the_clamp(self):
        source = read()
        clamp = "    title_base = min(title_base, max(12, int(_title_height_cap / 1.6)))\n"
        self.assertIn(clamp, source)
        with self.assertRaises(AssertionError):
            self._assert_clamp(source.replace(clamp, ""))

    def _assert_clamp(self, overlay_text):
        overlay = slice_between(overlay_text, "def create_overlay_html",
                                "def add_background_sound")
        assert "title_base = min(title_base, max(12, int(_title_height_cap / 1.6)))" \
            in overlay

    def test_guard_can_fail_on_each_pin(self):
        good = slice_between(read(), "def create_overlay_html", "def add_background_sound")
        mutations = [
            good.replace("BODY_TOP = COMPACT_BLUR_RATIO", "BODY_TOP = 0.17"),
            good.replace("TITLE_TOP = 0.07", "TITLE_TOP = 0.02"),
            good.replace("title_base = max(12, int(body_min * 1.5))",
                         "title_base = max(12, int(video_height * 0.05))"),
        ]
        for mutated in mutations:
            self.assertNotEqual(mutated, good)
            with self.assertRaises(AssertionError):
                assert_title_band_pins(mutated)

    def test_pins_hold_for_the_real_source(self):
        assert_title_band_pins(
            slice_between(read(), "def create_overlay_html", "def add_background_sound"))


class OverlayTitleAndAsideGuardTest(unittest.TestCase):
    """The title is a wrapping white pill and the aside is capped at half width.

    A regression here shipped the title as a full-bleed white slab (no vertical
    padding, corners clipped) and a 70%-wide aside. These guards pin the
    restored styling.
    """

    def test_title_is_a_wrapping_white_pill(self):
        overlay = slice_between(read(), "def create_overlay_html", "def add_background_sound")
        title = slice_between(overlay, ".title {{", "}}")
        # Wrapping pill, not a single nowrap line stretched across the width.
        self.assertIn("line-height: 1.6", title)
        self.assertNotIn("white-space: nowrap", title)
        span = slice_between(overlay, ".title span {{", "}}")
        self.assertIn("background: white", span)
        self.assertIn("padding: {TITLE_PADDING_Y}px 40px", span)
        self.assertIn("border-radius: 36px", span)

    def test_aside_is_capped_at_half_the_width(self):
        overlay = slice_between(read(), "def create_overlay_html", "def add_background_sound")
        aside = slice_between(overlay, "aside {{", "}}")
        self.assertIn("max-width: {video_width * 0.50}px", aside)
        self.assertNotIn("width: {video_width * 0.70}px", aside)


if __name__ == "__main__":
    unittest.main()
