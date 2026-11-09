import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// These are review-input checks, not a TLS or hardware qualification suite.
// Missing implementation is explicitly skipped/blocked rather than passed.
const root = fileURLToPath(new URL("../", import.meta.url));
const firmware = path.join(root, "firmware");

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:h|hpp|c|cc|cpp)$/i.test(entry.name) ? [target] : [];
  });
}

const candidates = sourceFiles(path.join(firmware, "include"))
  .concat(sourceFiles(path.join(firmware, "src")));
const transportSources = candidates.filter((file) =>
  /modem|transport|tls/i.test(path.basename(file)),
);

const requiredInputs = [
  path.join(firmware, "platformio.ini"),
  path.join(firmware, "include", "config.h"),
  path.join(firmware, "src", "main.cpp"),
];
const implementationAvailable =
  requiredInputs.every((file) => existsSync(file)) &&
  transportSources.some((file) => /\.(?:c|cc|cpp)$/i.test(file));
const blockedReason = implementationAvailable
  ? "Manual source-specific security review is required; this artifact does not certify an implementation by pattern matching."
  : "BLOCKED: required K8/K10 firmware and modem/TLS implementation is not present; no security behavior was checked.";

const checks = [
  "modem is disabled in the default build",
  "disabled mode cannot initialize UART, power, attach or transmit",
  "unspecified PWRKEY remains -1 and is never driven",
  "enabled production transport requires HTTPS/TLS",
  "missing trust configuration fails closed before sending",
  "certificate chains are validated",
  "certificate hostname is verified",
  "certificate validity requires a usable clock",
  "TLS errors have no insecure or plaintext fallback",
  "transport failures cannot produce a success receipt",
];

for (const [index, name] of checks.entries()) {
  test(`R40 check ${index + 1}: ${name}`, {
    skip: blockedReason,
  }, () => {
    assert.fail("This review must be performed against the supplied K8/K10 implementation.");
  });
}

test("R40 modem/TLS qualification requires exact hardware and TLS rejection evidence", {
  skip: "BLOCKED: no modem equipment, exact board validation, credentials or TLS test endpoint were available for this review.",
}, () => {
  assert.fail("Hardware and endpoint qualification evidence is required.");
});
