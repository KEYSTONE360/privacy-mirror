"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../packages/core/src/privacy-mirror-core.js");
const Sanitizer = require("../packages/ai/src/evidence-sanitizer.js");
const { validateAnalysis } = require("../packages/ai/src/response-validator.cjs");
const { routeEvidence } = require("../packages/ai/src/model-router.cjs");
const { analyzeEvidence } = require("../packages/ai/src/ai-service.cjs");

function evidence(local) {
  return {
    schemaVersion: "1.0", evidenceVersion: 2, mode: "ADAPTIVE", localAnalysis: local,
    context: { userInteractionRecent: false, frameType: "TOP" },
    events: [{ id: "event_1", type: "CANVAS_READ", relativeTimeMs: 0, party: "FIRST_PARTY", userActivated: false, metadata: { hidden: true } }],
    protectionsAvailable: [{ action: "CANVAS_PERTURB", privacyGain: 20, compatibilityCost: 1 }]
  };
}
function aiResponse(confidence) {
  return { classification: "POSSIBLE_TRACKING", aiConfidence: confidence, benignPlausibility: 25, evidenceStrength: 65, recommendedActions: ["CANVAS_PERTURB"], explanation: ["Evidence is consistent with possible tracking."], uncertaintyReasons: ["No proven data flow."], evidenceIds: ["event_1"] };
}

test("sanitizer removes raw URLs, domains, token tags, and absolute timestamps", () => {
  const report = {
    startedAt: 100000, eventCount: 1, riskScore: 60, confidenceScore: 45,
    events: [{ id: "x", ts: 100123, type: "navigation.decorated", meta: { fullUrl: "https://example.test/account?id=ABC123", tokenTag: "secret-tag", thirdParty: true }, context: { userInitiated: false } }],
    counterfactuals: []
  };
  const output = Sanitizer.sanitizeEvidence(report);
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes("example.test"), false);
  assert.equal(serialized.includes("ABC123"), false);
  assert.equal(serialized.includes("secret-tag"), false);
  assert.equal(serialized.includes("100123"), false);
  assert.equal(output.events[0].relativeTimeMs, 0);
});

test("validator rejects hallucinated evidence IDs and unsupported claims", () => {
  const input = evidence({ riskScore: 60, confidenceScore: 50 });
  assert.throws(() => validateAnalysis({ ...aiResponse(60), evidenceIds: ["event_missing"] }, input), /hallucinated/);
  assert.throws(() => validateAnalysis({ ...aiResponse(60), explanation: ["The user was uniquely identified."] }, input), /unsupported/);
});

test("adaptive service escalates large FAST disagreement to DEEP", async () => {
  const calls = [];
  const gateway = { analyze: async (_, route) => { calls.push(route.tier); return route.tier === "FAST" ? aiResponse(28) : aiResponse(64); } };
  const result = await analyzeEvidence(evidence({ riskScore: 82, confidenceScore: 72 }), { gateway });
  assert.deepEqual(calls, ["FAST", "DEEP"]);
  assert.equal(result.status, "OK");
  assert.equal(result.route, "DEEP");
});

test("clear local cases do not call AI and Ultra is research-only", async () => {
  let calls = 0;
  const gateway = { analyze: async () => { calls += 1; return aiResponse(90); } };
  const skipped = await analyzeEvidence(evidence({ riskScore: 92, confidenceScore: 92 }), { gateway });
  assert.equal(skipped.status, "SKIPPED");
  assert.equal(calls, 0);
  assert.equal(routeEvidence({ riskScore: 60, confidenceScore: 40 }, "ADAPTIVE").tier, "FAST");
  assert.equal(routeEvidence({ riskScore: 60, confidenceScore: 40 }, "RESEARCH").tier, "RESEARCH");
});

test("provider failures fail local without disabling deterministic analysis", async () => {
  const gateway = { analyze: async () => { const error = new Error("rate limited"); error.status = 429; throw error; } };
  const result = await analyzeEvidence(evidence({ riskScore: 65, confidenceScore: 40 }), { gateway });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.consensus.state, "LOCAL_ONLY");
  const analyzer = new Core.SessionAnalyzer({ site: "still-works.test" });
  assert.ok(analyzer.ingest({ ts: 1, type: "canvas.read", meta: { hidden: true } }).riskScore > 0);
});
