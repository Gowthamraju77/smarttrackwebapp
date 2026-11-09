"""Explainable reliability-index scoring with explicit unavailable states.

Scores are bounded reliability indices, never safety probabilities.  A missing
factor is omitted and the remaining configured weights are re-normalized.  A
real zero is retained as an available value.  Production model scoring is
gated by :func:`model.validate_artifact`; there is no fallback or fabricated
model score when an artifact is absent, synthetic, or unpromoted.
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

from .features import FEATURE_NAMES
from .model import ModelArtifact, detector_percentile, validate_artifact


FACTOR_WEIGHTS: dict[str, float] = {
    "model": 30.0,
    "gps": 30.0,
    "imu": 20.0,
    "chronology": 15.0,
    "delivery": 5.0,
}


def unavailable(reason: str, *, reasons: Sequence[str] = ()) -> dict[str, Any]:
    """Construct a JSON-safe unavailable result with no numeric score key."""
    return {"available": False, "reliability_index": None, "reasons": [reason, *reasons]}


def aggregate_factors(factors: Mapping[str, Any], *, weights: Mapping[str, float] = FACTOR_WEIGHTS) -> dict[str, Any]:
    """Aggregate finite [0, 1] factors using proportional available weights.

    ``None`` and omitted values mean unavailable; ``0.0`` is a valid factor.
    Invalid values are reported and excluded rather than coerced.
    """
    usable: dict[str, float] = {}
    invalid: list[str] = []
    missing: list[str] = []
    for name, weight in weights.items():
        value = factors.get(name)
        if value is None:
            missing.append(name)
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)) or not 0.0 <= float(value) <= 1.0:
            invalid.append(name)
            continue
        if not isinstance(weight, (int, float)) or not math.isfinite(float(weight)) or float(weight) <= 0:
            invalid.append(name + "_weight")
            continue
        usable[name] = float(value)
    denominator = sum(float(weights[name]) for name in usable)
    if not usable or denominator <= 0:
        return {
            "available": False,
            "reliability_index": None,
            "factors": usable,
            "missing_factors": missing,
            "invalid_factors": invalid,
            "effective_weight": 0.0,
            "reasons": ["no_reliability_factors"] + (["invalid_factor"] if invalid else []),
        }
    value = sum(float(weights[name]) * score for name, score in usable.items()) / denominator
    return {
        "available": True,
        "reliability_index": max(0.0, min(1.0, value)),
        "factors": usable,
        "missing_factors": missing,
        "invalid_factors": invalid,
        "effective_weight": denominator / sum(float(value) for value in weights.values()),
        "reasons": (["invalid_factor"] if invalid else []),
    }


def aggregate_reliability(factors: Mapping[str, Any], *, weights: Mapping[str, float] = FACTOR_WEIGHTS) -> dict[str, Any]:
    """Named alias kept as the primary public aggregation API."""
    return aggregate_factors(factors, weights=weights)


def _quality_factor(quality: Mapping[str, Any], names: Sequence[str]) -> float | None:
    values: list[float] = []
    for name in names:
        value = quality.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            return None
        values.append(max(0.0, min(1.0, float(value))))
    return sum(values) / len(values) if values else None


def model_reliability(vector: Sequence[float], artifact: ModelArtifact, *, production: bool = True) -> tuple[float | None, list[str]]:
    """Score a feature vector through every detector and empirically calibrate it."""
    valid, reason = validate_artifact(artifact, production=production)
    if not valid:
        return None, [reason]
    if len(vector) != len(FEATURE_NAMES) or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(float(x)) for x in vector):
        return None, ["feature_vector_invalid"]
    transformed = artifact.scaler.transform([vector])[0]
    calibrated: list[float] = []
    reasons: list[str] = []
    for detector_name, detector in artifact.detectors.items():
        try:
            raw = float(detector.decision_function([transformed])[0])
        except (AttributeError, IndexError, TypeError, ValueError):
            reasons.append(detector_name + "_inference_failed")
            continue
        percentile = detector_percentile(raw, artifact.calibration.get(detector_name, ()))
        if percentile is None:
            reasons.append(detector_name + "_calibration_unavailable")
        else:
            calibrated.append(percentile)
    if not calibrated:
        return None, reasons or ["model_score_unavailable"]
    return sum(calibrated) / len(calibrated), reasons


def score_features(extracted: Mapping[str, Any], artifact: ModelArtifact | None, *, production: bool = True) -> dict[str, Any]:
    """Score an extractor result while preserving evidence and missing factors."""
    if not isinstance(extracted, Mapping) or extracted.get("available") is not True:
        reasons = extracted.get("reasons", ["features_unavailable"]) if isinstance(extracted, Mapping) else ["features_unavailable"]
        return unavailable("features_unavailable", reasons=reasons)
    if artifact is None:
        return unavailable("ml_unavailable", reasons=["artifact_missing"])
    features = extracted.get("features")
    quality = extracted.get("quality")
    if not isinstance(features, Mapping) or not isinstance(quality, Mapping):
        return unavailable("features_contract_invalid")
    if set(features) != set(FEATURE_NAMES):
        return unavailable("feature_schema_mismatch")
    vector = [features[name] for name in FEATURE_NAMES]
    model_score, model_reasons = model_reliability(vector, artifact, production=production)
    if model_score is None:
        return unavailable("ml_unavailable", reasons=model_reasons)
    factors = {
        "model": model_score,
        "gps": _quality_factor(quality, ("gps_fix", "gps_freshness", "gps_precision")),
        "imu": quality.get("imu"),
        "chronology": quality.get("chronology"),
        "delivery": quality.get("delivery"),
    }
    aggregate = aggregate_factors(factors)
    if not aggregate["available"]:
        return unavailable("reliability_unavailable", reasons=aggregate["reasons"])
    return {
        **aggregate,
        "score_kind": "reliability_index",
        "score_scale": "0_to_1",
        "safety_probability": None,
        "explanation": {
            "model": "empirical held-out detector percentile",
            "gps": "mean of fix, freshness, and precision heuristics",
            "imu": "feature extractor IMU availability heuristic",
            "chronology": "capture ordering heuristic",
            "delivery": "receipt-delay heuristic",
        },
        "model_reasons": model_reasons,
    }


def score_telemetry(record: Mapping[str, Any], previous: Mapping[str, Any] | None, artifact: ModelArtifact | None, *, production: bool = True) -> dict[str, Any]:
    """Extract and score current/previous telemetry in one explicit boundary."""
    from .features import extract_features

    extracted = extract_features(record, previous)
    result = score_features(extracted, artifact, production=production)
    result["feature_reasons"] = list(extracted.get("reasons", []))
    result["quality"] = dict(extracted.get("quality", {}))
    return result


__all__ = [
    "FACTOR_WEIGHTS", "aggregate_factors", "aggregate_reliability", "model_reliability",
    "score_features", "score_telemetry", "unavailable",
]
