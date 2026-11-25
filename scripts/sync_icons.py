#!/usr/bin/env python3
"""Copy the official Azure Architecture Icons used by the web app into web/public/icons/azure/.

Source: Microsoft's "Azure Architecture Icons" ZIP linked from
https://learn.microsoft.com/azure/architecture/icons/ . The ZIP URL changes with every release
(..._V<N>.zip), so it is discovered from that page; PINNED_ZIP_URL is the fallback, and --zip-url /
--zip-file override both. File numbers also change between releases, so icons are located by name
pattern (see ICONS), never by number.

For every key in ICONS the first pattern that matches an SVG in the ZIP wins. The file is copied
byte-for-byte to <dest>/<key>.svg (Microsoft's terms do not allow cropping, recoloring or otherwise
altering the icons, so no optimisation either) and <dest>/index.json records what was copied:
  {"source": url, "version": "V<N>" | null, "syncedAt": ISO-8601, "icons": {key: originalFileName}}
Keys without a match are reported and left out; the UI then draws a neutral fallback tile.
ICONS keys must match ICON_KEYS in web/src/catalog/icon-map.ts (checked by test_sync_icons.py).

Usage:
  python3 scripts/sync_icons.py                    # discover and download the current ZIP
  python3 scripts/sync_icons.py --zip-file X.zip   # offline, from a ZIP downloaded by hand
  python3 scripts/sync_icons.py --if-missing       # CI: no-op when index.json already lists icons
  python3 scripts/sync_icons.py --list --zip-file X.zip   # print every SVG name in the ZIP

Exit status: 0 on success (even if some icons are missing); 1 if the ZIP cannot be obtained or read,
or contains none of the expected icons (the output directory is then left untouched).
Python 3.10+, standard library only.
"""

from __future__ import annotations

import argparse
import http.client
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

LEARN_PAGES = (
    "https://learn.microsoft.com/en-us/azure/architecture/icons/",
    # Markdown source of the same page; used if the rendered page cannot be read or parsed.
    "https://raw.githubusercontent.com/MicrosoftDocs/architecture-center/main/docs/icons/index.md",
)
PINNED_ZIP_URL = "https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V21.zip"
USER_AGENT = "azure-price-calculator-icon-sync/1.0 (+https://learn.microsoft.com/azure/architecture/icons/)"

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DEST = REPO_ROOT / "web" / "public" / "icons" / "azure"

ZIP_URL_RE = re.compile(r"(?:https?:)?//arch-center\.azureedge\.net/icons/[\w.%-]+\.zip", re.IGNORECASE)
VERSION_RE = re.compile(r"_V(\d+)\.zip$", re.IGNORECASE)
SAFE_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")

