"""Model training and artifact trust boundaries for SmartTrack.

The feature extractor is deliberately independent of this module.  Training
consumes only the ordered, derived feature vector and never raw coordinates or
identifiers.  scikit-learn is an optional runtime dependency: importing this
module, checking an artifact, and returning an unavailable result do not need
it.

Artifacts are ordinary pickle files for compatibility with scikit-learn, but
``load_artifact`` verifies the complete byte string against an operator-supplied
SHA-256 digest *before* deserializing it.  An artifact is not production-ready
just because it loads: it must be evaluated, explicitly promoted, trusted, and
marked as real-data provenance.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field
import hashlib
import math
import pickle
import random
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from .features import FEATURE_NAMES, FEATURE_SCHEMA_VERSION, extract_features


ARTIFACT_SCHEMA_VERSION = 1
SUPPORTED_DETECTORS = ("one_class_svm", "isolation_forest")


class MLDependencyError(RuntimeError):
    """Raised when fitting requires an optional scientific dependency."""


class ArtifactError(ValueError):
    """Raised for malformed, untrusted, or incompatible model artifacts."""


@dataclass
class StandardScaler:
    """Small serializable train-only standardization transform.

    It intentionally has the same narrow fit/transform behavior needed by the
    detectors, without importing NumPy.  Constant dimensions use scale 1.0.
    """

    means: tuple[float, ...] = ()
    scales: tuple[float, ...] = ()
    fitted: bool = False

    def fit(self, rows: Sequence[Sequence[float]]) -> "StandardScaler":
        if not rows:
            raise ValueError("cannot fit scaler on an empty training set")
        width = len(FEATURE_NAMES)
        if any(len(row) != width for row in rows):
            raise ValueError("training rows do not match FEATURE_NAMES")
        means = tuple(sum(float(row[i]) for row in rows) / len(rows) for i in range(width))
        scales_list: list[float] = []
        for i, mean in enumerate(means):
            variance = sum((float(row[i]) - mean) ** 2 for row in rows) / len(rows)
            scale = math.sqrt(variance)
            scales_list.append(scale if math.isfinite(scale) and scale > 0.0 else 1.0)
        self.means, self.scales, self.fitted = means, tuple(scales_list), True
        return self

    def transform(self, rows: Sequence[Sequence[float]]) -> list[list[float]]:
        if not self.fitted or len(self.means) != len(FEATURE_NAMES) or len(self.scales) != len(FEATURE_NAMES):
            raise ArtifactError("scaler is not fitted")
        output: list[list[float]] = []
        for row in rows:
            if len(row) != len(FEATURE_NAMES):
                raise ValueError("row does not match FEATURE_NAMES")
            transformed = [(float(value) - self.means[i]) / self.scales[i] for i, value in enumerate(row)]
            if not all(math.isfinite(value) for value in transformed):
                raise ValueError("non-finite value after scaling")
            output.append(transformed)
        return output


@dataclass
class ModelArtifact:
    """Serializable detector bundle and its evaluation provenance."""

    detectors: dict[str, Any]
    scaler: StandardScaler
    calibration: dict[str, tuple[float, ...]]
    feature_names: tuple[str, ...] = FEATURE_NAMES
    feature_schema_version: int = FEATURE_SCHEMA_VERSION
    artifact_schema_version: int = ARTIFACT_SCHEMA_VERSION
    provenance: str = "unknown"
    evaluated: bool = False
    promoted: bool = False
    evaluation: dict[str, Any] = field(default_factory=dict)
    trusted: bool = False

    def to_metadata(self) -> dict[str, Any]:
        """Return non-sensitive provenance suitable for an API response."""
        return {
            "artifact_schema_version": self.artifact_schema_version,
            "feature_schema_version": self.feature_schema_version,
            "feature_names": list(self.feature_names),
            "detectors": sorted(self.detectors),
            "provenance": self.provenance,
            "evaluated": self.evaluated,
            "promoted": self.promoted,
            "trusted": self.trusted,
            "evaluation": dict(self.evaluation),
        }


def _mapping_value(artifact: ModelArtifact | Mapping[str, Any], name: str, default: Any = None) -> Any:
    if isinstance(artifact, Mapping):
        return artifact.get(name, default)
    return getattr(artifact, name, default)


def validate_artifact(artifact: Any, *, production: bool = False) -> tuple[bool, str]:
    """Validate schema and, for production, every approval gate.

    Boolean fields are checked by type, so strings such as ``"false"`` cannot
    pass through a truthiness check.  ``production=False`` is useful for offline
    evaluation tools; it still validates the artifact structure.
    """
    if not isinstance(artifact, (ModelArtifact, Mapping)):
        return False, "artifact_invalid"
    schema = _mapping_value(artifact, "artifact_schema_version")
    if type(schema) is not int or schema != ARTIFACT_SCHEMA_VERSION:
        return False, "artifact_schema_unsupported"
    names = _mapping_value(artifact, "feature_names")
    if tuple(names or ()) != FEATURE_NAMES:
        return False, "feature_schema_mismatch"
    if _mapping_value(artifact, "feature_schema_version") != FEATURE_SCHEMA_VERSION:
        return False, "feature_schema_mismatch"
    scaler = _mapping_value(artifact, "scaler")
    if not isinstance(scaler, StandardScaler) or not scaler.fitted:
        return False, "scaler_invalid"
    detectors = _mapping_value(artifact, "detectors")
    calibration = _mapping_value(artifact, "calibration")
    if not isinstance(detectors, Mapping) or not detectors:
        return False, "detectors_missing"
    if not isinstance(calibration, Mapping):
        return False, "calibration_missing"
    for name in detectors:
        if name not in SUPPORTED_DETECTORS:
            return False, "detector_unsupported"
        refs = calibration.get(name)
        if not isinstance(refs, (tuple, list)) or not refs or not all(isinstance(x, (int, float)) and math.isfinite(float(x)) for x in refs):
            return False, "calibration_invalid"
    if not production:
        return True, "ok"
    if _mapping_value(artifact, "trusted") is not True:
        return False, "artifact_untrusted"
    if _mapping_value(artifact, "provenance") != "real":
        return False, "synthetic_or_unknown_provenance"
    if _mapping_value(artifact, "evaluated") is not True:
        return False, "artifact_unevaluated"
    if _mapping_value(artifact, "promoted") is not True:
        return False, "artifact_unpromoted"
    evaluation = _mapping_value(artifact, "evaluation")
    if not isinstance(evaluation, Mapping) or type(evaluation.get("held_out_count")) is not int or evaluation["held_out_count"] < 1:
        return False, "evaluation_evidence_missing"
    return True, "ok"


def _verified_pickle(data: bytes, expected_sha256: str) -> Any:
    digest = hashlib.sha256(data).hexdigest()
    if not isinstance(expected_sha256, str) or len(expected_sha256) != 64:
        raise ArtifactError("a 64-character operator SHA-256 digest is required")
    try:
        expected = bytes.fromhex(expected_sha256)
    except ValueError as exc:
        raise ArtifactError("artifact digest is not hexadecimal") from exc
    if not __import__("hmac").compare_digest(bytes.fromhex(digest), expected):
        raise ArtifactError("artifact digest mismatch")
    # Deserialize exactly the bytes whose digest was checked.  No path is
    # reopened after verification, preventing a verify-then-swap race.
    return pickle.loads(data)


def load_artifact(path: str | Path, *, expected_sha256: str | None, trusted: bool = False) -> ModelArtifact:
    """Load a pinned artifact, refusing all implicit or artifact-supplied trust."""
    if trusted is not True:
        raise ArtifactError("explicit trusted=True is required to load a production artifact")
    if not isinstance(expected_sha256, str):
        raise ArtifactError("operator artifact digest is required")
    data = Path(path).read_bytes()
    artifact = _verified_pickle(data, expected_sha256)
    if not isinstance(artifact, ModelArtifact):
        raise ArtifactError("artifact has an unsupported type")
    artifact.trusted = True
    valid, reason = validate_artifact(artifact)
    if not valid:
        raise ArtifactError(reason)
    return artifact


def save_artifact(artifact: ModelArtifact, path: str | Path) -> str:
    """Save an artifact and return its digest; saving never promotes it."""
    valid, reason = validate_artifact(artifact)
    if not valid:
        raise ArtifactError(reason)
    data = pickle.dumps(artifact, protocol=pickle.HIGHEST_PROTOCOL)
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def promote_artifact(artifact: ModelArtifact) -> ModelArtifact:
    """Explicitly promote evaluated real-data artifacts only."""
    valid, reason = validate_artifact(artifact)
    if not valid:
        raise ArtifactError(reason)
    if artifact.provenance == "synthetic":
        raise ArtifactError("synthetic artifacts can never be promoted for production")
    if artifact.provenance != "real" or artifact.evaluated is not True:
        raise ArtifactError("only evaluated real-data artifacts can be promoted")
    artifact.promoted = True
    return artifact


def _require_sklearn() -> tuple[Any, Any, Any]:
    try:
        from sklearn.ensemble import IsolationForest
        from sklearn.svm import OneClassSVM
    except ImportError as exc:
        raise MLDependencyError("training requires scikit-learn; ML remains unavailable without it") from exc
    return OneClassSVM, IsolationForest, None


def _identity(record: Mapping[str, Any]) -> tuple[str, str]:
    device, rec = record.get("device_id"), record.get("record_id")
    if not isinstance(device, str) or not device.strip() or not isinstance(rec, str) or not rec.strip():
        raise ValueError("each training record needs a non-empty device_id and record_id")
    return device, rec


def _examples(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in rows:
        if not isinstance(item, Mapping):
            raise ValueError("training examples must be mappings")
        record = item.get("record", item.get("current", item))
        previous = item.get("previous")
        group = item.get("group_id", item.get("group"))
        if not isinstance(record, Mapping):
            raise ValueError("training example record is invalid")
        if not isinstance(group, str) or not group.strip():
            raise ValueError("every training example needs a non-empty group_id")
        ident = _identity(record)
        if ident in seen:
            raise ValueError("duplicate record identity in training data")
        seen.add(ident)
        extracted = extract_features(record, previous)
        if not extracted["available"]:
            raise ValueError("training data contains unavailable features: " + ",".join(extracted["reasons"]))
        vector = [extracted["features"][name] for name in FEATURE_NAMES]
        result.append({"vector": vector, "group_id": group, "identity": ident, "quality": extracted["quality"]})
    return result


def split_grouped_examples(rows: Sequence[Mapping[str, Any]], *, calibration_fraction: float = 0.25, random_state: int = 0) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Make a deterministic group-disjoint train/calibration split."""
    if not 0.0 < calibration_fraction < 1.0:
        raise ValueError("calibration_fraction must be between zero and one")
    examples = _examples(rows)
    groups = sorted({row["group_id"] for row in examples})
    if len(groups) < 2:
        raise ValueError("at least two groups are required for held-out calibration")
    shuffled = list(groups)
    random.Random(random_state).shuffle(shuffled)
    count = max(1, min(len(groups) - 1, round(len(groups) * calibration_fraction)))
    calibration_groups = set(shuffled[:count])
    train = [row for row in examples if row["group_id"] not in calibration_groups]
    calibration = [row for row in examples if row["group_id"] in calibration_groups]
    if not train or not calibration:
        raise ValueError("split must have non-empty train and calibration partitions")
    return train, calibration


