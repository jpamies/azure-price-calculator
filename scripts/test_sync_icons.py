"""Offline tests for sync_icons.py (stdlib unittest, fake in-memory ZIPs, no network).

Run from the repository root:  python3 -m unittest scripts/test_sync_icons.py
"""

from __future__ import annotations

import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sync_icons as si  # noqa: E402

ROOT = "Azure_Public_Service_Icons/Icons"


def fake_svg(label: str) -> bytes:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><title>{label}</title></svg>\n'.encode()


FAKE_ICONS = {
    f"{ROOT}/compute/10021-icon-service-Virtual-Machine.svg": fake_svg("vm"),
    f"{ROOT}/compute/10028-icon-service-Virtual-Machines- (Classic).svg": fake_svg("vm-classic"),
    f"{ROOT}/compute/10026-icon-service-Disks-Snapshots.svg": fake_svg("snapshots"),
    f"{ROOT}/compute/10032-icon-service-Disks.svg": fake_svg("disks"),
    f"{ROOT}/compute/77777-icon-service-app-services.svg": fake_svg("app-service"),
    f"{ROOT}/storage/00017-icon-service-Recovery-Services-Vaults.svg": fake_svg("rsv"),
    f"{ROOT}/storage/10086-icon-service-Storage-Accounts.svg": fake_svg("storage"),
    f"{ROOT}/databases/10132-icon-service-SQL-Server.svg": fake_svg("sql-server"),
    f"{ROOT}/databases/10351-icon-service-SQL-Server-Registries.svg": fake_svg("sql-registries"),
    f"{ROOT}/databases/10124-icon-service-Azure-SQL-VM.svg": fake_svg("sql-vm"),
    f"{ROOT}/other/02361-icon-service-Backup-Vault.svg": fake_svg("backup-vault"),
    f"{ROOT}/new icons/030777508 -icon-service-Azure-Managed-Redis.svg": fake_svg("redis"),
    "flattened/Virtual-Networks.svg": fake_svg("vnet"),
    f"{ROOT}/compute/10021-icon-service-Virtual-Machine.png": b"not an svg",
    f"__MACOSX/{ROOT}/compute/._10032-icon-service-Disks.svg": b"resource fork",
    f"{ROOT}/compute/": b"",
}


