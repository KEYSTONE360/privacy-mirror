"use strict";
function consensus(localAnalysis, aiAnalysis) {
  if (!aiAnalysis) return { state: "LOCAL_ONLY", authority: "local", localAnalysis, aiAnalysis: null };
  const disagreement = Math.abs(localAnalysis.confidenceScore - aiAnalysis.aiConfidence);
  if (disagreement >= 30) return { state: "OBSERVE_MORE", authority: "local", disagreement, localAnalysis, aiAnalysis, allowedActions: [] };
  if (localAnalysis.riskScore >= 85 && localAnalysis.confidenceScore >= 85) return { state: "LOCAL_AUTHORITATIVE", authority: "local", disagreement, localAnalysis, aiAnalysis, allowedActions: aiAnalysis.recommendedActions };
  if (aiAnalysis.benignPlausibility >= 70) return { state: "OBSERVE_MORE", authority: "local", disagreement, localAnalysis, aiAnalysis, allowedActions: [] };
  return { state: "AI_CONTEXT_ACCEPTED", authority: "optimizer", disagreement, localAnalysis, aiAnalysis, allowedActions: aiAnalysis.recommendedActions };
}
module.exports = { consensus };
