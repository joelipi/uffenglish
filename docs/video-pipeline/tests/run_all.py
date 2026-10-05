#!/usr/bin/env python3
"""Discover and run the pipeline's stdlib unittest suite.

Used by scripts/run-python-tests.mjs (npm run test:python) and CI. Discovers
``test_*.py`` in this directory, including the source-guard suites for
``video_pipeline.py`` and ``modal_app.py``.
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(HERE)
# Make `pipeline_lib` importable when discovery imports each test module.
sys.path.insert(0, PIPELINE_DIR)
sys.path.insert(0, HERE)


def main() -> int:
    loader = unittest.TestLoader()
    suite = loader.discover(HERE, pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
