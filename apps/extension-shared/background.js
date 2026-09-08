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

  const records = new Map();
  const topLevelByTab = new Map();
  const navigationByTab = new Map();
  const aiByTab = new Map();
  const aiTriggerByTab = new Map();
  const aiInFlight = new Map();
  const HISTORY_KEY = "pmTrackingHistoryV1";
  const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  const REMOTE_AI_URL = "https://privacy-mirror-analysis-blazetiger10-5946s-projects.vercel.app";
  let historyWrite = Promise.resolve();
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
          encoded = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
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

  async function storedSiteModes() {
    const stored = await Adapter.storageLocal.get("pmSitePolicies").catch(() => ({}));
    return stored && stored.pmSitePolicies && typeof stored.pmSitePolicies === "object" ? stored.pmSitePolicies : {};
  }

  async function recordFor(tabId, url) {
    const site = Core.registrableDomain(url || topLevelByTab.get(tabId) || "unknown") || "unknown";
    const existing = records.get(tabId);
    if (existing && existing.site === site) return existing;
    if (existing) { aiByTab.delete(tabId); aiTriggerByTab.delete(tabId); }
    const siteModes = await storedSiteModes();
    const analyzer = new Core.SessionAnalyzer({ site, maxEvents: 1000 });
    const sessionKey = `pmTabSession:${tabId}`;
    const stored = await Adapter.storageSession.get(sessionKey).catch(() => ({}));
    const snapshot = stored && stored[sessionKey];
    if (snapshot && snapshot.site === site && Array.isArray(snapshot.events)) {
      for (const event of snapshot.events.slice(-200)) analyzer.ingest(event);
    }
    const created = {
      site,
      analyzer,
      controller: new Core.ProtectionController({ mode: siteModes[site] || "auto" }),
      rollbackCount: 0
    };
    records.set(tabId, created);
    return created;
  }

  async function persistRecord(tabId, record) {
    const report = record.analyzer.report();
    const events = report.events.slice(-200).map((event) => ({ id: event.id, ts: event.ts, type: event.type, meta: event.meta, frameId: event.frameId || 0 }));
    await Adapter.storageSession.set({ [`pmTabSession:${tabId}`]: { site: record.site, events } }).catch(() => undefined);
  }

  function persistHistory(site, events) {
    if (!site || site === "unknown" || !events.length) return Promise.resolve();
    historyWrite = historyWrite.then(async () => {
      const now = Date.now();
      const stored = await Adapter.storageLocal.get(HISTORY_KEY).catch(() => ({}));
      const history = Core.mergeTrackingHistory(stored && stored[HISTORY_KEY], site, events, now, HISTORY_RETENTION_MS);
      await Adapter.storageLocal.set({ [HISTORY_KEY]: history });
    }).catch(() => undefined);
    return historyWrite;
  }

  async function trackingHistory() {
    await historyWrite;
    const stored = await Adapter.storageLocal.get(HISTORY_KEY).catch(() => ({}));
    const history = stored && stored[HISTORY_KEY] || { version: 1, sites: {} };
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    const sites = {};
    for (const [site, siteData] of Object.entries(history.sites || {})) {
      const hours = Object.entries(siteData.hours || {}).filter(([hour]) => Number(hour) >= cutoff).sort((a, b) => Number(a[0]) - Number(b[0]));
      if (hours.length) sites[site] = { hours: Object.fromEntries(hours) };
    }
    return { version: 1, retentionDays: 7, updatedAt: history.updatedAt || null, sites };
  }

  function reportFor(record) {
    let report = record.analyzer.report();
    if (report.rollbacks.length > record.rollbackCount) {
      record.rollbackCount = report.rollbacks.length;
      record.controller.registerRollback(report.rollbacks[report.rollbacks.length - 1].ts);
    }
    const protection = record.controller.reconcile(report, Date.now());
    record.analyzer.policy = protection.effective;
    report = record.analyzer.report();
    report.policy = protection.effective;
    report.protection = protection;
    return report;
  }

  async function configForRecord(record) {
    return { seedMaterial: await hmac("seed", record.site, 16), policy: record.controller.effective, cleanLinks: true };
  }

  async function persistSiteMode(site, mode) {
    const modes = await storedSiteModes();
    if (mode === "auto") delete modes[site];
    else modes[site] = mode;
    await Adapter.storageLocal.set({ pmSitePolicies: modes });
  }

  async function broadcast(tabId, record) {
    const config = await configForRecord(record);
    await Adapter.sendToTab(tabId, { type: "PM_POLICY", config });
    return config;
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

  async function normalizeEvent(input, frameId) {
    const event = { id: input.id, ts: input.ts || Date.now(), type: input.type, frameId: frameId || 0, meta: Object.assign({}, input.meta) };
    const rawTokens = Array.isArray(input.rawTokens) ? input.rawTokens : [];
    if (rawTokens.length) event.meta.tokenTag = await hmac("token", rawTokens[0], 16);
    return event;
  }

  async function ingestBatch(tabId, url, frameId, inputEvents) {
    if (!Number.isInteger(tabId) || tabId < 0) return null;
    const record = await recordFor(tabId, url);
    const historyEvents = [];
    for (const input of inputEvents.slice(0, 64)) {
      if (input && typeof input.type === "string") {
        const eventReport = record.analyzer.ingest(await normalizeEvent(input, frameId));
        const recorded = eventReport.events[eventReport.events.length - 1];
        if (recorded) historyEvents.push(recorded);
      }
    }
    const report = reportFor(record);
    await persistRecord(tabId, record);
    await persistHistory(record.site, historyEvents);
    await broadcast(tabId, record);
    void maybeAnalyze(tabId, report);
    return report;
  }

  async function aiSettings() {
    return { mode: "ADAPTIVE", serverBaseUrl: REMOTE_AI_URL, locked: true };
  }

  function validServerUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.origin !== REMOTE_AI_URL) return "";
      return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
    } catch (_) { return ""; }
  }

  async function analyzeWithServer(tabId, report, requestedMode, force) {
    const key = `${tabId}:${report.site}:${requestedMode}`;
    if (aiInFlight.has(key)) return aiInFlight.get(key);
    const work = runAnalysisRequest(tabId, report, requestedMode, force).finally(() => aiInFlight.delete(key));
    aiInFlight.set(key, work); return work;
  }

  async function runAnalysisRequest(tabId, report, requestedMode, force) {
    if (!Sanitizer) return { status: "UNAVAILABLE", reason: "sanitizer-unavailable" };
    const settings = await aiSettings();
    const mode = ["ADAPTIVE", "RESEARCH"].includes(requestedMode) ? requestedMode : settings.mode;
    const serverBaseUrl = validServerUrl(settings.serverBaseUrl);
    if (mode === "OFF") {
      const result = { status: "OFF", reason: "ai-disabled" };
      aiByTab.set(tabId, result); return result;
    }
    if (!serverBaseUrl) {
      const result = { status: "CONFIG_REQUIRED", reason: "server-url-required" };
      aiByTab.set(tabId, result); return result;
    }
    const endpoint = mode === "RESEARCH" ? "/api/ai/research" : "/api/ai/analyze";
    aiByTab.set(tabId, { status: "RUNNING", mode, startedAt: Date.now() });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), mode === "RESEARCH" ? 190000 : 100000);
    try {
      const evidenceMode = force && mode === "ADAPTIVE" ? "MANUAL" : mode;
      const evidence = Sanitizer.sanitizeEvidence(report, { mode: evidenceMode, evidenceVersion: report.eventCount });
      if (typeof browser !== "undefined") evidence.events = evidence.events.filter((event) => event.type !== "ENVIRONMENT_QUERY");
      const response = await fetch(`${serverBaseUrl}${endpoint}`, {
        method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
        body: JSON.stringify(evidence), cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
      });
      if (!response.ok) throw new Error(`server-${response.status}`);
      const result = Object.assign({ status: "OK", mode, completedAt: Date.now() }, await response.json());
      if (records.get(tabId) && records.get(tabId).site === report.site) aiByTab.set(tabId, result); return result;
    } catch (error) {
      const result = { status: "UNAVAILABLE", mode, reason: error && error.name === "AbortError" ? "timeout" : "server-or-provider-failure", consensus: { state: "LOCAL_ONLY" } };
      aiByTab.set(tabId, result); return result;
    } finally { clearTimeout(timeout); }
  }

  async function maybeAnalyze(tabId, report) {
    const settings = await aiSettings();
    if (settings.mode !== "ADAPTIVE") return;
    const ambiguous = (report.riskScore >= 35 && report.riskScore <= 85 && report.confidenceScore >= 20 && report.confidenceScore <= 78) || Math.abs(report.riskScore - report.confidenceScore) >= 25;
    const state = aiTriggerByTab.get(tabId) || { at: 0, version: -1 };
    if (!ambiguous || Date.now() - state.at < 5000 || state.version === report.eventCount) return;
    aiTriggerByTab.set(tabId, { at: Date.now(), version: report.eventCount });
    await analyzeWithServer(tabId, report, "ADAPTIVE");
  }

  async function activeTab() {
    const tabs = await Adapter.queryTabs({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function requestedRecord(message, sender) {
    let tabId = Number.isInteger(message.tabId) ? message.tabId : sender && sender.tab && sender.tab.id;
    let tabUrl = sender && sender.tab && sender.tab.id === tabId ? sender.tab.url : undefined;
    if (!Number.isInteger(tabId)) {
      const tab = await activeTab(); tabId = tab && tab.id; tabUrl = tab && tab.url;
    } else if (!tabUrl) {
      const tabs = await Adapter.queryTabs({});
      const tab = tabs.find((item) => item.id === tabId);
      tabUrl = tab && tab.url;
    }
    return { tabId, record: await recordFor(tabId, tabUrl || topLevelByTab.get(tabId)) };
  }

  async function handleMessage(message, sender) {
    if (message && message.type === 'PM_OPEN_DASHBOARD') {
      const runtime = typeof browser !== 'undefined' ? browser : chrome;
      if (!String(sender && sender.url || '').startsWith(runtime.runtime.getURL('sidepanel.html'))) return { error: 'unauthorized' };
      let hostedReady = false;
      try { const response = await fetch(`${REMOTE_AI_URL}/dashboard/index.html`, { method: 'HEAD', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000) }); hostedReady = response.ok; } catch (_) { /* Use the bundled dashboard when hosting is unavailable. */ }
      if (!hostedReady) { await runtime.tabs.create({ url: runtime.runtime.getURL(`dashboard/index.html?tabId=${encodeURIComponent(message.tabId)}`) }); return { ok: true, bundled: true }; }
      const tab = await runtime.tabs.create({ url: `${REMOTE_AI_URL}/dashboard/index.html` });
      await Adapter.storageSession.set({ [`pmDashboardSource:${tab.id}`]: message.tabId });
      return { ok: true };
    }
    if (message && message.type === 'PM_DASHBOARD_REQUEST') {
      const permittedOrigins = [REMOTE_AI_URL, 'http://127.0.0.1:4173', 'http://localhost:4173'];
      let page;
      try { page = new URL(sender && sender.url); } catch (_) { return { error: 'unauthorized' }; }
      if (!sender || sender.frameId !== 0 || !permittedOrigins.includes(page.origin) || page.pathname !== '/dashboard/index.html' || !sender.tab) return { error: 'unauthorized' };
      const key = `pmDashboardSource:${sender.tab.id}`;
      const request = message.request;
      if (request && request.type === 'PM_CONNECT_DASHBOARD') {
        const tabs = await Adapter.queryTabs({});
        const source = tabs.filter(tab => tab.id !== sender.tab.id && /^https?:/.test(tab.url || '') && !permittedOrigins.some(origin => (tab.url || '').startsWith(origin + '/dashboard/'))).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
        if (!source) return { error: 'source-tab-required' };
        await Adapter.storageSession.set({ [key]: source.id });
        return { ok: true, sourceSite: Core.registrableDomain(source.url) };
      }
      const stored = await Adapter.storageSession.get(key);
      if (!Number.isInteger(stored[key])) return { error: 'open-from-extension' };
      if (!request || !['PM_GET_REPORT', 'PM_GET_HISTORY', 'PM_RUN_HISTORY_AI'].includes(request.type)) return { error: 'unauthorized' };
      return handleMessage({ type: request.type, site: request.site, hours: request.hours, mode: request.mode, tabId: stored[key] }, { ...sender, dashboardAuthorized: true });
    }
    const senderTabId = sender && sender.tab && sender.tab.id;
    const senderTabUrl = sender && sender.tab && sender.tab.url;
    if (message && message.type === "PM_INIT") {
      if (Number.isInteger(senderTabId)) topLevelByTab.set(senderTabId, senderTabUrl || message.href);
      const record = await recordFor(senderTabId, senderTabUrl || message.href);
      return { config: await configForRecord(record), report: reportFor(record) };
    }
    if (message && message.type === "PM_EVENT_BATCH") {
      return { report: await ingestBatch(senderTabId, senderTabUrl, sender.frameId, Array.isArray(message.events) ? message.events : []) };
    }
    if (message && message.type === "PM_GET_REPORT") {
      const target = await requestedRecord(message, sender);
      return { report: reportFor(target.record), ai: aiByTab.get(target.tabId) || null, aiSettings: await aiSettings() };
    }
    if (message && message.type === "PM_GET_HISTORY") return { history: await trackingHistory() };
    if (message && message.type === "PM_RUN_HISTORY_AI") {
      const runtime = typeof browser !== "undefined" ? browser : chrome;
      if (!sender.dashboardAuthorized && !String(sender && sender.url || "").startsWith(runtime.runtime.getURL("dashboard/"))) return { error: "unauthorized" };
      const evidence = Sanitizer.sanitizeHistory(await trackingHistory(), { site: message.site, hours: message.hours, includeTechnical: typeof browser === "undefined" });
      if (!evidence.evidenceVersion) return { ai: { status: "NO_DATA" } };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 190000);
      try {
        const research = message.mode === "RESEARCH";
        evidence.mode = research ? "RESEARCH" : "MANUAL";
        const response = await fetch(`${REMOTE_AI_URL}/api/ai/${research ? "research" : "analyze"}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(evidence),
          cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal
        });
        if (!response.ok) throw new Error("server-failure");
        return { ai: await response.json(), evaluatedAt: Date.now(), summary: evidence.context, riskIndex: evidence.localAnalysis.riskScore };
      } catch (_) { return { ai: { status: "UNAVAILABLE" } }; }
      finally { clearTimeout(timeout); }
    }
    if (message && message.type === "PM_SET_POLICY") {
      const target = await requestedRecord(message, sender);
      const mode = target.record.controller.setMode(message.mode);
      await persistSiteMode(target.record.site, mode);
      const report = reportFor(target.record);
      await persistRecord(target.tabId, target.record);
      return { ok: true, report, config: await broadcast(target.tabId, target.record) };
    }
    if (message && message.type === "PM_GET_AI_SETTINGS") return { settings: await aiSettings() };
    if (message && message.type === "PM_SET_AI_SETTINGS") {
      return { ok: true, settings: await aiSettings() };
    }
    if (message && message.type === "PM_RUN_AI") {
      const target = await requestedRecord(message, sender);
      return { ai: await analyzeWithServer(target.tabId, reportFor(target.record), message.mode, true) };
    }
    if (message && message.type === "PM_TEST_AI_SERVER") {
      const settings = await aiSettings();
      const serverBaseUrl = validServerUrl(message.serverBaseUrl || settings.serverBaseUrl);
      if (!serverBaseUrl) return { ok: false, reason: "server-url-required" };
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetch(`${serverBaseUrl}/healthz`, { cache: "no-store", credentials: "omit", signal: controller.signal });
        return { ok: response.ok };
      } catch (_) { return { ok: false, reason: "unreachable" }; }
      finally { clearTimeout(timeout); }
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
    if (String(topUrl).startsWith(`${REMOTE_AI_URL}/dashboard/`) || String(details.url).startsWith(`${REMOTE_AI_URL}/dashboard/`)) return;
    if (details.type === "main_frame") topLevelByTab.set(details.tabId, details.url);
    const thirdParty = Core.isThirdParty(details.url, topUrl);
    if (!thirdParty && details.type !== "main_frame") return;
    void ingestBatch(details.tabId, topUrl, details.frameId, [{
      id: `n-${details.requestId}-${Date.now()}`, ts: details.timeStamp || Date.now(),
      type: details.type === "main_frame" ? "navigation.request" : "network.request",
      meta: { resourceType: details.type, thirdParty, operation: "webRequest.observe" }, rawTokens: tokenCandidatesFromUrl(details.url)
    }]);
  });

  Adapter.onNavigation((details) => {
    if (details.frameId !== 0 || !Number.isInteger(details.tabId)) return;
    const current = { ts: details.timeStamp || Date.now(), url: details.url, site: Core.registrableDomain(details.url) };
    const previous = navigationByTab.get(details.tabId);
    navigationByTab.set(details.tabId, current); topLevelByTab.set(details.tabId, details.url);
    if (!previous || current.ts - previous.ts > 2000 || previous.site === current.site) return;
    void ingestBatch(details.tabId, details.url, 0, [{
      id: `bounce-${details.tabId}-${Math.round(current.ts)}`, ts: current.ts, type: "navigation.bounce",
      meta: { operation: details.transitionType || "redirect", durationMs: current.ts - previous.ts }, rawTokens: tokenCandidatesFromUrl(details.url)
    }]);
  });

  void Adapter.configurePanel();
})(typeof globalThis !== "undefined" ? globalThis : this);
