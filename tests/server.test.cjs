"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { validateMinimizedPayload, analyzeMinimizedPayload } = require("../apps/analysis-server/server-lib.cjs");

test("analysis server accepts only aggregated minimized fields", () => {
  const result = analyzeMinimizedPayload({ riskScore: 70, confidenceScore: 55, categories: ["canvas", "network"], eventCounts: { canvas: 3 }, clientVersion: "0.1.0" });
  assert.equal(result.retention, "none-at-application-layer");
  assert.ok(result.recommendation);
});

test("analysis server rejects raw URL and token fields", () => {
  assert.throws(() => validateMinimizedPayload({ riskScore: 1, confidenceScore: 1, fullUrl: "https://example.test/?id=secret" }), /not allowed/);
  assert.throws(() => validateMinimizedPayload({ riskScore: 1, confidenceScore: 1, rawToken: "secret" }), /not allowed/);
});

test("server implementation has no persistence or telemetry dependency", () => {
  const source = fs.readFileSync(require.resolve("../apps/analysis-server/server.cjs"), "utf8");
  for (const forbidden of ["sqlite", "redis", "mongodb", "sentry", "analytics", "writeFile", "appendFile", "console.log(req", "console.error(req", "logger.info(req", "logger.error(req"]) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});
