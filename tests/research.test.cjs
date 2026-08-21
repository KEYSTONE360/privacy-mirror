"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const Core = require("../packages/core/src/privacy-mirror-core.js");

function run(types) {
  const analyzer = new Core.SessionAnalyzer({ site: "fixture.test" });
  let ts = 0;
  for (const type of types) analyzer.ingest({ ts: ts += 50, type, meta: { hidden: type === "canvas.read", thirdParty: type === "network.request" } });
  return analyzer.report();
}

test("ablation shows network correlation contributes confidence", () => {
  const base = ["canvas.read", "crypto.digest"];
  const withoutNetwork = run(base);
  const full = run([...base, "network.request"]);
  assert.ok(full.confidenceScore > withoutNetwork.confidenceScore);
  assert.ok(full.graph.edges.length > withoutNetwork.graph.edges.length);
});

test("synthetic validation metrics distinguish normal and tracking fixtures", () => {
  const normal = run(["user.interaction", "canvas.write", "canvas.export"]);
  const tracking = run(["canvas.read", "webgl.parameter", "crypto.digest", "network.request"]);
  const metrics = Core.validationMetrics([{ ...normal, expected: false }, { ...tracking, expected: true }]);
  assert.equal(metrics.fp, 0);
  assert.equal(metrics.fn, 0);
  assert.equal(metrics.f1, 1);
});

test("rule engine processing stays below 5 ms p95 in synthetic benchmark", () => {
  const analyzer = new Core.SessionAnalyzer({ site: "perf.test" });
  const samples = [];
  for (let i = 0; i < 500; i += 1) {
    const start = performance.now();
    analyzer.ingest({ ts: i, type: i % 4 === 0 ? "canvas.read" : "environment.navigator", meta: { hidden: false } });
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  assert.ok(samples[Math.floor(samples.length * 0.95)] < 5);
});
