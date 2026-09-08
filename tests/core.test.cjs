"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../packages/core/src/privacy-mirror-core.js");

test("registrable domain and third-party comparison are stable", () => {
  assert.equal(Core.registrableDomain("https://shop.example.co.kr/a"), "example.co.kr");
  assert.equal(Core.isThirdParty("https://tracker.test/p", "https://shop.example.test"), true);
  assert.equal(Core.isThirdParty("https://cdn.example.test/p", "https://shop.example.test"), false);
});

test("known tracking cleaner preserves functional parameters", () => {
  const result = Core.sanitizeKnownTrackingUrl("https://example.test/article?page=2&utm_source=x&fbclid=y");
  assert.equal(result.changed, true);
  assert.deepEqual(result.removed.sort(), ["fbclid", "utm_source"]);
  assert.equal(new URL(result.url).searchParams.get("page"), "2");
});

test("deterministic seed produces same sequence per site surface", () => {
  const a = Core.createPrng("session-site-seed", "canvas");
  const b = Core.createPrng("session-site-seed", "canvas");
  const c = Core.createPrng("other-site-seed", "canvas");
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(a(), c());
});

test("cross-layer sequence separates risk and confidence and creates edges", () => {
  const analyzer = new Core.SessionAnalyzer({ site: "fixture.test", startedAt: 1000 });
  analyzer.ingest({ ts: 1000, type: "canvas.read", meta: { hidden: true, area: 0 } });
  analyzer.ingest({ ts: 1080, type: "crypto.digest", meta: { algorithm: "SHA-256", byteLength: 64 } });
  const report = analyzer.ingest({ ts: 1200, type: "network.request", meta: { thirdParty: true, resourceType: "xmlhttprequest" } });
  assert.ok(report.riskScore >= 60);
  assert.ok(report.confidenceScore >= 50);
  assert.ok(report.graph.edges.some((edge) => edge.kind === "derived-by-digest"));
  assert.ok(report.graph.edges.some((edge) => edge.kind === "temporal-egress"));
});

test("token lineage only retains an HMAC-shaped tag, not raw values", () => {
  const analyzer = new Core.SessionAnalyzer({ site: "fixture.test" });
  const raw = "customer-secret-token-123456";
  analyzer.ingest({ ts: 1, type: "navigation.decorated", meta: { tokenTag: "hmac_tag_01" } });
  const report = analyzer.ingest({ ts: 2, type: "storage.write", meta: { tokenTag: "hmac_tag_01" } });
  assert.ok(report.graph.edges.some((edge) => edge.kind === "token-lineage"));
  assert.equal(JSON.stringify(report).includes(raw), false);
});

test("compatibility guard rolls protection back", () => {
  const analyzer = new Core.SessionAnalyzer({ site: "fixture.test", compatibility: { failureThreshold: 2 } });
  analyzer.policy = "protect";
  analyzer.ingest({ ts: 10, type: "compatibility.error", meta: {} });
  const report = analyzer.ingest({ ts: 20, type: "compatibility.resource-failure", meta: {} });
  assert.equal(report.policy, "observe");
  assert.equal(report.rollbacks.length, 1);
});

test("minimum intervention optimizer avoids strict blocking when cheaper choices suffice", () => {
  const result = Core.optimizeInterventions({ riskScore: 80, confidenceScore: 80, categories: ["canvas", "navigation", "network", "token"] });
  assert.ok(result.projectedRisk <= 35);
  assert.equal(result.selected.includes("strict-canvas-block"), false);
});

test("repeated same-layer calls are damped instead of saturating scores", () => {
  const analyzer = new Core.SessionAnalyzer({ site: "ordinary.test", startedAt: 1000 });
  let report;
  for (let index = 0; index < 100; index += 1) {
    report = analyzer.ingest({ ts: 1000 + index, type: "storage.read", meta: { operation: "getItem" } });
  }
  assert.ok(report.riskScore < 20, `risk was ${report.riskScore}`);
  assert.ok(report.confidenceScore < 15, `confidence was ${report.confidenceScore}`);
  assert.equal(report.scoring.featureDiversity, 1);
});

test("protection controller preserves manual mode and applies auto hysteresis", () => {
  const controller = new Core.ProtectionController();
  assert.equal(controller.reconcile({ riskScore: 70, confidenceScore: 60 }, 1000).effective, "protect");
  assert.equal(controller.reconcile({ riskScore: 50, confidenceScore: 45 }, 2000).effective, "protect");
  assert.equal(controller.reconcile({ riskScore: 30, confidenceScore: 45 }, 3000).effective, "observe");
  controller.setMode("protect");
  assert.equal(controller.reconcile({ riskScore: 0, confidenceScore: 0 }, 4000).effective, "protect");
  controller.registerRollback(5000);
  assert.equal(controller.reconcile({ riskScore: 100, confidenceScore: 100 }, 6000).effective, "observe");
  assert.equal(controller.reconcile({ riskScore: 100, confidenceScore: 100 }, 36000).effective, "protect");
});

test("seven-day history keeps site and hourly outcomes while pruning expired buckets", () => {
  const now = Date.UTC(2026, 8, 3, 12, 30);
  const expired = now - 8 * 24 * 60 * 60 * 1000;
  const initial = { version: 1, sites: { "old.example": { hours: { [String(Math.floor(expired / 3600000) * 3600000)]: { total: 1 } } } } };
  const events = [
    { ts: now - 1000, type: "canvas.read", context: { category: "canvas-read" }, meta: { intervention: "perturbed" }, riskContribution: 18, confidenceContribution: 9 },
    { ts: now - 2000, type: "navigation.link-cleaned", context: { category: "navigation" }, meta: { intervention: "cleaned" }, riskContribution: 5, confidenceContribution: 4 }
  ];
  const history = Core.mergeTrackingHistory(initial, "example.com", events, now);
  assert.equal(history.sites["old.example"], undefined);
  const bucket = Object.values(history.sites["example.com"].hours)[0];
  assert.equal(bucket.total, 2);
  assert.equal(bucket.outcomes.defended, 2);
  assert.equal(bucket.outcomes.perturbed, 1);
  assert.equal(bucket.outcomes.cleaned, 1);
  assert.equal(bucket.access.dangerous, 1);
  assert.equal(bucket.access.suspicious, 1);
  assert.equal(bucket.access.benign, 0);
  assert.equal(JSON.stringify(history).includes("https://"), false);
});
