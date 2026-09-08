(function initEvidenceSanitizer(root, factory) {
  const api = factory();
  root.PrivacyMirrorEvidenceSanitizer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function sanitizerFactory() {
  "use strict";
  const TYPE_MAP = {
    "canvas.write": "CANVAS_RENDER", "canvas.read": "CANVAS_READ", "canvas.export": "CANVAS_READ",
    "webgl.parameter": "WEBGL_QUERY", "environment.screen": "ENVIRONMENT_QUERY", "environment.navigator": "ENVIRONMENT_QUERY",
    "crypto.digest": "CRYPTO_DIGEST", "storage.read": "STORAGE_READ", "storage.write": "STORAGE_WRITE",
    "storage.cookie-read": "STORAGE_READ", "storage.cookie-write": "STORAGE_WRITE", "storage.indexeddb-open": "STORAGE_READ",
    "network.request": "NETWORK_REQUEST", "navigation.request": "NAVIGATION", "navigation.decorated": "NAVIGATION", "navigation.bounce": "REDIRECT"
  };
  const SAFE_META = new Set(["algorithm", "byteLength", "hidden", "area", "thirdParty", "resourceType", "operation", "removedCount", "durationMs"]);
  const BANNED_KEYS = /cookie|password|form|raw|token|url|host|domain|canvasdata|requestbody|responsebody/i;

  function sanitizeEvidence(report, options) {
    if (!report || typeof report !== "object") throw new Error("report is required");
    const events = Array.isArray(report.events) ? report.events : [];
    const start = events.length ? events[0].ts : report.startedAt || 0;
    const sanitizedEvents = events.slice(-80).map((event, index) => {
      const metadata = {};
      for (const [key, value] of Object.entries(event.meta || {})) {
        if (!SAFE_META.has(key) || BANNED_KEYS.test(key)) continue;
        if (["string", "number", "boolean"].includes(typeof value)) metadata[key] = typeof value === "string" ? value.slice(0, 80) : value;
      }
      return {
        id: safeId(event.id || `event_${index + 1}`),
        type: TYPE_MAP[event.type] || "ENVIRONMENT_QUERY",
        relativeTimeMs: Math.max(0, Math.round((event.ts || start) - start)),
        party: event.meta && event.meta.thirdParty ? "THIRD_PARTY_A" : "FIRST_PARTY",
        userActivated: Boolean(event.context && event.context.userInitiated),
        metadata
      };
    });
    const protectionsAvailable = (report.counterfactuals || []).filter((item) => item.applicable).map((item) => ({
      action: actionName(item.intervention), privacyGain: Number(item.reduction) || 0, compatibilityCost: Number(item.compatibilityCost) || 0
    }));
    return {
      schemaVersion: "1.0",
      evidenceVersion: Number((options && options.evidenceVersion) || report.eventCount || sanitizedEvents.length),
      mode: (options && options.mode) || "ADAPTIVE",
      localAnalysis: { riskScore: bounded(report.riskScore), confidenceScore: bounded(report.confidenceScore) },
      context: { userInteractionRecent: sanitizedEvents.slice(-3).some((event) => event.userActivated), frameType: "TOP", presentation: "Explain the top observed risk factors briefly in Korean, in at most two sentences. Scores are estimates, not proof of tracking." },
      events: sanitizedEvents,
      protectionsAvailable
    };
  }

  function validateSanitizedPackage(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid evidence package");
    const serialized = JSON.stringify(value);
    if (/https?:\/\//i.test(serialized) || /[?&][\w-]+=/.test(serialized)) throw new Error("raw URL-like data is forbidden");
    for (const key of Object.keys(value)) if (!["schemaVersion", "evidenceVersion", "mode", "localAnalysis", "context", "events", "protectionsAvailable"].includes(key)) throw new Error(`field not allowed: ${key}`);
    if (!Array.isArray(value.events) || value.events.length > 80) throw new Error("events are invalid");
    if (!Array.isArray(value.protectionsAvailable) || value.protectionsAvailable.length > 16) throw new Error("protection candidates are invalid");
    for (const event of value.events) {
      for (const key of Object.keys(event)) if (BANNED_KEYS.test(key)) throw new Error(`raw field forbidden: ${key}`);
      if (!/^event_[a-zA-Z0-9_-]+$/.test(event.id)) throw new Error("event id is invalid");
    }
    return value;
  }

  function safeId(value) { return `event_${String(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}`; }
  function bounded(value) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))); }
  function actionName(value) { return String(value || "").replace(/-/g, "_").toUpperCase(); }
  function sanitizeHistory(history, options) {
    const now = options && options.now || Date.now();
    const hours = Math.max(1, Math.min(168, Number(options && options.hours) || 168));
    const site = options && options.site || "*";
    const totals = { observed: 0, defended: 0, perturbed: 0, cleaned: 0, blocked: 0, rollback: 0, dangerous: 0, suspicious: 0, benign: 0, total: 0 };
    const categories = {};
    let siteCount = 0;
    for (const [name, data] of Object.entries(history && history.sites || {})) {
      if (site !== "*" && name !== site) continue;
      let included = false;
      for (const [hour, bucket] of Object.entries(data.hours || {})) {
        if (Number(hour) < now - hours * 3600000 || Number(hour) > now) continue;
        included = true;
        totals.total += Math.max(0, Number(bucket.total) || 0);
        const outcomes = bucket.outcomes || {};
        for (const key of ["observed", "perturbed", "cleaned", "blocked", "rollback"]) totals[key] += Math.max(0, Number(outcomes[key]) || 0);
        totals.defended += Math.max(Math.max(0, Number(outcomes.defended) || 0), ["perturbed", "cleaned", "blocked"].reduce((sum, key) => sum + Math.max(0, Number(outcomes[key]) || 0), 0));
        for (const key of ["dangerous", "suspicious", "benign"]) totals[key] += Math.max(0, Number(bucket.access && bucket.access[key]) || 0);
        const categoryKeys = ["canvas", "canvas-read", "canvas-write", "webgl", "digest", "storage", "network", "navigation", "other"];
        if (options && options.includeTechnical) categoryKeys.push("environment");
        for (const key of categoryKeys) {
          categories[key] = (categories[key] || 0) + Math.max(0, Number(bucket.categories && bucket.categories[key]) || 0);
        }
      }
      if (included) siteCount += 1;
    }
    const riskIndex = totals.total ? Math.min(100, Math.round(100 * (totals.dangerous + totals.suspicious * 0.5) / totals.total)) : null;
    return {
      schemaVersion: "1.0", evidenceVersion: totals.total, mode: "MANUAL",
      localAnalysis: { riskScore: riskIndex || 0, confidenceScore: 0 },
      context: { frameType: "AGGREGATE", analysisScope: "Historical aggregate counts, not an API sequence. No causal data flow can be inferred. The risk score is a weighted access ratio, not a probability. Explain findings briefly in Korean.", hours, siteCount, totals, categories },
      events: [], protectionsAvailable: []
    };
  }
  return Object.freeze({ sanitizeEvidence, sanitizeHistory, validateSanitizedPackage, TYPE_MAP });
});
