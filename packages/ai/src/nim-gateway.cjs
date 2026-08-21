"use strict";
const { AI_CONFIG } = require("./config.cjs");
const { SYSTEM_PROMPT, ANALYSIS_PROMPT } = require("./prompts.cjs");

class NimGateway {
  constructor(options) { this.fetch = options && options.fetch || globalThis.fetch; this.baseUrl = options && options.baseUrl || AI_CONFIG.baseUrl; }
  async analyze(evidencePackage, route) {
    const key = route.tier === "RESEARCH" ? (process.env.NVIDIA_API_KEY_RESEARCH || process.env.NVIDIA_API_KEY) : (process.env.NVIDIA_API_KEY_FAST || process.env.NVIDIA_API_KEY);
    if (!key) throw new Error("NVIDIA API key is not configured on the server");
    const timeoutMs = route.tier === "RESEARCH" ? AI_CONFIG.timeoutResearchMs : route.tier === "DEEP" ? AI_CONFIG.timeoutDeepMs : AI_CONFIG.timeoutFastMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", signal: controller.signal,
        headers: { "authorization": `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: route.model, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `${ANALYSIS_PROMPT}\nEVIDENCE_JSON:\n${JSON.stringify(evidencePackage)}` }], temperature: 0.2, top_p: 0.9, max_tokens: route.tier === "RESEARCH" ? 4096 : 2048, stream: false, response_format: { type: "json_object" } })
      });
      if (!response.ok) { const error = new Error(`NVIDIA request failed with ${response.status}`); error.status = response.status; throw error; }
      const payload = await response.json();
      const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
      if (typeof content !== "string") throw new Error("NVIDIA response content is missing");
      return JSON.parse(content);
    } finally { clearTimeout(timeout); }
  }
}
module.exports = { NimGateway };
