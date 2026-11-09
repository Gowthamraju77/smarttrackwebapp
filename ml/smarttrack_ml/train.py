"""Command-line training entry point.

Example (with a real, operator-owned dataset):
``python -m smarttrack_ml.train --input examples.json --output model.pkl --provenance real``

The command never promotes an artifact.  Promotion is a separate explicit
operation after a human review of held-out evidence.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .model import save_artifact, train_models


def _load_examples(path: str | Path) -> list[dict[str, Any]]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(value, dict):
        if value.get("synthetic") is True:
            # This branch is intentionally explicit: synthetic data can be
            # useful for algorithm checks but never makes a production model.
            value = value.get("examples", [])
        else:
            value = value.get("examples", value.get("records"))
    if not isinstance(value, list):
        raise ValueError("input JSON must contain an examples list")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Train and calibrate SmartTrack anomaly detectors")
    parser.add_argument("--input", required=True, help="JSON list of grouped current/previous examples")
    parser.add_argument("--output", required=True, help="destination pickle artifact")
    parser.add_argument("--provenance", required=True, choices=("real", "synthetic"))
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--calibration-fraction", type=float, default=0.25)
    args = parser.parse_args(argv)
    examples = _load_examples(args.input)
    artifact = train_models(
        examples,
        provenance=args.provenance,
        random_state=args.seed,
        calibration_fraction=args.calibration_fraction,
    )
    digest = save_artifact(artifact, args.output)
    print(json.dumps({"artifact": str(args.output), "sha256": digest, "metadata": artifact.to_metadata()}, sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised as a CLI
    raise SystemExit(main())
