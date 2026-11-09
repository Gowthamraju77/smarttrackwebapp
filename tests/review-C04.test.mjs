import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Source-level interface checks only: these do not compile or execute firmware.
// Missing integration dependencies fail explicitly, rather than passing a stub.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const firmware = join(root, 'firmware');
function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}
const sources = filesUnder(firmware).filter((path) => /\.(?:h|hpp|cpp|cc)$/.test(path));
const text = new Map(sources.map((path) => [path, readFileSync(path, 'utf8')]));
const name = (path) => relative(root, path).replaceAll('\\', '/');
const pages = sources.filter((path) => /[\\/]ui[\\/]page_[^\\/]+\.h$/.test(path));
const typePath = join(firmware, 'include', 'ui', 'types.h');
const types = text.get(typePath) ?? '';
// Preserve offsets while masking comments and literal contents for member scans.
const code = (source) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
  (value) => value.replace(/[^\r\n]/g, ' '));
const missing = (paths) => paths.filter((path) => !existsSync(join(root, path)));
const requirePaths = (paths) => assert.deepEqual(missing(paths), [], 'BLOCKED: required implementation files absent');
const group = (pattern, extension) => sources.filter((path) => pattern.test(name(path)) && extension.test(path));

test('C04.01 main/config/PlatformIO integration prerequisites exist', () => {
  requirePaths(['firmware/platformio.ini', 'firmware/include/config.h', 'firmware/src/main.cpp']);
});

test('C04.02 queue and wire public interfaces are available for caller review', () => {
  for (const interfaceName of ['queue', 'wire']) {
    const headers = group(new RegExp(`firmware/include/.*${interfaceName}`, 'i'), /\.(h|hpp)$/);
    assert.ok(headers.length, `BLOCKED: ${interfaceName} public header absent`);
  }
});

test('C04.03 modem/transport public interface and implementation are available', () => {
  const pattern = /firmware\/(?:include|src)\/.*(?:modem|transport)/i;
  assert.ok(group(pattern, /\.(h|hpp)$/).length, 'BLOCKED: modem/transport public header absent');
  assert.ok(group(pattern, /\.(cpp|cc)$/).length, 'BLOCKED: modem/transport implementation absent');
});

test('C04.04 renderer/catalog references every public Page enumerator', () => {
  const enumBody = /enum\s+class\s+Page\s*[^\{]*\{([^}]+)\}/.exec(code(types))?.[1];
  assert.ok(enumBody, 'Shared Page enum is unavailable');
  const pageNames = enumBody.split(',').map((entry) => entry.trim().split(/\s|=/)[0]).filter(Boolean);
  const catalogs = sources.filter((path) => /[\\/]ui[\\/]/.test(path) && /\bPage\s*::/.test(code(text.get(path))));
  assert.ok(catalogs.length, 'BLOCKED: renderer/catalog using the shared Page enum is absent');
  const catalogCode = catalogs.map((path) => code(text.get(path))).join('\n');
  for (const page of pageNames) {
    assert.match(catalogCode, new RegExp(`\\bPage\\s*::\\s*${page}\\b`), `No catalog reference for Page::${page}`);
  }
});

