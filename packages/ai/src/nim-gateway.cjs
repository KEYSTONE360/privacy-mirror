"use strict";
const { AI_CONFIG } = require("./config.cjs");
const { SYSTEM_PROMPT, ANALYSIS_PROMPT } = require("./prompts.cjs");

class NimGateway {
  constructor(options) { this.fetch = options && options.fetch || globalThis.fetch; this.baseUrl = options && options.baseUrl || AI_CONFIG.baseUrl; }
  async analyze(evidencePackage, route) {
    const key = cleanSecret(route.tier === "RESEARCH" ? (process.env.NVIDIA_API_KEY_RESEARCH || process.env.NVIDIA_API_KEY) : (process.env.NVIDIA_API_KEY_FAST || process.env.NVIDIA_API_KEY));
    if (!key) throw new Error("NVIDIA API key is not configured on the server");
    const timeoutMs = route.tier === "RESEARCH" ? AI_CONFIG.timeoutResearchMs : route.tier === "DEEP" ? AI_CONFIG.timeoutDeepMs : AI_CONFIG.timeoutFastMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", signal: controller.signal,
        headers: { "authorization": `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: route.model,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `${ANALYSIS_PROMPT}\nEVIDENCE_JSON:\n${JSON.stringify(evidencePackage)}` }],
          temperature: 0.2,
          top_p: 0.9,
          max_tokens: route.tier === "RESEARCH" ? 16384 : route.tier === "DEEP" ? 2048 : 768,
          stream: true,
          chat_template_kwargs: { enable_thinking: route.tier === "DEEP" },
          ...(route.tier === "DEEP" ? { reasoning_budget: 2048 } : {})
        })
      });
      if (!response.ok) { const error = new Error(`NVIDIA request failed with ${response.status}`); error.status = response.status; throw error; }
      const content = await readSseContent(response);
      if (!content) throw new Error("NVIDIA response content is missing");
      return parseJsonContent(content);
    } finally { clearTimeout(timeout); }
  }
}

function cleanSecret(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) return trimmed.slice(1, -1).trim();
  return trimmed;
}

async function readSseContent(response) {
  if (!response.body || typeof response.body.getReader !== "function") throw new Error("NVIDIA streaming response is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let content = "";
  let reasoning = "";
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = done ? "" : lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const chunk = JSON.parse(data);
      const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (delta && typeof delta.content === "string") content += delta.content;
      if (delta && typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
    }
    if (done) break;
  }
  return `${reasoning}\n${content}`.trim();
}

function parseJsonContent(content) {
  const trimmed = String(content).trim();
  try { return JSON.parse(trimmed); }
  catch (_) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try { return JSON.parse(fenced[1].trim()); }
      catch (_) { /* continue with balanced-object extraction */ }
    }
    const objects = extractJsonObjects(trimmed);
    let fallback;
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      try {
        const parsed = JSON.parse(objects[index]);
        if (!fallback) fallback = parsed;
        if (parsed && typeof parsed.classification === "string" && Number.isFinite(parsed.aiConfidence)) return parsed;
      }
      catch (_) { /* try the preceding complete object */ }
    }
    if (fallback) return fallback;
    throw new Error("NVIDIA response did not contain valid JSON");
  }
}

function extractJsonObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) { objects.push(text.slice(start, index + 1)); start = -1; }
    }
  }
  return objects;
}

module.exports = { NimGateway, parseJsonContent, readSseContent, extractJsonObjects };
