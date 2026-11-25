"""Command line: `azcalc-pipeline build ...` and `azcalc-pipeline fixture ...`."""

from __future__ import annotations

import argparse
import logging
import re
import sys
import time
from datetime import date as Date
from pathlib import Path

from . import PipelineError, build_indexes, download, fixture, fixtures_dir, manifest, report, transform
from .download import sha256_file
from .validate import SavingsPlanOrphanCheck, check_row_counts, open_text

log = logging.getLogger("azcalc_pipeline")

DEFAULT_MIN_ROWS = 900_000
DEFAULT_CACHE_DIR = Path(".cache/exporter")


def _date_arg(value: str) -> str:
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError
        Date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid date {value!r} (expected YYYY-MM-DD)") from None
    return value


def _list_arg(value: str) -> list[str]:
    items = [v.strip() for v in value.split(",") if v.strip()]
    if not items:
        raise argparse.ArgumentTypeError("expected a comma-separated list")
    return items


def _int_arg(minimum: int):
    def parse(value: str) -> int:
        try:
            number = int(value.replace("_", ""))
        except ValueError:
            raise argparse.ArgumentTypeError(f"invalid integer {value!r}") from None
        if number < minimum:
            raise argparse.ArgumentTypeError(f"must be >= {minimum}")
        return number

    return parse


def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    common.add_argument("-q", "--quiet", action="store_true", help="only log warnings and errors")

    parser = argparse.ArgumentParser(
        prog="azcalc-pipeline",
        description="Azure Retail Prices export -> static JSON shards for the Azure price calculator SPA.",
    )
    parser.add_argument("-v", "--verbose", dest="verbose_global", action="store_true", help="debug logging")
    commands = parser.add_subparsers(dest="command", required=True, metavar="COMMAND")

    build = commands.add_parser(
        "build", parents=[common], help="build manifest.json + <DATE>/ (price shards, indexes, fx, report)",
        description="Build the published data directory. Everything is staged inside --out and swapped in "
                    "only on success; manifest.json is written last.",
    )
    build.add_argument("--out", required=True, type=Path,
                       help="output directory (only manifest.json and YYYY-MM-DD dirs inside it are replaced)")
    source = build.add_argument_group("input")
    source.add_argument("--prices-csv", type=Path, help="local prices CSV (.csv, .csv.gz or .zip) instead of downloading")
    source.add_argument("--fx-csv", type=Path, help="local FX CSV (.csv, .csv.gz or .zip); required with --prices-csv")
    source.add_argument("--fixture", action="store_true",
                        help="use the synthetic sample in pipeline/tests/fixtures (min-rows 0, date "
                             f"{fixture.FIXTURE_DATE} unless --date)")
    source.add_argument("--repo", default=download.DEFAULT_REPO, help="exporter repository (default: %(default)s)")
    source.add_argument("--tag", help="exporter release tag, e.g. prices-2026-11-24 (default: newest dated release)")
    source.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR,
                        help="download cache (default: %(default)s)")
    source.add_argument("--date", type=_date_arg, help="override pricesDate (YYYY-MM-DD)")
    source.add_argument("--source-type", choices=("exporter", "fixture"),
                        help="manifest source.type (default: exporter; fixture with --fixture)")
    filters = build.add_argument_group("filters")
    filters.add_argument("--min-rows", type=_int_arg(0),
                         help=f"fail if the CSV has fewer data rows (default: {DEFAULT_MIN_ROWS:,}; 0 with --fixture)")
    filters.add_argument("--regions", type=_list_arg,
                         help="keep only these armRegionNames (comma-separated) plus rows without a region")
    filters.add_argument("--services", type=_list_arg, help="keep only these serviceNames (comma-separated)")
    limits = build.add_argument_group("size limits")
    limits.add_argument("--part-max-bytes", type=_int_arg(1024), default=transform.DEFAULT_PART_MAX_BYTES,
                        help="split a main shard into .partN.json files above this size (default: %(default)s)")
    limits.add_argument("--max-total-bytes", type=_int_arg(1), default=report.DEFAULT_MAX_TOTAL_BYTES,
                        help="fail if all published files exceed this size (default: %(default)s)")
    limits.add_argument("--max-file-bytes", type=_int_arg(1), default=report.DEFAULT_MAX_FILE_BYTES,
                        help="fail if any published file exceeds this size (default: %(default)s)")
    limits.add_argument("--no-size-limits", action="store_true", help="do not enforce the two limits above")

    regenerate = commands.add_parser("fixture", parents=[common], help="regenerate the synthetic sample CSVs")
    regenerate.add_argument("--out", type=Path, help="output directory (default: pipeline/tests/fixtures)")
    return parser