def make_zip(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        for name, data in files.items():
            if name.endswith("/"):
                zf.writestr(zipfile.ZipInfo(name), b"")
            else:
                zf.writestr(name, data)
    return buffer.getvalue()


def run_main(*argv: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = si.main(list(argv))
    return code, out.getvalue(), err.getvalue()


class PatternTests(unittest.TestCase):
    def test_numbered_renumbered_and_unprefixed_names_match(self) -> None:
        regex = si.pattern_regex("Virtual-Machine")
        for name in (
            "10021-icon-service-Virtual-Machine.svg",
            "99999-icon-service-virtual-machine.SVG",
            "icon-service-Virtual-Machine.svg",
            "Virtual-Machine.svg",
            "Virtual Machine.svg",
        ):
            self.assertTrue(regex.match(name), name)

    def test_whole_name_must_match(self) -> None:
        regex = si.pattern_regex("Disks")
        self.assertTrue(regex.match("10032-icon-service-Disks.svg"))
        for name in (
            "10026-icon-service-Disks-Snapshots.svg",
            "10041-icon-service-Disks- (Classic).svg",
            "10032-icon-service-Disks.png",
            "10032-icon-service-Managed-Disks-Disks.svg",
        ):
            self.assertIsNone(regex.match(name), name)

    def test_odd_spacing_in_official_names(self) -> None:
        self.assertTrue(si.pattern_regex("Service-Group-Relationships").match(
            "030777508 -icon-service-Service-Group-Relationships.svg"))
        self.assertTrue(si.pattern_regex("Arc-PostgreSQL").match("01848-icon-service-Arc-PostgreSQL .svg"))
        self.assertTrue(si.pattern_regex("Cloud-Services-(Classic)").match(
            "10030-icon-service-Cloud-Services- (Classic).svg"))

    def test_icon_table_is_well_formed(self) -> None:
        for key, patterns in si.ICONS.items():
            self.assertRegex(key, si.SAFE_KEY_RE)
            self.assertTrue(patterns, key)
            for pattern in patterns:
                si.pattern_regex(pattern)


class MatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.zf = zipfile.ZipFile(io.BytesIO(make_zip(FAKE_ICONS)))
        self.entries = si.list_svg_entries(self.zf)

    def tearDown(self) -> None:
        self.zf.close()

    def test_only_svg_members_are_listed(self) -> None:
        self.assertEqual(len(self.entries), 13)
        self.assertFalse(any("__MACOSX" in entry or entry.endswith(".png") for entry in self.entries))

    def test_matches(self) -> None:
        found = {key: si.base_name(entry) for key, entry in si.match_icons(self.entries).items()}
        self.assertEqual(found["virtual-machines"], "10021-icon-service-Virtual-Machine.svg")
        self.assertEqual(found["managed-disks"], "10032-icon-service-Disks.svg")
        self.assertEqual(found["app-service"], "77777-icon-service-app-services.svg")
        self.assertEqual(found["site-recovery"], "00017-icon-service-Recovery-Services-Vaults.svg")
        self.assertEqual(found["redis"], "030777508 -icon-service-Azure-Managed-Redis.svg")
        self.assertEqual(found["virtual-network"], "Virtual-Networks.svg")
        self.assertEqual(found["storage-accounts"], "10086-icon-service-Storage-Accounts.svg")
        self.assertNotIn("key-vault", found)

    def test_first_matching_pattern_wins(self) -> None:
        found = si.match_icons(self.entries)
        self.assertEqual(si.base_name(found["sql-server"]), "10124-icon-service-Azure-SQL-VM.svg")
        self.assertEqual(si.base_name(found["backup"]), "02361-icon-service-Backup-Vault.svg")

        table = {"sql-server": ["SQL-Server"], "backup": ["Recovery-Services-Vaults", "Backup-Vault"]}
        found = si.match_icons(self.entries, table)
        self.assertEqual(si.base_name(found["sql-server"]), "10132-icon-service-SQL-Server.svg")
        self.assertEqual(si.base_name(found["backup"]), "00017-icon-service-Recovery-Services-Vaults.svg")


class DiscoveryTests(unittest.TestCase):
    def test_picks_highest_version(self) -> None:
        html = (
            '<a href="https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V9.zip">old</a>'
            '<a class="button" href="https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V23.zip">'
            "Download SVG icons</a> //arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V21.zip"
        )
        self.assertEqual(
            si.pick_zip_url(html),
            "https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V23.zip",
        )

    def test_protocol_relative_link(self) -> None:
        self.assertEqual(
            si.pick_zip_url('href="//arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V30.zip"'),
            "https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V30.zip",
        )

    def test_no_link(self) -> None:
        self.assertIsNone(si.pick_zip_url("<html>no icons here</html>"))

    def test_version_number(self) -> None:
        self.assertEqual(si.version_number(si.PINNED_ZIP_URL), 21)
        self.assertEqual(si.version_number("file:Azure_Public_Service_Icons_V23.zip"), 23)
        self.assertIsNone(si.version_number("file:icons.zip"))


class SyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.zip_path = self.dir / "Azure_Public_Service_Icons_V99.zip"
        self.zip_path.write_bytes(make_zip(FAKE_ICONS))
        self.dest = self.dir / "out" / "azure"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def sync(self, *extra: str) -> tuple[int, str, str]:
        return run_main("--zip-file", str(self.zip_path), "--dest", str(self.dest), *extra)

    def test_copies_unchanged_and_writes_index(self) -> None:
        code, out, _ = self.sync()
        self.assertEqual(code, 0)
        index = json.loads((self.dest / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(index["source"], "file:Azure_Public_Service_Icons_V99.zip")
        self.assertEqual(index["version"], "V99")
        self.assertRegex(index["syncedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertEqual(index["icons"]["virtual-machines"], "10021-icon-service-Virtual-Machine.svg")
        self.assertEqual(
            (self.dest / "virtual-machines.svg").read_bytes(),
            FAKE_ICONS[f"{ROOT}/compute/10021-icon-service-Virtual-Machine.svg"],
        )
        svgs = {path.stem for path in self.dest.glob("*.svg")}
        self.assertEqual(svgs, set(index["icons"]))
        self.assertIn("found    virtual-machines", out)
        self.assertIn("MISSING  key-vault", out)
        self.assertFalse((self.dest / "index.json.tmp").exists())

    def test_if_missing_skips_existing_index(self) -> None:
        self.assertEqual(self.sync()[0], 0)
        before = (self.dest / "index.json").read_bytes()
        (self.dest / "virtual-machines.svg").unlink()
        code, out, _ = self.sync("--if-missing")
        self.assertEqual(code, 0)
        self.assertIn("skipping", out)
        self.assertEqual((self.dest / "index.json").read_bytes(), before)
        self.assertFalse((self.dest / "virtual-machines.svg").exists())

    def test_if_missing_runs_when_placeholder_index_is_empty(self) -> None:
        self.dest.mkdir(parents=True, exist_ok=True)
        (self.dest / "index.json").write_text('{"source": null, "version": null, "syncedAt": null, "icons": {}}\n')
        code, out, _ = self.sync("--if-missing")
        self.assertEqual(code, 0)
        self.assertNotIn("skipping", out)
        self.assertTrue((self.dest / "virtual-machines.svg").exists())

    def test_stale_icons_are_removed(self) -> None:
        self.assertEqual(self.sync()[0], 0)
        self.zip_path.write_bytes(make_zip({
            name: data for name, data in FAKE_ICONS.items() if "Virtual-Machine.svg" not in name
        }))
        self.assertEqual(self.sync()[0], 0)
        index = json.loads((self.dest / "index.json").read_text(encoding="utf-8"))
        self.assertNotIn("virtual-machines", index["icons"])
        self.assertFalse((self.dest / "virtual-machines.svg").exists())
        self.assertTrue((self.dest / "managed-disks.svg").exists())

    def test_list(self) -> None:
        code, out, _ = self.sync("--list")
        self.assertEqual(code, 0)
        self.assertIn("10032-icon-service-Disks.svg", out.splitlines())
        self.assertFalse(self.dest.exists())

    def test_missing_zip_file_fails_cleanly(self) -> None:
        code, out, err = run_main("--zip-file", str(self.dir / "nonexistent.zip"), "--dest", str(self.dest))
        self.assertEqual(code, 1)
        self.assertIn("ZIP file not found", err)
        self.assertFalse(self.dest.exists())

    def test_invalid_zip_fails_cleanly(self) -> None:
        self.zip_path.write_bytes(b"<html>not a zip</html>")
        code, _, err = self.sync()
        self.assertEqual(code, 1)
        self.assertIn("error:", err)
        self.assertFalse(self.dest.exists())

    def test_unrelated_zip_keeps_existing_icons(self) -> None:
        self.assertEqual(self.sync()[0], 0)
        before = (self.dest / "index.json").read_bytes()
        self.zip_path.write_bytes(make_zip({"icons/Teams.svg": fake_svg("teams")}))
        code, _, err = self.sync()
        self.assertEqual(code, 1)
        self.assertIn("none of the expected icon names", err)
        self.assertEqual((self.dest / "index.json").read_bytes(), before)
        self.assertTrue((self.dest / "virtual-machines.svg").exists())


class FrontendKeysTests(unittest.TestCase):
    def test_icon_keys_match_icon_map_ts(self) -> None:
        icon_map = si.REPO_ROOT / "web" / "src" / "catalog" / "icon-map.ts"
        if not icon_map.is_file():
            self.skipTest(f"{icon_map} not found")
        block = re.search(r"export const ICON_KEYS = \[(.*?)\] as const;", icon_map.read_text(encoding="utf-8"), re.S)
        self.assertIsNotNone(block, "ICON_KEYS not found in icon-map.ts")
        ts_keys = re.findall(r'"([a-z0-9-]+)"', block.group(1))
        self.assertEqual(len(ts_keys), len(set(ts_keys)), "duplicate keys in ICON_KEYS")
        self.assertEqual(ts_keys, list(si.ICONS))


if __name__ == "__main__":
    unittest.main()