# key -> name patterns, most specific first. A pattern is the part of the official file name
# after "<number>-icon-service-" and before ".svg" (e.g. 10021-icon-service-Virtual-Machine.svg ->
# "Virtual-Machine"); matching is case-insensitive and treats "-", "_" and spaces alike.
ICONS: dict[str, list[str]] = {
    # Calculator modules
    "virtual-machines": ["Virtual-Machine", "Virtual-Machines"],
    "managed-disks": ["Disks", "Managed-Disks"],
    "backup": ["Backup-Vault", "Backup-Vaults", "Recovery-Services-Vaults", "Azure-Backup-Center"],
    # The set has no dedicated Site Recovery icon; ASR runs in a Recovery Services vault.
    "site-recovery": ["Site-Recovery", "Azure-Site-Recovery", "Recovery-Services-Vaults"],
    "sql-server": ["Azure-SQL-VM", "SQL-Server", "SQL-Servers"],
    "generic": ["All-Resources", "Resource-Groups"],
    # serviceFamily fallbacks: generic "general" icons where the set has one
    "compute": ["Server-Farm", "Virtual-Machine"],
    "storage": ["Storage-Accounts"],
    "networking": ["Virtual-Networks"],
    "databases": ["Production-Ready-Database", "Azure-SQL", "SQL-Database"],
    "ai-machine-learning": ["AI-Services", "Cognitive-Services", "Machine-Learning"],
    "analytics": ["Metrics", "Analysis-Services"],
    "containers": ["Container-Instances", "Kubernetes-Services"],
    "security": ["Security", "Microsoft-Defender-for-Cloud"],
    "identity": ["Users", "Entra-Managed-Identities", "Managed-Identities"],
    "integration": ["Workflow", "Integration-Accounts", "Logic-Apps"],
    "iot": ["IoT-Hub"],
    "management-governance": ["Management-Groups", "Policy"],
    "web": ["Browser", "App-Services"],
    "developer-tools": ["Code", "Dev-Console", "Azure-DevOps"],
    "migration": ["Azure-Migrate"],
    "mixed-reality": ["Remote-Rendering", "Spatial-Anchor-Accounts"],
    "other": ["All-Resources"],
    # Compute and containers
    "app-service": ["App-Services", "App-Service"],
    "functions": ["Function-Apps", "Function-App", "Functions"],
    "virtual-desktop": ["Azure-Virtual-Desktop", "Windows-Virtual-Desktop"],
    "vmware": ["Azure-VMware-Solution", "AVS"],
    "batch": ["Batch-Accounts"],
    "kubernetes": ["Kubernetes-Services", "AKS-Automatic"],
    "container-apps": ["Container-Apps-Environments", "Container-Apps", "Worker-Container-App"],
    "container-instances": ["Container-Instances"],
    "container-registry": ["Container-Registries", "Container-Registry"],
    # Storage
    "storage-accounts": ["Storage-Accounts"],
    "blob": ["Blob-Block", "Storage-Container", "Blob-Page"],
    "files": ["Azure-Fileshares", "Storage-Azure-Files", "Managed-File-Shares"],
    "netapp-files": ["Azure-NetApp-Files"],
    # Databases
    "sql-database": ["SQL-Database", "Azure-SQL"],
    "sql-managed-instance": ["SQL-Managed-Instance"],
    "cosmos-db": ["Azure-Cosmos-DB", "Cosmos-DB"],
    "postgresql": ["Azure-Database-PostgreSQL-Server", "Azure-Database-PostgreSQL-Server-Group"],
    "mysql": ["Azure-Database-MySQL-Server"],
    "redis": ["Cache-Redis", "Azure-Managed-Redis", "Azure-Cache-for-Redis"],
    # Networking
    "virtual-network": ["Virtual-Networks"],
    "load-balancer": ["Load-Balancers"],
    "application-gateway": ["Application-Gateways"],
    "firewall": ["Firewalls", "Azure-Firewall"],
    "vpn-gateway": ["Virtual-Network-Gateways", "VPN-Gateways"],
    "expressroute": ["ExpressRoute-Circuits", "ExpressRoute-Direct"],
    "dns": ["DNS-Zones", "DNS-Private-Resolver"],
    "front-door": ["Front-Door-and-CDN-Profiles", "Front-Doors"],
    "cdn": ["CDN-Profiles", "Front-Door-and-CDN-Profiles"],
    "traffic-manager": ["Traffic-Manager-Profiles"],
    "nat-gateway": ["NAT", "NAT-Gateways"],
    "bandwidth": ["Connections", "Input-Output"],
    "public-ip": ["Public-IP-Addresses", "Public-IP-Prefixes"],
    "private-link": ["Private-Link", "Private-Endpoints", "Private-Link-Services"],
    "ddos-protection": ["DDoS-Protection-Plans"],
    "bastion": ["Bastions", "Bastion"],
    # Security
    "key-vault": ["Key-Vaults", "Key-Vault"],
    "defender": ["Microsoft-Defender-for-Cloud", "Azure-Security-Center", "Security-Center"],
    "sentinel": ["Azure-Sentinel", "Microsoft-Sentinel", "Sentinel"],
    # Management and monitoring
    "monitor": ["Monitor", "Azure-Monitor"],
    "log-analytics": ["Log-Analytics-Workspaces"],
    "application-insights": ["Application-Insights"],
    "automation": ["Automation-Accounts"],
    "azure-arc": ["Azure-Arc", "Arc-Machines"],
    # AI + machine learning
    "openai": ["Azure-OpenAI", "OpenAI"],
    "foundry": ["Foundry", "AI-Foundry", "Microsoft-Foundry", "Azure-AI-Foundry", "AI-Studio"],
    "ai-services": ["AI-Services", "Cognitive-Services"],
    "ai-search": ["AI-Search", "Cognitive-Search"],
    "machine-learning": ["Machine-Learning", "Azure-Machine-Learning"],
    # Analytics
    "synapse": ["Azure-Synapse-Analytics"],
    "data-factory": ["Data-Factories", "Data-Factory"],
    "databricks": ["Azure-Databricks"],
    "data-explorer": ["Azure-Data-Explorer-Clusters"],
    "stream-analytics": ["Stream-Analytics-Jobs"],
    "hdinsight": ["HD-Insight-Clusters", "HDInsight-Clusters"],
    "power-bi-embedded": ["Power-BI-Embedded"],
    # Integration
    "event-hubs": ["Event-Hubs"],
    "event-grid": ["Event-Grid-Topics", "Event-Grid-Domains", "Event-Grid-Subscriptions"],
    "service-bus": ["Azure-Service-Bus", "Service-Bus"],
    "logic-apps": ["Logic-Apps"],
    "api-management": ["API-Management-Services"],
    # Web, developer and other
    "static-web-apps": ["Static-Apps", "Static-Web-Apps"],
    "signalr": ["SignalR"],
    "communication-services": ["Azure-Communication-Services"],
    "devops": ["Azure-DevOps"],
    "azure-stack": ["Azure-Stack", "Azure-Local", "Azure-Stack-Edge"],
    "power-platform": ["Power-Platform"],
}


