import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.SMARTTRACK_PGLITE_PATH || path.join(os.tmpdir(), "smarttrack-notification-tools", "node_modules", "@electric-sql", "pglite"));
const scope = "a".repeat(64), token = "b".repeat(64), id = "11111111-1111-4111-8111-111111111111";
const profile = { name: "Synthetic Visitor", email: "visitor@example.com", phone: "+12025550123" };
const preferences = { general: { enabled: true, minutes: 20 }, journey: { enabled: true, minutes: 180 } };

test("Postgres executes contact ownership, exact scheduling, mode changes, claims and RLS", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    const schema = readFileSync(new URL("../database/notifications.sql", import.meta.url), "utf8");
    await db.exec(schema);
    await db.exec(schema); // migration is re-runnable
    const save = async (overrides = {}) => (await db.query("select smarttrack_save_contact($1,$2,$3,$4,$5,$6,$7,$8,$9) as value", [overrides.scope ?? scope, id, overrides.token ?? token, overrides.profile ?? profile, overrides.preferences ?? preferences, overrides.mode ?? "general", true, "relay", overrides.clientRevision ?? Date.now()])).rows[0].value;
    const first = await save();
    assert.equal(first.contacts[0].name, profile.name);
    assert.ok(!JSON.stringify(first).includes(profile.phone));
    assert.ok(!JSON.stringify(first).includes(profile.email));
    const initialDue = new Date(first.next_due).getTime();
    assert.ok(Math.abs(initialDue - Date.now() - 20 * 60000) < 2000);
    assert.equal((await save()).next_due, first.next_due, "heartbeat must not move due time");
    await assert.rejects(save({ token: "c".repeat(64) }), /Contact ownership/);
    await assert.rejects(save({ scope: "d".repeat(64) }), /Contact ownership/);
    await assert.rejects(save({ clientRevision: 1 }), /newer preference/);
    for (const minutes of [20,30,60,180,300,600,1440]) {
      const value = await save({ preferences: { ...preferences, general: { enabled: true, minutes } } });
      assert.ok(Math.abs(new Date(value.next_due).getTime() - Date.now() - minutes * 60000) < 2000);
    }
    const journey = await save({ mode: "journey" });
    assert.ok(Math.abs(new Date(journey.next_due).getTime() - Date.now() - 180 * 60000) < 2000);
    await save();
    const claim = async () => (await db.query("select * from smarttrack_claim_notifications($1)", [scope])).rows;
    assert.equal((await claim()).length, 0, "no early sending");
    await db.exec("update smarttrack_contacts set next_due=now()-interval '65 minutes';");
    const jobs = await claim();
    assert.equal(jobs.length, 2, "one email and one SMS even after missed intervals");
    assert.deepEqual(jobs.map(j=>j.channel).sort(), ["email","sms"]);
    assert.equal((await claim()).length, 0, "second worker cannot reclaim an in-flight job");
    const due = (await db.query("select next_due from smarttrack_contacts")).rows[0].next_due;
    assert.ok(Math.abs(new Date(due).getTime() - Date.now() - 15 * 60000) < 2000, "preserve original cadence");
    assert.equal((await db.query("select smarttrack_notification_current($1) as ok", [jobs[0].id])).rows[0].ok, true);
    await db.query("select smarttrack_finish_notification($1,'accepted','synthetic-id')", [jobs[0].id]);
    await db.query("select smarttrack_finish_notification($1,'failed',null)", [jobs[0].id]);
    assert.equal((await db.query("select status from smarttrack_notification_jobs where id=$1", [jobs[0].id])).rows[0].status, "accepted");
    await save({ preferences: { ...preferences, general: { enabled: false, minutes: 20 } } });
    assert.equal((await db.query("select smarttrack_notification_current($1) as ok", [jobs[1].id])).rows[0].ok, false);
    assert.equal((await db.query("select next_due from smarttrack_contacts")).rows[0].next_due, null);
    await save();
    await db.exec("update smarttrack_contacts set next_due=now()-interval '1 minute';");
    const interrupted = await claim();
    assert.equal(interrupted.length, 2);
    await db.exec("update smarttrack_notification_jobs set claimed_at=now()-interval '6 minutes' where status='processing';");
    assert.equal((await claim()).length, 0);
    assert.equal((await db.query("select count(*)::integer as n from smarttrack_notification_jobs where status='uncertain'")).rows[0].n, 2);
    await db.exec("set role anon;");
    await assert.rejects(db.query("select * from smarttrack_contacts"), /permission denied/);
    await assert.rejects(db.query("select * from smarttrack_claim_notifications($1)", [scope]), /permission denied/);
    await db.exec("reset role;");
  } finally { await db.close(); }
});
