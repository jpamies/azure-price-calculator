import email.message
import hashlib
import io
import json
import unittest
import urllib.error
from pathlib import Path

from _helpers import scratch_dir
from azcalc_pipeline import PipelineError
from azcalc_pipeline.download import (
    API_ROOT,
    Asset,
    HttpClient,
    NotFound,
    fetch_asset,
    pick_asset,
    resolve_release,
)

REPO = "sbroenne/azureretailprices-exporter"
LIST_URL = f"{API_ROOT}/repos/{REPO}/releases?per_page=20"
LATEST_URL = f"{API_ROOT}/repos/{REPO}/releases/latest"
BOTH = ["azure-retail-prices-usd.csv", "azure-fxrates-usd.csv"]


class FakeResponse:
    def __init__(self, body: bytes, headers: dict | None = None) -> None:
        self._body = io.BytesIO(body)
        self.headers = headers if headers is not None else {"Content-Length": str(len(body))}

    def read(self, size: int = -1) -> bytes:
        return self._body.read(size)

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False


def http_error(url: str, code: int, headers: dict | None = None) -> urllib.error.HTTPError:
    message = email.message.Message()
    for key, value in (headers or {}).items():
        message[key] = value
    return urllib.error.HTTPError(url, code, f"status {code}", message, None)


class FakeOpener:
    """URL -> list of outcomes consumed in order (the last one repeats). Unknown URLs -> 404."""

    def __init__(self, routes: dict[str, list] | None = None) -> None:
        self.routes = {url: list(outcomes) for url, outcomes in (routes or {}).items()}
        self.requests: list = []

    def __call__(self, request, timeout):
        self.requests.append(request)
        outcomes = self.routes.get(request.full_url)
        if not outcomes:
            raise http_error(request.full_url, 404)
        outcome = outcomes.pop(0) if len(outcomes) > 1 else outcomes[0]
        if isinstance(outcome, BaseException):
            raise outcome
        if isinstance(outcome, FakeResponse):
            return outcome
        if isinstance(outcome, (dict, list)):
            outcome = json.dumps(outcome).encode()
        return FakeResponse(outcome)


def asset_json(name: str, updated: str = "2026-11-24T06:03:11Z", size: int = 100) -> dict:
    return {"name": name, "size": size, "updated_at": updated,
            "browser_download_url": f"https://github.com/{REPO}/releases/download/x/{name}"}


def release_json(tag: str, names: list[str], draft: bool = False, updated: str = "2026-11-24T06:03:11Z") -> dict:
    return {"tag_name": tag, "draft": draft, "published_at": updated, "assets": [asset_json(n, updated) for n in names]}


class Recorder:
    def __init__(self) -> None:
        self.sleeps: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.sleeps.append(seconds)


def client(opener: FakeOpener, sleeps: Recorder | None = None, token: str | None = None, delays=(2, 4, 8, 16, 32)):
    return HttpClient(token=token, opener=opener, sleep=sleeps or Recorder(), delays=delays)