class IconSyncError(Exception):
    """The icon ZIP could not be obtained or read."""


def log(message: str) -> None:
    print(message, file=sys.stderr)


# --- Matching ---------------------------------------------------------------------------------


def pattern_regex(pattern: str) -> re.Pattern[str]:
    """Regex for one name pattern, matched against an SVG base name.

    Accepts "<digits>-icon-service-<pattern>.svg" (any number, odd spacing around the dash),
    "icon-service-<pattern>.svg" and the bare "<pattern>.svg" used by flattened copies of the set.
    """
    parts = [re.escape(part) for part in re.split(r"[-_\s]+", pattern.strip()) if part]
    if not parts:
        raise ValueError(f"empty icon name pattern: {pattern!r}")
    body = r"[-_\s]*".join(parts)
    return re.compile(rf"^(?:(?:\d+\s*-\s*)?icon-service-)?{body}\s*\.svg$", re.IGNORECASE)


def base_name(entry: str) -> str:
    return PurePosixPath(entry.replace("\\", "/")).name


def list_svg_entries(zf: zipfile.ZipFile) -> list[str]:
    """SVG members of the ZIP (macOS resource forks skipped), sorted for deterministic picks."""
    entries = []
    for info in zf.infolist():
        if info.is_dir():
            continue
        path = PurePosixPath(info.filename.replace("\\", "/"))
        if "__MACOSX" in path.parts or path.name.startswith("._"):
            continue
        if path.suffix.lower() == ".svg":
            entries.append(info.filename)
    return sorted(entries, key=lambda name: (name.lower(), name))


def match_icons(entries: Sequence[str], table: Mapping[str, Sequence[str]] = ICONS) -> dict[str, str]:
    """key -> ZIP entry for every key with a match; the first matching pattern wins."""
    named = [(base_name(entry), entry) for entry in entries]
    found: dict[str, str] = {}
    for key, patterns in table.items():
        for pattern in patterns:
            regex = pattern_regex(pattern)
            hit = next((entry for name, entry in named if regex.match(name)), None)
            if hit is not None:
                found[key] = hit
                break
    return found


# --- Download ---------------------------------------------------------------------------------


def http_get(url: str, *, attempts: int = 4, timeout: float = 60.0, backoff: float = 2.0) -> bytes:
    """GET with retries and exponential backoff; raises IconSyncError when every attempt fails."""
    last_error: object = None
    for attempt in range(1, attempts + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            last_error = f"HTTP {exc.code} {exc.reason}"
            if 400 <= exc.code < 500 and exc.code not in (408, 429):
                break
        except (urllib.error.URLError, http.client.HTTPException, OSError) as exc:
            last_error = getattr(exc, "reason", None) or exc
        if attempt < attempts:
            delay = backoff * 2 ** (attempt - 1)
            log(f"  {url}: {last_error}; retrying in {delay:g}s ({attempt}/{attempts})")
            time.sleep(delay)
    raise IconSyncError(f"GET {url} failed: {last_error}")


def version_number(url_or_name: str) -> int | None:
    path = urllib.parse.urlsplit(url_or_name).path or url_or_name
    match = VERSION_RE.search(path)
    return int(match.group(1)) if match else None


def pick_zip_url(text: str) -> str | None:
    """The icon ZIP link with the highest version number in a page, if any."""
    urls = {("https:" + url) if url.startswith("//") else url for url in ZIP_URL_RE.findall(text)}
    if not urls:
        return None
    return max(urls, key=lambda url: (version_number(url) or -1, url))


def discover_zip_url(pages: Iterable[str] = LEARN_PAGES) -> str | None:
    for page in pages:
        try:
            text = http_get(page, attempts=2, timeout=30).decode("utf-8", "replace")
        except IconSyncError as exc:
            log(f"warning: could not read the icons page: {exc}")
            continue
        url = pick_zip_url(text)
        if url:
            return url
        log(f"warning: no icon ZIP link found on {page}")
    return None


def open_zip(zip_file: str | None, zip_url: str | None) -> tuple[str, zipfile.ZipFile]:
    """(source label, open ZipFile) from a local file, an explicit URL or the discovered URL."""
    if zip_file:
        path = Path(zip_file)
        if not path.is_file():
            raise IconSyncError(f"ZIP file not found: {path}")
        try:
            return f"file:{path.name}", zipfile.ZipFile(path)
        except (zipfile.BadZipFile, OSError) as exc:
            raise IconSyncError(f"cannot read {path} as a ZIP file: {exc}") from exc

    if zip_url:
        candidates = [zip_url]
    else:
        print(f"Looking up the current icon set on {LEARN_PAGES[0]}", flush=True)
        discovered = discover_zip_url()
        if not discovered:
            log(f"warning: falling back to the pinned URL {PINNED_ZIP_URL}")
        candidates = list(dict.fromkeys(url for url in (discovered, PINNED_ZIP_URL) if url))

    errors = []
    for url in candidates:
        print(f"Downloading {url}", flush=True)
        try:
            data = http_get(url)
            return url, zipfile.ZipFile(io.BytesIO(data))
        except IconSyncError as exc:
            errors.append(str(exc))
        except zipfile.BadZipFile as exc:
            errors.append(f"{url} is not a valid ZIP file ({exc})")
        log(f"warning: {errors[-1]}")
    raise IconSyncError(
        "could not download the Azure icons ZIP (" + "; ".join(errors) + "). "
        "Pass --zip-url with the link from https://learn.microsoft.com/azure/architecture/icons/ "
        "or --zip-file with a downloaded copy."
    )


# --- Output -----------------------------------------------------------------------------------


def read_index_keys(index_path: Path) -> set[str]:
    try:
        icons = json.loads(index_path.read_text(encoding="utf-8")).get("icons", {})
    except (OSError, ValueError, AttributeError):
        return set()
    return {key for key in icons if isinstance(key, str)} if isinstance(icons, dict) else set()


def write_icons(zf: zipfile.ZipFile, found: Mapping[str, str], dest: Path, source: str) -> dict:
    """Copy the matched SVGs unchanged, drop stale ones and (re)write index.json."""
    dest.mkdir(parents=True, exist_ok=True)
    index_path = dest / "index.json"
    previous = read_index_keys(index_path)

    icons: dict[str, str] = {}
    for key in ICONS:
        if key in found:
            (dest / f"{key}.svg").write_bytes(zf.read(found[key]))
            icons[key] = base_name(found[key])

    for key in (previous | set(ICONS)) - set(icons):
        stale = dest / f"{key}.svg"
        if SAFE_KEY_RE.match(key) and stale.is_file():
            stale.unlink()

    number = version_number(source)
    index = {
        "source": source,
        "version": f"V{number}" if number is not None else None,
        "syncedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "icons": icons,
    }
    tmp_path = dest / "index.json.tmp"
    tmp_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp_path, index_path)
    return index


