"""Resolve and download the daily release of sbroenne/azureretailprices-exporter.

Release resolution order:
  (a) --tag, if given;
  (b) newest non-draft release tagged prices-YYYY-MM-DD with both assets (GET /releases?per_page=20);
  (c) GET /releases/latest;
  (d) direct "latest" download URLs (date = today UTC).
A GITHUB_TOKEN is only ever sent to api.github.com, as an unredirected header.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import PipelineError, __version__

log = logging.getLogger(__name__)

DEFAULT_REPO = "sbroenne/azureretailprices-exporter"
API_ROOT = "https://api.github.com"
API_HOST = "api.github.com"
USER_AGENT = f"azcalc-pipeline/{__version__} (Azure price calculator data build; python-urllib)"
PRICES_ASSET = "azure-retail-prices-usd"
FX_ASSET = "azure-fxrates-usd"
TAG_RE = re.compile(r"^prices-(\d{4}-\d{2}-\d{2})$")
#: Accepted asset extensions, most preferred (smallest download) first.
EXTENSIONS: tuple[str, ...] = ("csv.gz", "gz", "csv.zip", "zip", "csv")
RETRY_DELAYS: tuple[float, ...] = (2, 4, 8, 16, 32)
TIMEOUT_SECONDS = 120
CHUNK_BYTES = 1 << 20
NETWORK_ERRORS = (urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError)
_REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

Opener = Callable[[urllib.request.Request, float], Any]


class NotFound(PipelineError):
    """HTTP 404 (not retried)."""


@dataclass(frozen=True)
class Asset:
    name: str
    url: str
    size: int | None = None
    updated_at: str | None = None
    alt_urls: tuple[str, ...] = ()


@dataclass(frozen=True)
class Release:
    repo: str
    tag: str | None
    prices_date: str
    prices: Asset
    fx: Asset
    resolved_by: str  # "tag" | "releases" | "latest" | "direct"


@dataclass(frozen=True)
class Downloaded:
    path: Path
    url: str
    sha256: str
    size: int


def utc_today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _default_opener(request: urllib.request.Request, timeout: float) -> Any:
    return urllib.request.urlopen(request, timeout=timeout)  # noqa: S310 - https URLs only


def _retry_after(exc: urllib.error.HTTPError) -> float:
    headers = getattr(exc, "headers", None)
    value = headers.get("Retry-After") if headers is not None else None
    try:
        return float(value) if value else 0.0
    except ValueError:
        return 0.0


class HttpClient:
    """Tiny urllib wrapper: User-Agent, retries with exponential backoff, streamed downloads."""

    def __init__(
        self,
        token: str | None = None,
        opener: Opener | None = None,
        sleep: Callable[[float], None] = time.sleep,
        delays: Sequence[float] = RETRY_DELAYS,
        timeout: float = TIMEOUT_SECONDS,
    ) -> None:
        self._token = token or None
        self._opener = opener or _default_opener
        self._sleep = sleep
        self._delays = tuple(delays)
        self._timeout = timeout

    def request(self, url: str, accept: str | None = None) -> urllib.request.Request:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        if accept:
            req.add_header("Accept", accept)
        if urllib.parse.urlsplit(url).hostname == API_HOST:
            req.add_header("X-GitHub-Api-Version", "2022-11-28")
            if self._token:
                # Unredirected headers are not copied to redirect targets (e.g. blob storage).
                req.add_unredirected_header("Authorization", f"Bearer {self._token}")
        return req

    def _retry(self, what: str, action: Callable[[], Any]) -> Any:
        attempts = len(self._delays) + 1
        for attempt in range(attempts):
            try:
                return action()
            except urllib.error.HTTPError as exc:
                status, reason, wait = exc.code, exc.reason, _retry_after(exc)
                exc.close()
                if status == 404:
                    raise NotFound(f"{what}: HTTP 404 Not Found") from None
                if not (status == 429 or 500 <= status <= 599) or attempt == attempts - 1:
                    hint = ""
                    if status in (401, 403) and API_HOST in what:
                        hint = " (GitHub API rate limit or invalid token? GITHUB_TOKEN raises the limit)"
                    raise PipelineError(f"{what}: HTTP {status} {reason}{hint}") from None
                delay = max(self._delays[attempt], min(wait, 120.0))
                problem = f"HTTP {status}"
            except NETWORK_ERRORS as exc:
                if attempt == attempts - 1:
                    raise PipelineError(f"{what}: network error: {exc}") from None
                delay = self._delays[attempt]
                problem = f"{type(exc).__name__}: {exc}"
            log.warning("%s failed (%s); retry %d/%d in %ss", what, problem, attempt + 1, attempts - 1, delay)
            self._sleep(delay)
        raise AssertionError("unreachable")  # pragma: no cover

    def get_json(self, url: str) -> Any:
        def action() -> Any:
            with self._opener(self.request(url, "application/vnd.github+json"), self._timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))

        return self._retry(f"GET {url}", action)

    def download(self, url: str, dest: Path) -> Downloaded:
        """Stream `url` to `dest` (via dest.part), computing sha256. Retries restart from scratch."""
        partial = dest.with_name(dest.name + ".part")

        def action() -> tuple[str, int]:
            digest = hashlib.sha256()
            size = 0
            with self._opener(self.request(url), self._timeout) as resp, open(partial, "wb") as fh:
                expected = resp.headers.get("Content-Length") if resp.headers is not None else None
                while True:
                    chunk = resp.read(CHUNK_BYTES)
                    if not chunk:
                        break
                    digest.update(chunk)
                    fh.write(chunk)
                    size += len(chunk)
            if expected and str(expected).isdigit() and int(expected) != size:
                raise http.client.IncompleteRead(b"", int(expected) - size)
            return digest.hexdigest(), size

        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            sha256, size = self._retry(f"download {url}", action)
        except BaseException:
            partial.unlink(missing_ok=True)
            raise
        os.replace(partial, dest)
        log.info("downloaded %s: %s bytes, sha256 %s", dest.name, f"{size:,}", sha256)
        return Downloaded(path=dest, url=url, sha256=sha256, size=size)


# --------------------------------------------------------------------------------------------
# Release resolution
# --------------------------------------------------------------------------------------------

def _asset_pattern(base: str) -> re.Pattern[str]:
    alternatives = "|".join(re.escape(ext) for ext in EXTENSIONS)
    return re.compile(rf"^{re.escape(base)}\.({alternatives})$", re.IGNORECASE)


def pick_asset(assets: Sequence[dict], base: str) -> Asset | None:
    """The preferred variant (.csv.gz > .gz > .csv.zip > .zip > .csv) of an asset, if present."""
    pattern = _asset_pattern(base)
    by_extension: dict[str, dict] = {}
    for asset in assets:
        match = pattern.match(str(asset.get("name") or ""))
        if match and asset.get("browser_download_url"):
            by_extension.setdefault(match.group(1).lower(), asset)
    for ext in EXTENSIONS:
        asset = by_extension.get(ext)
        if asset:
            size = asset.get("size")
            return Asset(
                name=str(asset["name"]),
                url=str(asset["browser_download_url"]),
                size=int(size) if isinstance(size, int) else None,
                updated_at=asset.get("updated_at"),
            )
    return None


def _prices_date(tag: str | None, asset: Asset) -> str:
    match = TAG_RE.match(tag or "")
    if match:
        return match.group(1)
    if asset.updated_at and re.match(r"^\d{4}-\d{2}-\d{2}", asset.updated_at):
        return asset.updated_at[:10]  # GitHub timestamps are UTC ("2026-11-24T06:03:11Z")
    return utc_today()


def release_from_api(repo: str, data: dict, resolved_by: str) -> Release | None:
    assets = data.get("assets") or []
    prices = pick_asset(assets, PRICES_ASSET)
    fx = pick_asset(assets, FX_ASSET)
    if prices is None or fx is None:
        return None
    tag = data.get("tag_name") or None
    return Release(repo=repo, tag=tag, prices_date=_prices_date(tag, prices), prices=prices, fx=fx,
                   resolved_by=resolved_by)


def resolve_release(client: HttpClient, repo: str = DEFAULT_REPO, tag: str | None = None) -> Release:
    if not _REPO_RE.match(repo):
        raise PipelineError(f"invalid --repo {repo!r} (expected owner/name)")
    if tag:
        data = client.get_json(f"{API_ROOT}/repos/{repo}/releases/tags/{urllib.parse.quote(tag, safe='')}")
        release = release_from_api(repo, data, "tag")
        if release is None:
            names = [a.get("name") for a in data.get("assets") or []]
            raise PipelineError(f"release {tag} of {repo} lacks {PRICES_ASSET}.csv and/or {FX_ASSET}.csv "
                                f"(assets: {names})")
        return release

    try:
        listing = client.get_json(f"{API_ROOT}/repos/{repo}/releases?per_page=20")
        candidates: list[tuple[str, str, Release]] = []
        for data in listing if isinstance(listing, list) else []:
            if data.get("draft") or not TAG_RE.match(str(data.get("tag_name") or "")):
                continue
            release = release_from_api(repo, data, "releases")
            if release is not None:
                candidates.append((release.prices_date, str(data.get("published_at") or ""), release))
        if candidates:
            return max(candidates, key=lambda c: (c[0], c[1]))[2]
        log.warning("no prices-YYYY-MM-DD release with both assets among the newest 20; trying releases/latest")
    except PipelineError as exc:
        log.warning("listing releases failed (%s); trying releases/latest", exc)

    try:
        data = client.get_json(f"{API_ROOT}/repos/{repo}/releases/latest")
        release = release_from_api(repo, data, "latest")
        if release is not None:
            return release
        log.warning("releases/latest (%s) lacks the expected assets; trying direct URLs", data.get("tag_name"))
    except PipelineError as exc:
        log.warning("releases/latest failed (%s); trying direct download URLs", exc)

    base = f"https://github.com/{repo}/releases"

    def direct(name: str) -> Asset:
        return Asset(name=name, url=f"{base}/download/latest/{name}", alt_urls=(f"{base}/latest/download/{name}",))

    return Release(repo=repo, tag=None, prices_date=utc_today(), prices=direct(f"{PRICES_ASSET}.csv"),
                   fx=direct(f"{FX_ASSET}.csv"), resolved_by="direct")


# --------------------------------------------------------------------------------------------
# Download with a cache
# --------------------------------------------------------------------------------------------

def fetch_asset(client: HttpClient, asset: Asset, cache_dir: Path) -> Downloaded:
    """Download an asset into cache_dir, unless the same asset (name+size+updated_at) is cached."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / asset.name
    sidecar = cache_dir / f"{asset.name}.json"
    if asset.size is not None and asset.updated_at and dest.is_file() and sidecar.is_file():
        try:
            meta = json.loads(sidecar.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            meta = {}
        if (
            meta.get("name") == asset.name
            and meta.get("size") == asset.size
            and meta.get("updated_at") == asset.updated_at
            and meta.get("sha256")
            and dest.stat().st_size == asset.size
        ):
            log.info("using cached %s (%s bytes, updated %s)", asset.name, f"{asset.size:,}", asset.updated_at)
            return Downloaded(path=dest, url=asset.url, sha256=str(meta["sha256"]), size=asset.size)

    result: Downloaded | None = None
    errors: list[str] = []
    for url in (asset.url, *asset.alt_urls):
        try:
            result = client.download(url, dest)
            break
        except NotFound as exc:
            errors.append(str(exc))
            log.warning("%s", exc)
    if result is None:
        raise PipelineError(f"could not download {asset.name}: {'; '.join(errors)}")
    if asset.size is not None and result.size != asset.size:
        raise PipelineError(f"{asset.name}: downloaded {result.size:,} bytes but the release lists {asset.size:,}")
    sidecar.write_text(json.dumps({
        "name": asset.name,
        "size": result.size,
        "updated_at": asset.updated_at,
        "url": result.url,
        "sha256": result.sha256,
        "downloadedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }, indent=2), encoding="utf-8")
    return result


def download_release(
    repo: str,
    tag: str | None,
    cache_dir: Path,
    token: str | None = None,
    client: HttpClient | None = None,
) -> tuple[Release, Downloaded, Downloaded]:
    if client is None:
        client = HttpClient(token=token if token is not None else os.environ.get("GITHUB_TOKEN"))
    release = resolve_release(client, repo, tag)
    log.info("exporter release: %s (pricesDate %s, resolved via %s)", release.tag or "latest (direct URLs)",
             release.prices_date, release.resolved_by)
    prices = fetch_asset(client, release.prices, cache_dir)
    fx = fetch_asset(client, release.fx, cache_dir)
    return release, prices, fx