def _configure_logging(verbose: bool, quiet: bool) -> None:
    level = logging.DEBUG if verbose else logging.WARNING if quiet else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S",
                        stream=sys.stderr, force=True)


def _peak_rss_mb() -> float | None:
    try:
        import resource
    except ImportError:  # pragma: no cover - non-Unix
        return None
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak / 1024 if sys.platform != "darwin" else peak / (1024 * 1024)


def cmd_build(args: argparse.Namespace) -> int:
    started = time.monotonic()
    if args.fixture and (args.prices_csv or args.fx_csv):
        raise PipelineError("--fixture cannot be combined with --prices-csv/--fx-csv")
    if bool(args.prices_csv) != bool(args.fx_csv):
        raise PipelineError("--prices-csv and --fx-csv must be given together")
    source_type = args.source_type or ("fixture" if args.fixture else "exporter")
    min_rows = args.min_rows if args.min_rows is not None else (0 if args.fixture else DEFAULT_MIN_ROWS)
    out_dir: Path = args.out

    source: dict = {"type": source_type}
    if args.fixture or args.prices_csv:
        if args.fixture:
            prices_path = fixtures_dir() / fixture.PRICES_FILE
            fx_path = fixtures_dir() / fixture.FX_FILE
            prices_date = args.date or fixture.FIXTURE_DATE
        else:
            prices_path, fx_path = args.prices_csv, args.fx_csv
            tag_match = download.TAG_RE.match(args.tag or "")
            prices_date = args.date or (tag_match.group(1) if tag_match else download.utc_today())
            if source_type == "exporter":
                source["repo"] = args.repo
                if args.tag:
                    source["tag"] = args.tag
        for path in (prices_path, fx_path):
            if not path.is_file():
                raise PipelineError(f"input file not found: {path}")
        source["pricesSha256"] = sha256_file(prices_path)
        source["fxSha256"] = sha256_file(fx_path)
    else:
        release, prices_file, fx_file = download.download_release(args.repo, args.tag, args.cache_dir)
        prices_path, fx_path = prices_file.path, fx_file.path
        prices_date = args.date or release.prices_date
        source["repo"] = release.repo
        if release.tag:
            source["tag"] = release.tag
        source.update(pricesUrl=prices_file.url, fxUrl=fx_file.url,
                      pricesSha256=prices_file.sha256, fxSha256=fx_file.sha256)
    log.info("pricesDate %s, source %s, output %s", prices_date, source_type, out_dir)

    try:
        staging = manifest.make_staging_dir(out_dir)
    except OSError as exc:
        raise PipelineError(f"cannot prepare the output directory {out_dir}: {exc}") from exc
    try:
        date_root = staging  # becomes <out>/<prices_date>/ on publish
        with open_text(fx_path) as stream:
            rates = build_indexes.parse_fx_csv(stream)
        log.info("FX: %d currencies", len(rates))
        geo = build_indexes.load_region_geo()
        vm_base = build_indexes.load_vm_skus_base()

        log.info("reading %s", prices_path)
        with open_text(prices_path) as stream:
            read = transform.read_prices(stream, regions=args.regions, services=args.services)
        stats = read.stats
        source["rowCount"] = stats.rows_read
        log.info("read %s rows (%s kept, %s invalid, %s DevTest dropped, %s filtered out)",
                 f"{stats.rows_read:,}", f"{stats.rows_kept:,}", f"{stats.invalid.count:,}",
                 f"{stats.devtest_dropped:,}", f"{stats.filtered_region + stats.filtered_service:,}")
        check_row_counts(stats.rows_read, stats.invalid, min_rows)
        warnings: list[str] = []
        for issues in (stats.invalid, stats.savings_plan_errors, stats.tier_errors):
            if issues.count:
                warnings.append(issues.describe())
        if stats.rows_kept == 0:
            raise PipelineError("no rows left to publish (check --regions/--services)")

        probes = report.ProbeCollector()
        orphans = SavingsPlanOrphanCheck()
        published = transform.write_shards(read, date_root / "prices", args.part_max_bytes,
                                           observers=(probes, orphans))
        del read
        if orphans.issues.count:
            warnings.append(orphans.issues.describe())
        has_savings_plan = published.savings_plan_rows > 0
        if not has_savings_plan:
            warnings.append("no SavingsPlans rows: manifest.hasSavingsPlan is false (the SPA hides savings plans)")

        # Sizes are tracked as files are written (no directory walk: slow on network filesystems).
        files = [(f.path, f.bytes) for f in published.files]
        for relative, document in (
            ("index/services.json", build_indexes.services_index(published.services)),
            ("index/regions.json", build_indexes.regions_index(published.regions, geo)),
            ("index/vm-skus.json", build_indexes.vm_skus_index(vm_base, published.vm_skus)),
            ("index/shards.json", published.shards),
            ("fx.json", build_indexes.fx_index(rates, prices_date)),
        ):
            files.append((relative, build_indexes.write_json(date_root / relative, document)))
        files.sort()

        for warning in warnings:
            log.warning("%s", warning)
        violations = [] if args.no_size_limits else report.size_violations(
            files, args.max_total_bytes, args.max_file_bytes)
        generated_at = manifest.utc_now_iso()
        report_doc = report.build_report(
            prices_date=prices_date, generated_at=generated_at, source=source, stats=stats, published=published,
            files=files, warnings=warnings, probes=probes.result(),
            limits={"partMaxBytes": args.part_max_bytes, "maxTotalBytes": args.max_total_bytes,
                    "maxFileBytes": args.max_file_bytes, "enforced": not args.no_size_limits},
        )
        report_bytes = build_indexes.write_json(date_root / "report.json", report_doc)
        report.emit_summary(report.render_markdown(report_doc, failed=violations))
        if violations:
            raise PipelineError("size limits exceeded, nothing published: " + "; ".join(violations))

        doc = manifest.build_manifest(
            prices_date=prices_date, generated_at=generated_at, source=source, has_savings_plan=has_savings_plan,
            rows_published=published.rows_published,
            shard_count=sum(len(regions) for regions in published.shards.values()),
            files=len(files) + 1, total_bytes=sum(size for _, size in files) + report_bytes,
        )
        try:
            manifest_path = manifest.publish(staging, out_dir, prices_date, doc)
        except OSError as exc:
            raise PipelineError(f"publishing into {out_dir} failed ({exc}); no manifest.json was written") from exc
    finally:
        manifest.discard_staging(staging)

    peak = _peak_rss_mb()
    log.info("published %s rows in %s files (%s) -> %s [%.1fs%s]", f"{published.rows_published:,}",
             f"{len(files) + 1:,}", report.human_bytes(doc["stats"]["bytes"]), manifest_path,
             time.monotonic() - started, f", peak RSS {peak:,.0f} MB" if peak else "")
    return 0


def cmd_fixture(args: argparse.Namespace) -> int:
    out_dir = args.out or fixtures_dir()
    prices_path, fx_path = fixture.write_fixture(out_dir)
    log.info("wrote %s and %s", prices_path, fx_path)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose or args.verbose_global, args.quiet)
    try:
        if args.command == "build":
            return cmd_build(args)
        return cmd_fixture(args)
    except PipelineError as exc:
        log.error("%s", exc)
        return 1
    except KeyboardInterrupt:
        log.error("interrupted")
        return 130


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
