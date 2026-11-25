"""manifest.json and the atomic publish step (docs/data-contract.md)."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import tempfile
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

SCHEMA_VERSION = 1
MANIFEST_NAME = "manifest.json"
STAGING_PREFIX = ".azcalc-tmp-"
DATE_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_encode = json.JSONEncoder(ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def paths_for(prices_date: str) -> dict[str, str]:
    return {
        "root": prices_date,
        "services": f"{prices_date}/index/services.json",
        "regions": f"{prices_date}/index/regions.json",
        "vmSkus": f"{prices_date}/index/vm-skus.json",
        "shards": f"{prices_date}/index/shards.json",
        "fx": f"{prices_date}/fx.json",
        "prices": f"{prices_date}/prices",
        "report": f"{prices_date}/report.json",
    }


def build_manifest(
    *,
    prices_date: str,
    generated_at: str,
    source: dict,
    has_savings_plan: bool,
    rows_published: int,
    shard_count: int,
    files: int,
    total_bytes: int,
) -> dict:
    """The small, no-store entry point. The per-shard map lives in the immutable paths.shards file."""
    return {
        "schemaVersion": SCHEMA_VERSION,
        "pricesDate": prices_date,
        "generatedAt": generated_at,
        "currencyBase": "USD",
        "hasSavingsPlan": has_savings_plan,
        "source": source,
        "paths": paths_for(prices_date),
        "stats": {"rowsPublished": rows_published, "shardCount": shard_count, "files": files, "bytes": total_bytes},
    }


def _retry_io(action: Callable[[], object], what: str, attempts: int = 4, delay: float = 0.5) -> None:
    """Retry an operation that some network filesystems fail transiently (EIO on rename/rmdir)."""
    for attempt in range(1, attempts + 1):
        try:
            action()
            return
        except OSError as exc:
            if attempt == attempts:
                raise
            log.debug("%s failed (%s); retry %d/%d", what, exc, attempt, attempts - 1)
            time.sleep(delay * attempt)


def remove_tree(path: Path) -> None:
    """shutil.rmtree with retries; a missing path is fine."""
    _retry_io(lambda: shutil.rmtree(path) if path.exists() else None, f"remove {path}")


def discard_staging(staging_dir: Path) -> None:
    """Best-effort cleanup that never raises (it runs in `finally`); leftovers are removed next run."""
    try:
        remove_tree(staging_dir)
    except OSError as exc:
        log.warning("could not remove staging directory %s (%s); it is removed on the next run", staging_dir, exc)


def move_tree(source: Path, target: Path) -> None:
    """Rename source -> target (same filesystem); fall back to copying if renaming keeps failing."""
    try:
        _retry_io(lambda: os.replace(source, target), f"rename {source} -> {target}", attempts=3)
    except OSError as exc:
        log.warning("renaming %s failed (%s); copying instead", source, exc)
        remove_tree(target)
        shutil.copytree(source, target)


def make_staging_dir(out_dir: Path) -> Path:
    """A fresh staging directory for the new <DATE>/ tree, created directly inside --out.

    Being a sibling of the final <DATE>/ directory, publishing is a same-directory rename: atomic on
    local filesystems and free of the filesystem-wide lock that cross-directory renames take.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob(f"{STAGING_PREFIX}*"):
        if stale.is_dir():
            log.info("removing stale staging directory %s", stale)
            discard_staging(stale)
    staging = Path(tempfile.mkdtemp(prefix=STAGING_PREFIX, dir=out_dir))
    staging.chmod(0o755)  # mkdtemp uses 0700; the directory is published as-is (Pages needs o+r)
    return staging


def publish(staging_dir: Path, out_dir: Path, prices_date: str, manifest: dict) -> Path:
    """Replace the previous snapshot in `out_dir` with `staging_dir` (renamed to `<prices_date>/`).

    Only previously generated content is removed (manifest.json and YYYY-MM-DD directories).
    The old manifest goes first and the new one is written last, so a crash in between never
    leaves a manifest pointing at missing or incomplete data.
    """
    old_manifest = out_dir / MANIFEST_NAME
    if old_manifest.exists():
        old_manifest.unlink()
    for child in sorted(out_dir.iterdir()):
        if child.is_dir() and DATE_DIR_RE.match(child.name):
            log.info("removing previous snapshot %s", child)
            remove_tree(child)
    move_tree(staging_dir, out_dir / prices_date)
    write_manifest(out_dir, manifest)
    return out_dir / MANIFEST_NAME


def write_manifest(out_dir: Path, manifest: dict) -> None:
    tmp = out_dir / f"{MANIFEST_NAME}.tmp"
    tmp.write_bytes(_encode(manifest).encode("utf-8"))
    _retry_io(lambda: os.replace(tmp, out_dir / MANIFEST_NAME), "write manifest.json")