class ReleaseResolutionTests(unittest.TestCase):
    def test_newest_dated_release_with_both_assets(self) -> None:
        listing = [
            release_json("prices-2026-11-25", BOTH, draft=True),
            release_json("latest", BOTH),
            release_json("prices-2026-11-24", ["azure-retail-prices-usd.csv"]),
            release_json("prices-2026-11-22", BOTH),
            release_json("prices-2026-11-23", BOTH + ["azure-retail-prices-usd.csv.zip"]),
        ]
        release = resolve_release(client(FakeOpener({LIST_URL: [listing]})), REPO)
        self.assertEqual((release.tag, release.prices_date, release.resolved_by),
                         ("prices-2026-11-23", "2026-11-23", "releases"))
        self.assertEqual(release.prices.name, "azure-retail-prices-usd.csv.zip")
        self.assertEqual(release.fx.name, "azure-fxrates-usd.csv")
        self.assertEqual(release.prices.size, 100)

    def test_asset_preference(self) -> None:
        assets = [asset_json(n) for n in ("azure-retail-prices-usd.csv", "azure-retail-prices-usd.zip",
                                          "azure-retail-prices-usd.csv.gz", "azure-retail-prices-usd.parquet")]
        self.assertEqual(pick_asset(assets, "azure-retail-prices-usd").name, "azure-retail-prices-usd.csv.gz")
        self.assertEqual(pick_asset(assets[:1], "azure-retail-prices-usd").name, "azure-retail-prices-usd.csv")
        self.assertIsNone(pick_asset(assets[3:], "azure-retail-prices-usd"))
        self.assertIsNone(pick_asset(assets, "azure-fxrates-usd"))

    def test_explicit_tag(self) -> None:
        url = f"{API_ROOT}/repos/{REPO}/releases/tags/prices-2026-11-20"
        release = resolve_release(client(FakeOpener({url: [release_json("prices-2026-11-20", BOTH)]})), REPO,
                                  "prices-2026-11-20")
        self.assertEqual((release.prices_date, release.resolved_by), ("2026-11-20", "tag"))
        with self.assertRaises(NotFound):
            resolve_release(client(FakeOpener()), REPO, "prices-2001-01-01")
        with self.assertRaisesRegex(PipelineError, "lacks"):
            resolve_release(client(FakeOpener({url: [release_json("prices-2026-11-20", BOTH[:1])]})), REPO,
                            "prices-2026-11-20")

    def test_falls_back_to_latest_after_listing_fails(self) -> None:
        sleeps = Recorder()
        opener = FakeOpener({
            LIST_URL: [http_error(LIST_URL, 502)],
            LATEST_URL: [release_json("v1.2", BOTH, updated="2026-11-20T23:59:00Z")],
        })
        release = resolve_release(client(opener, sleeps, delays=(1, 1)), REPO)
        self.assertEqual((release.tag, release.prices_date, release.resolved_by), ("v1.2", "2026-11-20", "latest"))
        self.assertEqual(sleeps.sleeps, [1, 1])

    def test_direct_urls_as_last_resort(self) -> None:
        release = resolve_release(client(FakeOpener()), REPO)
        self.assertEqual(release.resolved_by, "direct")
        self.assertIsNone(release.tag)
        self.assertEqual(release.prices.url,
                         f"https://github.com/{REPO}/releases/download/latest/azure-retail-prices-usd.csv")
        self.assertEqual(release.fx.alt_urls,
                         (f"https://github.com/{REPO}/releases/latest/download/azure-fxrates-usd.csv",))

    def test_invalid_repo(self) -> None:
        with self.assertRaisesRegex(PipelineError, "invalid --repo"):
            resolve_release(client(FakeOpener()), "not a repo")


class HttpClientTests(unittest.TestCase):
    def test_token_only_sent_to_api_github_com_and_never_redirected(self) -> None:
        http = client(FakeOpener(), token="s3cr3t-token")
        api = http.request(LIST_URL)
        self.assertEqual(api.unredirected_hdrs.get("Authorization"), "Bearer s3cr3t-token")
        self.assertNotIn("Authorization", api.headers)  # headers copied on redirect: must not carry it
        for url in (f"https://github.com/{REPO}/releases/download/x/a.csv",
                    "https://objects.githubusercontent.com/a.csv", "https://api.github.com.evil.example/x"):
            with self.subTest(url=url):
                self.assertFalse(http.request(url).has_header("Authorization"))
        self.assertFalse(client(FakeOpener()).request(LIST_URL).has_header("Authorization"))
        self.assertTrue(api.get_header("User-agent", "").startswith("azcalc-pipeline/"))

    def test_retries_with_backoff_and_retry_after(self) -> None:
        sleeps = Recorder()
        url = f"{API_ROOT}/x"
        opener = FakeOpener({url: [http_error(url, 503), http_error(url, 429, {"Retry-After": "7"}),
                                   urllib.error.URLError("temporary DNS failure"), {"ok": True}]})
        self.assertEqual(client(opener, sleeps).get_json(url), {"ok": True})
        self.assertEqual(sleeps.sleeps, [2, 7, 8])

    def test_gives_up_after_five_retries(self) -> None:
        sleeps = Recorder()
        url = f"{API_ROOT}/x"
        with self.assertRaisesRegex(PipelineError, "HTTP 500"):
            client(FakeOpener({url: [http_error(url, 500)]}), sleeps).get_json(url)
        self.assertEqual(sleeps.sleeps, [2, 4, 8, 16, 32])

    def test_client_errors_are_not_retried(self) -> None:
        sleeps = Recorder()
        url = f"{API_ROOT}/x"
        with self.assertRaises(NotFound):
            client(FakeOpener(), sleeps).get_json(url)
        with self.assertRaisesRegex(PipelineError, "rate limit"):
            client(FakeOpener({url: [http_error(url, 403)]}), sleeps).get_json(url)
        self.assertEqual(sleeps.sleeps, [])


class FetchAssetTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = scratch_dir()
        self.cache = Path(self._tmp.name) / "cache"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_download_hash_and_cache(self) -> None:
        body = b"currency,fxRate\nEUR,0.92\n"
        asset = Asset(name="azure-fxrates-usd.csv", url="https://github.com/o/r/releases/download/t/fx.csv",
                      size=len(body), updated_at="2026-11-24T06:00:00Z")
        opener = FakeOpener({asset.url: [body]})
        result = fetch_asset(client(opener, token="tok"), asset, self.cache)
        self.assertEqual(result.path.read_bytes(), body)
        self.assertEqual(result.sha256, hashlib.sha256(body).hexdigest())
        self.assertFalse(opener.requests[0].has_header("Authorization"))
        self.assertFalse(list(self.cache.glob("*.part")))

        cached_opener = FakeOpener()
        again = fetch_asset(client(cached_opener), asset, self.cache)
        self.assertEqual((again.path, again.sha256), (result.path, result.sha256))
        self.assertEqual(cached_opener.requests, [])

        newer = Asset(name=asset.name, url=asset.url, size=len(body), updated_at="2026-11-25T06:00:00Z")
        refreshed_opener = FakeOpener({asset.url: [body]})
        fetch_asset(client(refreshed_opener), newer, self.cache)
        self.assertEqual(len(refreshed_opener.requests), 1)

    def test_truncated_body_is_retried_and_size_checked(self) -> None:
        body = b"x" * 50
        asset = Asset(name="a.csv", url="https://github.com/o/r/a.csv", size=50, updated_at="2026-11-24T06:00:00Z")
        truncated = FakeResponse(body[:20], headers={"Content-Length": "50"})
        sleeps = Recorder()
        result = fetch_asset(client(FakeOpener({asset.url: [truncated, body]}), sleeps), asset, self.cache)
        self.assertEqual(result.size, 50)
        self.assertEqual(sleeps.sleeps, [2])
        wrong_size = Asset(name="b.csv", url="https://github.com/o/r/b.csv", size=999, updated_at="x")
        with self.assertRaisesRegex(PipelineError, "release lists 999"):
            fetch_asset(client(FakeOpener({wrong_size.url: [body]})), wrong_size, self.cache)

    def test_alternative_url_when_primary_is_missing(self) -> None:
        asset = Asset(name="c.csv", url="https://github.com/o/r/releases/download/latest/c.csv",
                      alt_urls=("https://github.com/o/r/releases/latest/download/c.csv",))
        result = fetch_asset(client(FakeOpener({asset.alt_urls[0]: [b"ok"]})), asset, self.cache)
        self.assertEqual((result.url, result.path.read_bytes()), (asset.alt_urls[0], b"ok"))
        with self.assertRaisesRegex(PipelineError, "could not download"):
            fetch_asset(client(FakeOpener()), Asset(name="d.csv", url="https://github.com/o/r/d.csv"), self.cache)


if __name__ == "__main__":
    unittest.main()
