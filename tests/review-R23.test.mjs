import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schemaPath = new URL("../database/schema.sql", import.meta.url);

// This is a dependency gate only. A passing gate is not evidence that Postgres
// grants, row policies, or SECURITY DEFINER functions have been tested.
test("R23 prerequisite: the assigned database schema is available for security review", () => {
  let schema;
  try {
    schema = readFileSync(schemaPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      assert.fail(
        "BLOCKED R23: database/schema.sql is missing. RLS, cross-tenant grants, " +
          "and SECURITY DEFINER search_path review require the K1 schema artifact.",
      );
    }
    throw error;
  }

  assert.match(
    schema,
    /\bcreate\s+table\b/i,
    "BLOCKED R23: database/schema.sql has no table DDL to review.",
  );
});