def display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(Path.cwd().resolve()))
    except ValueError:
        return str(path)


# --- CLI --------------------------------------------------------------------------------------


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copy the official Azure Architecture Icons used by the web app (unchanged).",
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--zip-url", help="icon ZIP URL (default: discovered from the Learn icons page)")
    source.add_argument("--zip-file", help="use a local copy of the icon ZIP instead of downloading")
    parser.add_argument("--dest", default=str(DEFAULT_DEST), help="output directory (default: %(default)s)")
    parser.add_argument("--if-missing", action="store_true", help="do nothing if <dest>/index.json already lists icons")
    parser.add_argument("--list", action="store_true", help="print every SVG file name in the ZIP and exit")
    return parser.parse_args(argv)


def _has_synced_icons(index_path: Path) -> bool:
    """True when index.json exists and lists at least one icon (the repo ships an empty placeholder)."""
    try:
        data = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return bool(isinstance(data, dict) and data.get("icons"))


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    dest = Path(args.dest)
    index_path = dest / "index.json"
    if args.if_missing and not args.list and _has_synced_icons(index_path):
        print(f"{display_path(index_path)} already lists icons; skipping icon sync (--if-missing).")
        return 0

    try:
        source, zf = open_zip(args.zip_file, args.zip_url)
        with zf:
            entries = list_svg_entries(zf)
            if args.list:
                for entry in entries:
                    print(base_name(entry))
                return 0
            if not entries:
                raise IconSyncError(f"no SVG files found in {source}")
            found = match_icons(entries)
            if not found:
                raise IconSyncError(f"none of the expected icon names found in {source}; is it the Azure icons ZIP?")
            index = write_icons(zf, found, dest, source)
    except (IconSyncError, zipfile.BadZipFile, zlib.error, EOFError, KeyError, OSError) as exc:
        log(f"error: {exc}")
        return 1

    version = index["version"] or "unknown version"
    print(f"Azure Architecture Icons ({version}) from {source}: {len(entries)} SVG files")
    width = max(len(key) for key in ICONS)
    missing = [key for key in ICONS if key not in found]
    for key in ICONS:
        if key in found:
            print(f"  found    {key:<{width}}  {base_name(found[key])}")
        else:
            print(f"  MISSING  {key:<{width}}  (tried: {', '.join(ICONS[key])})")
    print(
        f"Copied {len(found)}/{len(ICONS)} icons to {display_path(dest)}"
        + (f"; missing (fallback tiles will be used): {', '.join(missing)}" if missing else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
