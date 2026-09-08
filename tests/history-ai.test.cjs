"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeHistory, validateSanitizedPackage } = require("../packages/ai/src/evidence-sanitizer.js");
test("history AI filters site and time and excludes identifying data without inventing sequences", () => {
  const now = 2000000000;
  const bucket = { total: 10, access: { dangerous: 2, suspicious: 4, benign: 4 }, outcomes: { defended: 3 }, categories: { canvas: 5, "private.example": 1 }, rawToken: "secret" };
  const history = { sites: { "private.example": { hours: { [now - 1000]: bucket, [now - 169 * 3600000]: bucket } }, "excluded.example": { hours: { [now - 1000]: bucket } } } };
  const result = sanitizeHistory(history, { site: "private.example", hours: 24, now });
  assert.equal(result.context.totals.total, 10);
  assert.equal(result.context.siteCount, 1);
  assert.equal(result.localAnalysis.riskScore, 40);
  assert.equal(result.context.totals.defended, 3);
  assert.deepEqual(result.events, []);
  assert.equal(/private|excluded|secret/.test(JSON.stringify(result)), false);
  assert.equal(validateSanitizedPackage(result), result);
});
test("empty history keeps zero observations, not an invented safe assessment", () => {
  const result = sanitizeHistory({ sites: {} });
  assert.equal(result.evidenceVersion, 0);
  assert.equal(result.context.siteCount, 0);
});

test("history AI derives defended count from legacy intervention outcomes", () => {
  const now = Date.now();
  const history = { sites: { legacy: { hours: { [now - 1000]: { total: 10, outcomes: { defended: 0, perturbed: 2, cleaned: 1, blocked: 1 }, access: { dangerous: 2, suspicious: 2, benign: 6 }, categories: {} } } } } };
  const result = sanitizeHistory(history, { now, hours: 24 });
  assert.equal(result.context.totals.defended, 4);
});
