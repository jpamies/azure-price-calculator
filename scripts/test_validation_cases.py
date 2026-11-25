import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("validation_cases.py")


class ValidationCasesTests(unittest.TestCase):
    def test_missing_snapshot_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(SCRIPT), directory], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cannot read snapshot", result.stderr)

    def test_missing_reference_prices_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / "manifest.json").write_text(json.dumps({
                "paths": {"services": "services.json", "prices": "prices"},
                "shards": {},
            }), encoding="utf-8")
            (base / "services.json").write_text("[]", encoding="utf-8")
            result = subprocess.run([sys.executable, str(SCRIPT), directory], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("reference prices are missing", result.stderr)


if __name__ == "__main__":
    unittest.main()
