import test from "node:test";
import assert from "node:assert/strict";
import { openResearchHost } from "../src/oos-research-host.js";

const environment = { OOS_RESEARCH_DATABASE_URL: "TEST_WRITER", OOS_FORENSIC_DATABASE_URL: "TEST_READER" };
function factory(overrides = {}) {
  const calls = [], ended = [];
  return { calls, ended, poolFactory: options => ({
    connect: async () => assert.fail("composition must not execute research transactions"),
    query: async (sql, params) => {
      calls.push({ connection: options.connectionString, sql, params });
      return { rows: sql.includes("pg_roles") ? [{ rolsuper: false, rolcreaterole: false, forbidden_write: false, ...overrides }] : [] };
    }, end: async () => ended.push(options.connectionString) }) };
}
test("missing separate credentials fails before constructing any pool or OOS runtime", async () => {
  await assert.rejects(openResearchHost({ config: {}, environment: {}, poolFactory: () => assert.fail("must not connect") }), /CONFIGURATION_REQUIRED/);
});
test("research host refuses privileged roles and closes pools before any forensic source access", async () => {
  for (const field of ["rolsuper", "rolcreaterole", "forbidden_write"]) {
    const f = factory({ [field]: true });
    await assert.rejects(openResearchHost({ config: {}, environment, poolFactory: f.poolFactory }), /ROLE_NOT_ISOLATED/);
    assert.equal(f.ended.length, 2); assert.equal(f.calls.length, 1);
  }
});
test("host uses distinct read/writer identities, checks roles and migration before optional activation", async () => {
  const f = factory();
  const host = await openResearchHost({ config: { archive_root: "SYNTHETIC_NOT_OPENED" }, environment, poolFactory: f.poolFactory });
  try {
    assert.deepEqual(f.calls.slice(0, 2).map(c => [c.connection, c.params[0]]), [["TEST_WRITER", "writer"], ["TEST_READER", "reader"]]);
    assert.ok(f.calls[2].sql.includes("research_state.t3_cycles"));
    assert.ok(f.calls.every(c => !/INSERT|UPDATE|DELETE/.test(c.sql.replace("'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'", ""))));
    assert.equal(typeof host.api.advance, "function");
  } finally { await host.close(); }
  assert.equal(f.ended.length, 2);
});
