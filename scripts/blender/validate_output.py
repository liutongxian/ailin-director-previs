from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    output = Path(args.output)
    missing = [name for name in plan["outputs"].values() if not (output / name).is_file()]
    if missing:
        raise SystemExit(f"Missing Blender outputs: {', '.join(missing)}")
    state = json.loads((output / plan["outputs"]["state"]).read_text(encoding="utf-8"))
    if state.get("spec") != "ailin-blender-state" or state.get("shot", {}).get("id") != plan["shot"]["id"]:
        raise SystemExit("Blender state does not match the requested shot")
    print("AILIN_BLENDER_VALIDATION=PASS")


if __name__ == "__main__":
    main()