test('C04.05 firmware-local quoted include targets resolve', () => {
  assert.ok(sources.length, 'BLOCKED: firmware sources absent');
  for (const [path, source] of text) {
    for (const match of source.matchAll(/^\s*#\s*include\s*"([^"]+)"/gm)) {
      const target = match[1];
      const candidates = [join(dirname(path), target), join(firmware, 'include', target), join(firmware, 'src', target)];
      assert.ok(candidates.some(existsSync), `${name(path)}: unresolved local include ${target}`);
    }
  }
});

test('C04.06 display entry points accept the shared Canvas and immutable State', () => {
  assert.ok(pages.length, 'BLOCKED: display page headers absent');
  for (const path of pages) {
    const source = text.get(path);
    assert.match(source, /#\s*include\s*"(?:ui\/)?types\.h"/, `${name(path)} lacks the shared UI contract`);
    assert.match(code(source), /\binline\s+void\s+render\w+\s*\(\s*Canvas\s*&\s*\w+\s*,\s*const\s+State\s*&\s*\w+\s*\)/,
      `${name(path)}: incompatible page render signature`);
  }
});

test('C04.07 display State member references exist in the shared declaration', () => {
  const body = /struct\s+State\s*\{([\s\S]*?)\};/.exec(code(types))?.[1];
  assert.ok(body, 'Shared State declaration is unavailable');
  const members = new Set([...body.matchAll(/\b([A-Za-z_]\w*)\s*=/g)].map((match) => match[1]));
  assert.ok(members.size, 'Could not discover initialized shared State members');
  for (const path of pages) {
    const source = code(text.get(path));
    const stateName = /const\s+State\s*&\s*(\w+)/.exec(source)?.[1];
    assert.ok(stateName, `${name(path)}: State parameter unavailable`);
    for (const match of source.matchAll(new RegExp(`\\b${stateName}\\s*\\.\\s*(\\w+)`, 'g'))) {
      assert.ok(members.has(match[1]), `${name(path)} references undeclared State::${match[1]}`);
    }
  }
});

const canvasMethods = new Map([...code(types).matchAll(/virtual\s+void\s+(\w+)\s*\(([^)]*)\)\s*=\s*0/g)]
  .map((match) => {
    const parameters = match[2].split(',').filter((parameter) => parameter.trim());
    return [match[1], { min: parameters.filter((parameter) => !parameter.includes('=')).length, max: parameters.length }];
  }));

test('C04.08 display Canvas member calls exist in the shared declaration', () => {
  assert.ok(canvasMethods.size, 'Shared Canvas methods are unavailable');
  for (const path of pages) {
    const source = code(text.get(path));
    const canvasName = /Canvas\s*&\s*(\w+)/.exec(source)?.[1];
    assert.ok(canvasName, `${name(path)}: Canvas parameter unavailable`);
    for (const match of source.matchAll(new RegExp(`\\b${canvasName}\\s*\\.\\s*(\\w+)\\s*\\(`, 'g'))) {
      assert.ok(canvasMethods.has(match[1]), `${name(path)} calls undeclared Canvas::${match[1]}`);
    }
  }
});

test('C04.09 display Canvas call arities match required/defaulted arguments', () => {
  for (const path of pages) {
    const source = code(text.get(path));
    const canvasName = /Canvas\s*&\s*(\w+)/.exec(source)?.[1];
    assert.ok(canvasName, `${name(path)}: Canvas parameter unavailable`);
    for (const match of source.matchAll(new RegExp(`\\b${canvasName}\\s*\\.\\s*(\\w+)\\s*\\(`, 'g'))) {
      let depth = 1;
      let count = 1;
      let index = match.index + match[0].length;
      for (; index < source.length && depth; index++) {
        if ('([{'.includes(source[index])) depth++;
        if (')]}'.includes(source[index])) depth--;
        if (source[index] === ',' && depth === 1) count++;
      }
      assert.equal(depth, 0, `${name(path)}: unbalanced Canvas call`);
      const method = canvasMethods.get(match[1]);
      assert.ok(method && count >= method.min && count <= method.max,
        `${name(path)}: Canvas::${match[1]} has ${count} arguments`);
    }
  }
});

test('C04.10 paint pages stay independent of storage, modem, and hardware APIs', () => {
  const forbidden = /\b(?:new|delete|malloc|calloc|realloc|free|delay|vTaskDelay|sleep|usleep|digitalWrite|analogWrite|pinMode|HTTPClient|WiFiClient|HardwareSerial)\b|\b(?:SD|SPI|Wire|Serial\d*|WiFi)\s*\./;
  for (const path of pages) {
    const source = text.get(path);
    assert.doesNotMatch(code(source), forbidden, `${name(path)} crosses the display-only interface boundary`);
    assert.doesNotMatch(source, /#\s*include\s*[<"][^>"\r\n]*(?:Arduino|queue|wire|modem|transport|sensors|config\.h)[^>"\r\n]*[>"]/i,
      `${name(path)} imports a hardware or transport interface`);
  }
});
