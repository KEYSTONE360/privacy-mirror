/* global PrivacyMirrorCore, PrivacyMirrorBrowserAdapter, PrivacyMirrorEvidenceSanitizer, importScripts */
(function privacyMirrorBackground(root) {
  "use strict";
  if (!root.PrivacyMirrorCore && typeof importScripts === "function") {
    importScripts("core/privacy-mirror-core.js", "ai/evidence-sanitizer.js", "adapters/chrome-adapter.js");
  }
  const Core = root.PrivacyMirrorCore;
  const Adapter = root.PrivacyMirrorBrowserAdapter;
  const Sanitizer = root.PrivacyMirrorEvidenceSanitizer;
  if (!Core || !Adapter) throw new Error("Privacy Mirror core or browser adapter is unavailable");

  const sessions = new Map();
  const topLevelByTab = new Map();
  const navigationByTab = new Map();
  const aiByTab = new Map();
  const aiTriggerByTab = new Map();
  let masterKeyPromise;

  function bytesToBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToBytes(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function sessionMaster() {
    if (!masterKeyPromise) {
      masterKeyPromise = (async () => {
        const stored = await Adapter.storageSession.get("pmSessionMaster");
        let encoded = stored && stored.pmSessionMaster;
        if (!encoded) {
          const bytes = crypto.getRandomValues(new Uint8Array(32));
          encoded = bytesToBase64Url(bytes);
          await Adapter.storageSession.set({ pmSessionMaster: encoded });
        }
        return crypto.subtle.importKey("raw", base64UrlToBytes(encoded), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      })();
    }
    return masterKeyPromise;
  }

  async function hmac(label, value, length) {
    const key = await sessionMaster();
    const data = new TextEncoder().encode(`${label}\0${String(value)}`);
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
    return bytesToBase64Url(signature.slice(0, length || 16));
  }

  async function configForSite(site, policy) {
    return {
      seedMaterial: await hmac("seed", site, 16),
      policy: policy || "observe",
      cleanLinks: true
    };
  }

  function sessionFor(tabId, url) {
    const site = Core.registrableDomain(url || topLevelByTab.get(tabId) || "unknown");
    const existing = sessions.get(tabId);
    if (existing && existing.site === site) return existing;
    const created = new Core.SessionAnalyzer({ site, maxEvents: 1000 });
    sessions.set(tabId, created);
    return created;
  }

  function tokenCandidatesFromUrl(url) {
    const candidates = [];
    try {
      for (const [, value] of new URL(url).searchParams) {
        if (value.length >= 8 && value.length <= 512 && /^[\w.~-]+$/.test(value)) candidates.push(value);
      }
    } catch (_) { /* invalid or hidden URL */ }
    return candidates.slice(0, 8);
  }

  async function normalizeEvent(input, extra) {
    const event = {
      id: input.id,
      ts: input.ts || Date.now(),
      type: input.type,
      frameId: extra.frameId || 0,
      meta: Object.assign({}, input.meta)
    };
    const rawTokens = Array.isArray(input.rawTokens) ? input.rawTokens : [];
    if (rawTokens.length) event.meta.tokenTag = await hmac("token", rawTokens[0], 16);
    event.meta.thirdParty = Boolean(extra.thirdParty || event.meta.thirdParty);
    return event;
  }

  async function ingestBatch(tabId, url, frameId, inputEvents) {
    if (!Number.isInteger(tabId) || tabId < 0) return null;
    const analyzer = sessionFor(tabId, url);
    let report = analyzer.report();
    for (const input of inputEvents.slice(0, 64)) {
      if (!input || typeof input.type !== "string") continue;
      const event = await normalizeEvent(input, { frameId });
      report = analyzer.ingest(event);
    }
    const shouldProtect = report.riskScore >= 55 && report.confidenceScore >= 45 && report.policy !== "observe" ? true : report.riskScore >= 55 && report.confidenceScore >= 45;
    if (report.rollbacks.length) analyzer.policy = "observe";
    else if (shouldProtect) analyzer.policy = "protect";
    report = analyzer.report();
    const config = await configForSite(analyzer.site, analyzer.policy);
    await Adapter.sendToTab(tabId, { type: "PM_POLICY", config });
    void maybeAnalyze(tabId, report);
    return report;
  }

  async function maybeAnalyze(tabId, report) {
    if (!Sanitizer) return;
    const state = aiTriggerByTab.get(tabId) || { at: 0, version: -1 };
    if (Date.now() - state.at < 1500 || state.version === report.eventCount) return;
    const stored = await Adapter.storageLocal.get("pmAiSettings").catch(() => ({}));
    const settings = stored && stored.pmAiSettings || { mode: "OFF" };
    if (settings.mode !== "ADAPTIVE" || typeof settings.serverBaseUrl !== "string" || !settings.serverBaseUrl.startsWith("https://")) return;
    const ambiguous = (report.riskScore >= 40 && report.riskScore <= 85 && report.confidenceScore >= 20 && report.confidenceScore <= 75) || Math.abs(report.riskScore - report.confidenceScore) >= 25;
    if (!ambiguous) return;
    aiTriggerByTab.set(tabId, { at: Date.now(), version: report.eventCount });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const evidence = Sanitizer.sanitizeEvidence(report, { mode: "ADAPTIVE", evidenceVersion: report.eventCount });
      const response = await fetch(`${settings.serverBaseUrl.replace(/\/$/, "")}/api/ai/analyze`, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(evidence), cache: "no-store", referrerPolicy: "no-referrer" });
      if (response.ok) aiByTab.set(tabId, await response.json());
    } catch (_) { aiByTab.set(tabId, { status: "UNAVAILABLE", consensus: { state: "LOCAL_ONLY" } }); }
    finally { clearTimeout(timeout); }
  }

  async function handleMessage(message, sender) {
    const tabId = sender && sender.tab && sender.tab.id;
    const tabUrl = sender && sender.tab && sender.tab.url;
    if (message && message.type === "PM_INIT") {
      if (Number.isInteger(tabId)) topLevelByTab.set(tabId, tabUrl || message.href);
      const analyzer = sessionFor(tabId, tabUrl || message.href);
      return { config: await configForSite(analyzer.site, analyzer.policy), report: analyzer.report() };
    }
    if (message && message.type === "PM_EVENT_BATCH") {
      return { report: await ingestBatch(tabId, tabUrl, sender.frameId, Array.isArray(message.events) ? message.events : []) };
    }
    if (message && message.type === "PM_GET_REPORT") {
      let requestedTab = message.tabId;
      if (!Number.isInteger(requestedTab)) {
        const tabs = await Adapter.queryTabs({ active: true, currentWindow: true });
        requestedTab = tabs[0] && tabs[0].id;
      }
      const analyzer = sessions.get(requestedTab);
      return { report: analyzer ? analyzer.report() : null, ai: aiByTab.get(requestedTab) || null };
    }
    if (message && message.type === "PM_SET_POLICY" && Number.isInteger(message.tabId)) {
      const analyzer = sessions.get(message.tabId);
      if (analyzer) analyzer.policy = message.policy === "protect" ? "protect" : "observe";
      return { ok: Boolean(analyzer) };
    }
    if (message && message.type === "PM_SET_AI_SETTINGS") {
      const mode = ["OFF", "ADAPTIVE"].includes(message.mode) ? message.mode : "OFF";
      const serverBaseUrl = typeof message.serverBaseUrl === "string" && message.serverBaseUrl.startsWith("https://") ? message.serverBaseUrl.replace(/\/$/, "") : "";
      await Adapter.storageLocal.set({ pmAiSettings: { mode, serverBaseUrl } });
      return { ok: true };
    }
    return undefined;
  }

  Adapter.onMessage((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse).catch(() => sendResponse({ error: "request-failed" }));
    return true;
  });

  Adapter.onRequest((details) => {
    if (!Number.isInteger(details.tabId) || details.tabId < 0) return;
    const topUrl = topLevelByTab.get(details.tabId) || details.documentUrl || details.initiator || details.url;
    if (details.type === "main_frame") topLevelByTab.set(details.tabId, details.url);
    const thirdParty = Core.isThirdParty(details.url, topUrl);
    if (!thirdParty && details.type !== "main_frame") return;
    const input = {
      id: `n-${details.requestId}-${Date.now()}`,
      ts: details.timeStamp || Date.now(),
      type: details.type === "main_frame" ? "navigation.request" : "network.request",
      meta: { resourceType: details.type, thirdParty, operation: "webRequest.observe" },
      rawTokens: tokenCandidatesFromUrl(details.url)
    };
    void ingestBatch(details.tabId, topUrl, details.frameId, [input]);
  });

  Adapter.onNavigation((details) => {
    if (details.frameId !== 0 || !Number.isInteger(details.tabId)) return;
    const current = { ts: details.timeStamp || Date.now(), url: details.url, site: Core.registrableDomain(details.url) };
    const previous = navigationByTab.get(details.tabId);
    navigationByTab.set(details.tabId, current);
    topLevelByTab.set(details.tabId, details.url);
    if (!previous || current.ts - previous.ts > 2000 || previous.site === current.site) return;
    const input = {
      id: `bounce-${details.tabId}-${Math.round(current.ts)}`,
      ts: current.ts,
      type: "navigation.bounce",
      meta: { operation: details.transitionType || "redirect", durationMs: current.ts - previous.ts },
      rawTokens: tokenCandidatesFromUrl(details.url)
    };
    void ingestBatch(details.tabId, details.url, 0, [input]);
  });

  void Adapter.configurePanel();
})(typeof globalThis !== "undefined" ? globalThis : this);
