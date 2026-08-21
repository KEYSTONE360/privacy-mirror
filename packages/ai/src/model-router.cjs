"use strict";
const { AI_MODELS, AI_CONFIG } = require("./config.cjs");

function routeEvidence(localAnalysis, mode) {
  const risk = localAnalysis.riskScore;
  const confidence = localAnalysis.confidenceScore;
  if (mode === "OFF") return { call: false, reason: "ai-disabled" };
  if (mode === "RESEARCH") return { call: true, tier: "RESEARCH", model: AI_MODELS.RESEARCH };
  if ((risk >= 85 && confidence >= 85) || (risk < 30 && confidence < 30)) return { call: false, reason: "local-evidence-sufficient" };
  if ((risk >= 40 && risk <= 85 && confidence >= 20 && confidence <= 75) || Math.abs(risk - confidence) >= 25) return { call: true, tier: "FAST", model: AI_MODELS.FAST };
  return { call: false, reason: "outside-ambiguity-zone" };
}

function shouldEscalate(localConfidence, analysis) {
  return Math.abs(localConfidence - analysis.aiConfidence) >= AI_CONFIG.disagreementThreshold || analysis.aiConfidence < 45;
}
module.exports = { routeEvidence, shouldEscalate };
