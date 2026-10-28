"""Runs every tests/test_*.py script in-process; non-zero exit on the first failure."""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

failed = 0
for script in sorted((ROOT / "tests").glob("test_*.py")):
    print(f"=== {script.name}", flush=True)
    try:
        runpy.run_path(str(script), run_name="__main__")
    except SystemExit as exc:
        if exc.code not in (0, None):
            failed += 1
            print(f"FAILED {script.name}: exit {exc.code}", flush=True)
    except Exception as exc:  # noqa: BLE001
        failed += 1
        print(f"FAILED {script.name}: {type(exc).__name__}: {exc}", flush=True)
print("ALL PASSED" if not failed else f"{failed} FAILED", flush=True)
raise SystemExit(1 if failed else 0)
