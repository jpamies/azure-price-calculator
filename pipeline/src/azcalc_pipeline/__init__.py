"""azcalc-pipeline: daily Azure Retail Prices snapshot -> static JSON shards for the calculator SPA.

The output format is specified in docs/data-contract.md (repository root).
"""

from __future__ import annotations

import os
from pathlib import Path

__version__ = "0.1.0"


class PipelineError(Exception):
    """A failure that must stop the build before anything is published."""


def pipeline_dir() -> Path:
    """Return the `pipeline/` directory (holds pyproject.toml, data/ and tests/fixtures/).

    Resolved from the package location first (source tree / editable install), so it does not
    depend on the current working directory. `AZCALC_PIPELINE_DIR` overrides the lookup.
    """
    candidates: list[Path] = []
    env = os.environ.get("AZCALC_PIPELINE_DIR")
    if env:
        candidates.append(Path(env))
    candidates.append(Path(__file__).resolve().parents[2])
    cwd = Path.cwd()
    candidates.extend([cwd / "pipeline", cwd])
    for candidate in candidates:
        if (candidate / "pyproject.toml").is_file() and (candidate / "data").is_dir():
            return candidate
    raise PipelineError(
        "cannot locate the pipeline directory (expected pipeline/pyproject.toml and pipeline/data/); "
        "run from the repository or set AZCALC_PIPELINE_DIR"
    )


def data_dir() -> Path:
    """`pipeline/data/`: region-geo.json and vm-skus.base.json."""
    return pipeline_dir() / "data"


def fixtures_dir() -> Path:
    """`pipeline/tests/fixtures/`: the synthetic sample CSVs."""
    return pipeline_dir() / "tests" / "fixtures"
