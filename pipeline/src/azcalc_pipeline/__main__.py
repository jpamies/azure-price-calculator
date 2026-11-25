"""Allow `python -m azcalc_pipeline ...` (e.g. `PYTHONPATH=pipeline/src python3 -m azcalc_pipeline build ...`)."""

from .cli import main

raise SystemExit(main())
