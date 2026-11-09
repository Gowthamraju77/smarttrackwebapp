import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';

// This is a prerequisite gate, not a synthetic-generator behavior test.
// Replace/extend it with executable generator checks once the implementation
// and its public interface are available. A passing gate is not validation.
test('R35 prerequisite: the contracted ML package exists for generator review', () => {
  const packageUrl = new URL('../ml/smarttrack_ml/', import.meta.url);
  let entries;
  try {
    entries = readdirSync(packageUrl, { withFileTypes: true });
  } catch (error) {
    assert.fail(
      `BLOCKED: ml/smarttrack_ml is unavailable (${error.code}). ` +
      'Synthetic-generator reproducibility, edge cases, provenance, and ' +
      'production-validation safeguards have not been exercised.',
    );
  }
  assert.ok(
    entries.some((entry) => entry.isFile() && entry.name.endsWith('.py')),
    'BLOCKED: ml/smarttrack_ml contains no Python implementation to review.',
  );
});
