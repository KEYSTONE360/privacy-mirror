"use strict";
const AI_MODELS = Object.freeze({
  FAST: process.env.NVIDIA_MODEL_FAST || "nvidia/nemotron-3.5-lightning-30b-a3b",
  DEEP: process.env.NVIDIA_MODEL_DEEP || "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  RESEARCH: process.env.NVIDIA_MODEL_RESEARCH || "nvidia/nemotron-3-ultra-550b-a55b"
});
const AI_CONFIG = Object.freeze({
  baseUrl: process.env.NVIDIA_API_BASE_URL || "https://integrate.api.nvidia.com/v1",
  disagreementThreshold: Number(process.env.AI_ESCALATION_DISAGREEMENT_THRESHOLD || 30),
  timeoutFastMs: Number(process.env.AI_TIMEOUT_FAST_MS || 12000),
  timeoutDeepMs: Number(process.env.AI_TIMEOUT_DEEP_MS || 25000),
  timeoutResearchMs: Number(process.env.AI_TIMEOUT_RESEARCH_MS || 60000),
  debounceMs: Number(process.env.AI_ANALYSIS_DEBOUNCE_MS || 1500)
});
module.exports = { AI_MODELS, AI_CONFIG };