def train_models(rows: Sequence[Mapping[str, Any]], *, provenance: str, calibration_fraction: float = 0.25, random_state: int = 0, contamination: str | float = "auto") -> ModelArtifact:
    """Fit One-Class SVM and Isolation Forest using train-only preprocessing.

    ``rows`` must contain ``record``, ``previous`` and a stable ``group_id``.
    The held-out partition is used only to create empirical calibration
    references and evaluation evidence; no fitting happens on it.
    """
    if provenance not in ("real", "synthetic"):
        raise ValueError("provenance must be explicitly 'real' or 'synthetic'")
    train, held_out = split_grouped_examples(rows, calibration_fraction=calibration_fraction, random_state=random_state)
    OneClassSVM, IsolationForest, _ = _require_sklearn()
    scaler = StandardScaler().fit([row["vector"] for row in train])
    train_matrix = scaler.transform([row["vector"] for row in train])
    held_matrix = scaler.transform([row["vector"] for row in held_out])
    detectors: dict[str, Any] = {
        "one_class_svm": OneClassSVM(gamma="scale", nu=0.05).fit(train_matrix),
        "isolation_forest": IsolationForest(contamination=contamination, random_state=random_state, n_estimators=100).fit(train_matrix),
    }
    calibration: dict[str, tuple[float, ...]] = {}
    for name, detector in detectors.items():
        values = detector.decision_function(held_matrix)
        calibration[name] = tuple(float(value) for value in values if math.isfinite(float(value)))
    if any(not values for values in calibration.values()):
        raise ValueError("held-out calibration produced no finite detector values")
    artifact = ModelArtifact(
        detectors=detectors,
        scaler=scaler,
        calibration=calibration,
        provenance=provenance,
        evaluated=True,
        promoted=False,
        evaluation={
            "held_out_count": len(held_out),
            "train_count": len(train),
            "train_groups": len({row["group_id"] for row in train}),
            "held_out_groups": len({row["group_id"] for row in held_out}),
            "calibration_source": "held_out_only",
            "detectors": list(SUPPORTED_DETECTORS),
        },
    )
    valid, reason = validate_artifact(artifact)
    if not valid:
        raise ArtifactError(reason)
    return artifact


def detector_percentile(raw: float, references: Sequence[float]) -> float | None:
    """Map a higher-is-more-normal detector value to [0, 1] empirically."""
    if not math.isfinite(float(raw)):
        return None
    values = sorted(float(value) for value in references if math.isfinite(float(value)))
    if not values:
        return None
    if len(values) == 1:
        return 0.5
    return max(0.0, min(1.0, (bisect_right(values, float(raw)) - 1) / (len(values) - 1)))


__all__ = [
    "ARTIFACT_SCHEMA_VERSION", "SUPPORTED_DETECTORS", "ArtifactError", "MLDependencyError",
    "ModelArtifact", "StandardScaler", "detector_percentile", "load_artifact", "promote_artifact",
    "save_artifact", "split_grouped_examples", "train_models", "validate_artifact",
]
