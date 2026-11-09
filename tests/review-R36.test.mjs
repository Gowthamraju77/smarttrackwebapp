import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// STATIC input gates only. They do not validate pin values, preprocessor
// branches, electrical characteristics, or a board. A later prerequisite pass
// still requires the actual source/PDF comparison described in R36.md.
test('R36 STATIC prerequisite: firmware GPIO configuration and callers exist', () => {
  const required = [
    'firmware/platformio.ini',
    'firmware/include/config.h',
    'firmware/src/main.cpp',
  ];
  const missing = required.filter((file) => !existsSync(path.join(root, file)));
  assert.deepEqual(missing, [],
    `BLOCKED: missing ${missing.join(', ')}. Exact GPIO values, SD disablement, ` +
    'and modem reservation/default-off behavior cannot be reviewed.');
  for (const file of required) {
    assert.ok(readFileSync(path.join(root, file), 'utf8').trim(), `${file} is empty`);
  }
});

function projectPdfCandidates(directory) {
  const excluded = new Set(['node_modules', '.next', '.git', '.pio', '.venv', 'venv']);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory() && !excluded.has(entry.name)) {
      return projectPdfCandidates(filename);
    }
    return entry.isFile() && /\.pdf$/i.test(entry.name) ? [filename] : [];
  });
}

test('R36 STATIC prerequisite: a project PDF candidate exists for identification', () => {
  const candidates = projectPdfCandidates(root);
  assert.ok(candidates.length > 0,
    'BLOCKED: no project PDF found. docs/CONTRACT.md:21 is a secondary contract, ' +
    'not an independently verified original PDF. Direct PDF comparison is unavailable.');
});
