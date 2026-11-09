"""SmartTrack ML feature contract; importing it requires no ML dependencies."""

from .features import FEATURE_NAMES, FEATURE_SCHEMA_VERSION, extract_features

__all__ = ["FEATURE_NAMES", "FEATURE_SCHEMA_VERSION", "extract_features"]
