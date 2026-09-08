(function initPrivacyMirrorCore(root, factory) {
  const api = factory();
  root.PrivacyMirrorCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function privacyMirrorFactory() {
  "use strict";

  const VERSION = "0.2.0";
  const MAX_EVENTS = 1000;
  const CORRELATION_WINDOW_MS = 2500;
  const SCORE_WINDOW_MS = 5 * 60 * 1000;
  const TRACKING_PARAMETERS = Object.freeze([
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "utm_id", "gclid", "dclid", "fbclid", "msclkid", "mc_cid", "mc_eid",
    "_ga", "_gl", "yclid", "ttclid", "twclid", "li_fat_id", "vero_conv",
    "vero_id", "wickedid", "oly_anon_id", "oly_enc_id"
  ]);

  const MULTI_LABEL_SUFFIXES = new Set([
    "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.jp",
    "co.kr", "or.kr", "ne.jp", "com.br", "com.cn", "com.sg", "co.nz"
  ]);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  }

  function registrableDomain(input) {
    let hostname = String(input || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
    try { hostname = new URL(input).hostname.toLowerCase(); } catch (_) { /* hostname input */ }
    if (!hostname || hostname === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return hostname;
    const labels = hostname.split(".").filter(Boolean);
    if (labels.length <= 2) return hostname;
    const lastTwo = labels.slice(-2).join(".");
    return MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
  }

  function isThirdParty(requestUrl, topLevelUrl) {
    try {
      return registrableDomain(new URL(requestUrl).hostname) !== registrableDomain(new URL(topLevelUrl).hostname);
    } catch (_) {
      return false;
    }
  }

  function fnv1a(input, initial) {
    let hash = (initial == null ? 0x811c9dc5 : initial) >>> 0;
    const value = String(input);
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  function deriveSyncSeed(seedMaterial, surface) {
    const first = fnv1a(`${seedMaterial}|${surface}|a`);
    const second = fnv1a(`${surface}|${seedMaterial}|b`, first ^ 0x9e3779b9);
    return [first, second];
  }

  function createPrng(seedMaterial, surface) {
    let [a, b] = deriveSyncSeed(seedMaterial, surface);
    return function next() {
      a |= 0; b |= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (t + (t << 3)) | 0;
      t = (t << 21) | (t >>> 11);
      b = (b + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  function sanitizeKnownTrackingUrl(value, base) {
    try {
      const url = new URL(value, base);
      const removed = [];
      for (const key of [...url.searchParams.keys()]) {
        if (TRACKING_PARAMETERS.includes(key.toLowerCase())) {
          url.searchParams.delete(key);
          removed.push(key);
        }
      }
      return { url: url.href, removed, changed: removed.length > 0 };
    } catch (_) {
      return { url: String(value || ""), removed: [], changed: false };
    }
  }

  function eventCategory(type) {
    if (/^canvas\.(read|export)/.test(type)) return "canvas-read";
    if (/^canvas\./.test(type)) return "canvas-write";
    if (/^webgl\./.test(type)) return "webgl";
    if (/^environment\./.test(type)) return "environment";
    if (type === "crypto.digest") return "digest";
    if (/^storage\./.test(type)) return "storage";
    if (/^network\./.test(type)) return "network";
    if (/^navigation\./.test(type)) return "navigation";
    if (/^compatibility\./.test(type)) return "compatibility";
    return "other";
  }

  class FingerprintSignalProfiler {
    constructor(options) {
      this.now = (options && options.now) || (() => Date.now());
      this.userWindowMs = (options && options.userWindowMs) || 1500;
      this.sequenceWindowMs = (options && options.sequenceWindowMs) || CORRELATION_WINDOW_MS;
      this.lastUserInteraction = -Infinity;
      this.recent = [];
    }

    ingest(input) {
      const event = Object.assign({ id: "", ts: this.now(), frameId: 0, meta: {} }, input);
      if (event.type === "user.interaction") this.lastUserInteraction = event.ts;
      const category = eventCategory(event.type);
      const sinceInput = event.ts - this.lastUserInteraction;
      event.context = Object.assign({}, event.context, {
        category,
        userInitiated: sinceInput >= 0 && sinceInput <= this.userWindowMs,
        hiddenCanvas: Boolean(event.meta && (event.meta.hidden || event.meta.area === 0 || event.meta.offscreen)),
        sequence: []
      });
      const cutoff = event.ts - this.sequenceWindowMs;
      this.recent = this.recent.filter((item) => item.ts >= cutoff);
      const categories = new Set(this.recent.map((item) => eventCategory(item.type)));
      if (category === "digest" && categories.has("canvas-read")) event.context.sequence.push("canvas→digest");
      if (category === "digest" && categories.has("webgl")) event.context.sequence.push("webgl→digest");
      if (category === "network" && categories.has("digest")) event.context.sequence.push("digest→network");
      if (category === "network" && categories.has("canvas-read")) event.context.sequence.push("fingerprint→network");
      if (category === "storage" && categories.has("navigation")) event.context.sequence.push("navigation→storage");
      this.recent.push(event);
      return event;
    }
  }

  class EvidenceGraph {
    constructor(maxNodes) {
      this.maxNodes = maxNodes || MAX_EVENTS;
      this.nodes = [];
      this.edges = [];
    }

    addNode(event) {
      const node = {
        id: event.id,
        ts: event.ts,
        type: event.type,
        category: event.context ? event.context.category : eventCategory(event.type),
        risk: event.riskContribution || 0,
        confidence: event.confidenceContribution || 0,
        label: event.label || event.type,
        meta: scrubMeta(event.meta)
      };
      this.nodes.push(node);
      while (this.nodes.length > this.maxNodes) {
        const removed = this.nodes.shift();
        this.edges = this.edges.filter((edge) => edge.from !== removed.id && edge.to !== removed.id);
      }
      return node;
    }

    connect(from, to, kind, weight) {
      if (!from || !to || from === to) return;
      this.edges.push({ from, to, kind, weight: clamp(weight == null ? 1 : weight, 0, 1) });
      if (this.edges.length > this.maxNodes * 3) this.edges.splice(0, this.edges.length - this.maxNodes * 3);
    }

    snapshot() {
      return { nodes: this.nodes.slice(), edges: this.edges.slice() };
    }
  }

  function scrubMeta(meta) {
    const source = meta || {};
    const allowed = ["algorithm", "byteLength", "hidden", "area", "thirdParty", "resourceType", "operation", "nameLength", "tokenTag", "removedCount", "durationMs", "policy", "intervention"];
    const result = {};
    for (const key of allowed) if (source[key] !== undefined) result[key] = source[key];
    return result;
  }

  class RiskEngine {
    score(event) {
      const category = event.context.category;
      let risk = 0;
      let confidence = 0;
      if (category === "canvas-read") { risk += 14; confidence += 8; }
      if (category === "canvas-write") { risk += 2; confidence += 1; }
      if (category === "webgl") { risk += 9; confidence += 5; }
      if (category === "environment") { risk += 4; confidence += 2; }
      if (category === "digest") { risk += 8; confidence += 5; }
      if (category === "storage") { risk += 5; confidence += 3; }
      if (category === "network" && event.meta.thirdParty) { risk += 10; confidence += 7; }
      if (category === "navigation" && event.meta.tokenTag) { risk += 10; confidence += 8; }
      if (event.context.hiddenCanvas) { risk += 10; confidence += 8; }
      if (!event.context.userInitiated && ["canvas-read", "webgl", "environment"].includes(category)) { risk += 7; confidence += 5; }
      if (event.context.sequence.includes("canvas→digest")) { risk += 8; confidence += 12; }
      if (event.context.sequence.includes("digest→network")) { risk += 10; confidence += 14; }
      if (event.context.sequence.includes("fingerprint→network")) { risk += 7; confidence += 10; }
      if (event.context.sequence.includes("navigation→storage")) { risk += 6; confidence += 8; }
      return { risk: clamp(risk, 0, 40), confidence: clamp(confidence, 0, 40) };
    }
  }

  function scoreEvidenceWindow(events, graph, now) {
    const currentTime = Number.isFinite(now) ? now : Date.now();
    const recent = (events || []).filter((event) => currentTime - event.ts <= SCORE_WINDOW_MS);
    const buckets = new Map();
    for (const event of recent) {
      const category = event.context && event.context.category || eventCategory(event.type);
      if (["other", "compatibility"].includes(category)) continue;
      const age = Math.max(0, currentTime - event.ts);
      const decay = Math.max(0.35, Math.exp(-age / SCORE_WINDOW_MS));
      const values = buckets.get(category) || [];
      values.push({
        risk: (event.riskContribution || 0) * decay,
        confidence: (event.confidenceContribution || 0) * decay
      });
      buckets.set(category, values);
    }

    let riskEvidence = 0;
    let confidenceEvidence = 0;
    const categoryScores = {};
    const repeatWeights = [1, 0.35, 0.18, 0.1];
    for (const [category, values] of buckets) {
      const rankedRisk = values.map((item) => item.risk).sort((a, b) => b - a);
      const rankedConfidence = values.map((item) => item.confidence).sort((a, b) => b - a);
      const risk = rankedRisk.slice(0, repeatWeights.length).reduce((sum, value, index) => sum + value * repeatWeights[index], 0);
      const confidence = rankedConfidence.slice(0, repeatWeights.length).reduce((sum, value, index) => sum + value * repeatWeights[index], 0);
      categoryScores[category] = { risk: Math.round(risk), confidence: Math.round(confidence), samples: values.length };
      riskEvidence += risk;
      confidenceEvidence += confidence;
    }

    const recentIds = new Set(recent.map((event) => event.id));
    const corroboratingEdges = ((graph && graph.edges) || []).filter((edge) =>
      recentIds.has(edge.from) && recentIds.has(edge.to) && ["derived-by-digest", "temporal-egress", "token-lineage", "bounce-persistence"].includes(edge.kind)
    );
    const featureDiversity = new Set([...buckets.keys()].map(mapFeatureCategory).filter(Boolean)).size;
    const diversityFactor = 0.55 + Math.min(1, featureDiversity / 5) * 0.35;
    const riskScore = clamp(Math.round(100 * (1 - Math.exp(-riskEvidence / 72))), 0, 100);
    const confidenceBase = 100 * (1 - Math.exp(-confidenceEvidence / 78));
    const confidenceScore = clamp(Math.round(confidenceBase * diversityFactor + Math.min(20, corroboratingEdges.length * 4)), 0, 100);
    return {
      riskScore,
      confidenceScore,
      categoryScores,
      evidenceWindowMs: SCORE_WINDOW_MS,
      corroboratingEdges: corroboratingEdges.length,
      featureDiversity
    };
  }

  class ProtectionController {
    constructor(options) {
      const config = options || {};
      this.mode = ["auto", "observe", "protect"].includes(config.mode) ? config.mode : "auto";
      this.effective = "observe";
      this.reason = "collecting-evidence";
      this.protectRisk = config.protectRisk || 60;
      this.protectConfidence = config.protectConfidence || 50;
      this.releaseRisk = config.releaseRisk || 40;
      this.releaseConfidence = config.releaseConfidence || 30;
      this.rollbackCooldownMs = config.rollbackCooldownMs || 30000;
      this.rollbackUntil = 0;
    }

    setMode(mode) {
      this.mode = ["auto", "observe", "protect"].includes(mode) ? mode : "auto";
      return this.mode;
    }

    registerRollback(at) {
      this.rollbackUntil = Math.max(this.rollbackUntil, (Number(at) || Date.now()) + this.rollbackCooldownMs);
      this.effective = "observe";
      this.reason = "compatibility-rollback";
    }

    reconcile(report, at) {
      const now = Number(at) || Date.now();
      if (now < this.rollbackUntil) {
        this.effective = "observe";
        this.reason = "compatibility-cooldown";
      } else if (this.mode === "observe") {
        this.effective = "observe";
        this.reason = "manual-observe";
      } else if (this.mode === "protect") {
        this.effective = "protect";
        this.reason = "manual-protect";
      } else if (this.effective === "protect") {
        if (report.riskScore <= this.releaseRisk || report.confidenceScore <= this.releaseConfidence) {
          this.effective = "observe";
          this.reason = "auto-evidence-released";
        } else {
          this.reason = "auto-protect-hold";
        }
      } else if (report.riskScore >= this.protectRisk && report.confidenceScore >= this.protectConfidence) {
        this.effective = "protect";
        this.reason = "auto-threshold-met";
      } else {
        this.effective = "observe";
        this.reason = "auto-collecting-evidence";
      }
      return this.snapshot(now);
    }

    snapshot(now) {
      return {
        mode: this.mode,
        effective: this.effective,
        reason: this.reason,
        rollbackUntil: Math.max(0, this.rollbackUntil - (Number(now) || Date.now()))
      };
    }
  }

  class TokenLineage {
    constructor(maxEntries) {
      this.maxEntries = maxEntries || 256;
      this.byTag = new Map();
    }

    observe(tokenTag, observation) {
      if (!tokenTag) return [];
      const safe = {
        id: observation.id,
        ts: observation.ts,
        layer: observation.layer,
        site: observation.site,
        thirdParty: Boolean(observation.thirdParty)
      };
      const chain = this.byTag.get(tokenTag) || [];
      chain.push(safe);
      this.byTag.set(tokenTag, chain.slice(-8));
      if (this.byTag.size > this.maxEntries) this.byTag.delete(this.byTag.keys().next().value);
      return chain.slice(0, -1).map((previous) => ({ previous, current: safe, tokenTag }));
    }
  }

  class CompatibilityGuard {
    constructor(options) {
      this.failureThreshold = (options && options.failureThreshold) || 3;
      this.windowMs = (options && options.windowMs) || 10000;
      this.failures = [];
      this.rollbackCount = 0;
    }

    observe(event) {
      if (!/^compatibility\.(error|resource-failure|long-task)$/.test(event.type)) return null;
      this.failures.push(event.ts);
      this.failures = this.failures.filter((ts) => ts >= event.ts - this.windowMs);
      if (this.failures.length >= this.failureThreshold) {
        this.failures.length = 0;
        this.rollbackCount += 1;
        return { action: "rollback", policy: "observe", reason: "compatibility-failure-threshold" };
      }
      return null;
    }
  }

  const INTERVENTIONS = Object.freeze([
    { id: "canvas-perturb", privacyGain: 26, compatibilityCost: 1, requires: ["canvas"] },
    { id: "webgl-generalize", privacyGain: 18, compatibilityCost: 3, requires: ["webgl"] },
    { id: "environment-bucket", privacyGain: 10, compatibilityCost: 2, requires: ["environment"] },
    { id: "tracking-parameter-cleaner", privacyGain: 14, compatibilityCost: 1, requires: ["navigation"] },
    { id: "third-party-token-guard", privacyGain: 22, compatibilityCost: 4, requires: ["network", "token"] },
    { id: "strict-canvas-block", privacyGain: 36, compatibilityCost: 10, requires: ["canvas"] }
  ]);

  function counterfactual(report, intervention) {
    const activeCategories = new Set(report.categories || []);
    const applicable = intervention.requires.some((requirement) => activeCategories.has(requirement));
    const confidenceFactor = clamp((report.confidenceScore || 0) / 100, 0.25, 1);
    const reduction = applicable ? Math.round(intervention.privacyGain * confidenceFactor) : 0;
    return {
      intervention: intervention.id,
      before: report.riskScore,
      after: clamp(report.riskScore - reduction, 0, 100),
      reduction,
      compatibilityCost: intervention.compatibilityCost,
      applicable
    };
  }

  function optimizeInterventions(report, options) {
    const targetRisk = (options && options.targetRisk) == null ? 35 : options.targetRisk;
    const lambda = (options && options.lambda) == null ? 2 : options.lambda;
    const allowStrict = Boolean(options && options.allowStrict) && report.confidenceScore >= 90;
    const candidates = INTERVENTIONS
      .filter((item) => item.id !== "strict-canvas-block" || allowStrict)
      .map((item) => counterfactual(report, item))
      .filter((item) => item.applicable && item.reduction > 0);
    let best = { selected: [], projectedRisk: report.riskScore, compatibilityCost: 0, objective: report.riskScore };
    for (let mask = 1; mask < (1 << candidates.length); mask += 1) {
      const selected = [];
      let reduction = 0;
      let cost = 0;
      for (let i = 0; i < candidates.length; i += 1) {
        if (mask & (1 << i)) { selected.push(candidates[i].intervention); reduction += candidates[i].reduction; cost += candidates[i].compatibilityCost; }
      }
      const projectedRisk = clamp(report.riskScore - reduction, 0, 100);
      const unmetPenalty = projectedRisk > targetRisk ? (projectedRisk - targetRisk) * 3 : 0;
      const objective = projectedRisk + lambda * cost + unmetPenalty;
      if (objective < best.objective || (objective === best.objective && cost < best.compatibilityCost)) {
        best = { selected, projectedRisk, compatibilityCost: cost, objective };
      }
    }
    return best;
  }

  class SessionAnalyzer {
    constructor(options) {
      const config = options || {};
      this.site = config.site || "unknown";
      this.startedAt = config.startedAt || Date.now();
      this.maxEvents = config.maxEvents || MAX_EVENTS;
      this.events = [];
      this.profiler = new FingerprintSignalProfiler(config);
      this.graph = new EvidenceGraph(this.maxEvents);
      this.riskEngine = new RiskEngine();
      this.lineage = new TokenLineage();
      this.compatibility = new CompatibilityGuard(config.compatibility);
      this.riskEvidence = 0;
      this.confidenceEvidence = 0;
      this.categories = new Set();
      this.lastByCategory = new Map();
      this.policy = "observe";
      this.rollbacks = [];
    }

    ingest(input) {
      const sequence = this.events.length + 1;
      const event = this.profiler.ingest(Object.assign({}, input, { id: input.id || `e${sequence}` }));
      const contribution = this.riskEngine.score(event);
      event.riskContribution = contribution.risk;
      event.confidenceContribution = contribution.confidence;
      this.riskEvidence += contribution.risk;
      this.confidenceEvidence += contribution.confidence;
      this.categories.add(mapFeatureCategory(event.context.category));
      this.events.push(event);
      if (this.events.length > this.maxEvents) this.events.shift();
      this.graph.addNode(event);
      this.correlate(event);
      if (event.meta && event.meta.tokenTag) {
        const links = this.lineage.observe(event.meta.tokenTag, {
          id: event.id, ts: event.ts, layer: event.context.category, site: this.site, thirdParty: event.meta.thirdParty
        });
        for (const link of links) this.graph.connect(link.previous.id, link.current.id, "token-lineage", 0.95);
      }
      const rollback = this.compatibility.observe(event);
      if (rollback) {
        this.policy = rollback.policy;
        this.rollbacks.push(Object.assign({ ts: event.ts }, rollback));
      }
      return this.report();
    }

    correlate(event) {
      const category = event.context.category;
      const previousCategories = ["canvas-read", "webgl", "environment", "digest", "storage", "navigation"];
      for (const previousCategory of previousCategories) {
        const previous = this.lastByCategory.get(previousCategory);
        if (!previous || event.ts - previous.ts > CORRELATION_WINDOW_MS) continue;
        if (category === "digest" && ["canvas-read", "webgl", "environment"].includes(previousCategory)) this.graph.connect(previous.id, event.id, "derived-by-digest", 0.9);
        if (category === "network" && ["canvas-read", "webgl", "environment", "digest", "storage"].includes(previousCategory)) this.graph.connect(previous.id, event.id, "temporal-egress", event.meta.thirdParty ? 0.9 : 0.55);
        if (category === "storage" && previousCategory === "navigation") this.graph.connect(previous.id, event.id, "bounce-persistence", 0.8);
      }
      this.lastByCategory.set(category, event);
    }

    report() {
      const updatedAt = this.events.length ? this.events[this.events.length - 1].ts : this.startedAt;
      const scoring = scoreEvidenceWindow(this.events, this.graph.snapshot(), updatedAt);
      const base = {
        version: VERSION,
        site: this.site,
        startedAt: this.startedAt,
        updatedAt,
        riskScore: scoring.riskScore,
        confidenceScore: scoring.confidenceScore,
        policy: this.policy,
        categories: [...this.categories].filter(Boolean),
        eventCount: this.events.length,
        rollbacks: this.rollbacks.slice(-10),
        events: this.events.slice(-100).map(publicEvent),
        graph: this.graph.snapshot(),
        scoring
      };
      base.counterfactuals = INTERVENTIONS.map((item) => counterfactual(base, item));
      base.recommendation = optimizeInterventions(base);
      return base;
    }
  }

  function mapFeatureCategory(category) {
    if (category.startsWith("canvas")) return "canvas";
    if (category === "webgl") return "webgl";
    if (category === "environment") return "environment";
    if (category === "navigation") return "navigation";
    if (category === "network") return "network";
    if (category === "storage") return "token";
    if (category === "digest") return "digest";
    return "";
  }

  function publicEvent(event) {
    return {
      id: event.id,
      ts: event.ts,
      type: event.type,
      context: event.context,
      meta: scrubMeta(event.meta),
      accessClass: classifyAccess(event),
      riskContribution: event.riskContribution,
      confidenceContribution: event.confidenceContribution
    };
  }

  function mergeTrackingHistory(current, site, events, now, retentionMs) {
    const currentTime = Number.isFinite(now) ? now : Date.now();
    const retention = Number.isFinite(retentionMs) ? retentionMs : 7 * 24 * 60 * 60 * 1000;
    const cutoffHour = Math.floor((currentTime - retention) / 3600000) * 3600000;
    const history = current && typeof current === "object" ? JSON.parse(JSON.stringify(current)) : { version: 1, sites: {} };
    history.version = 1;
    history.sites = history.sites && typeof history.sites === "object" ? history.sites : {};
    for (const [storedSite, siteData] of Object.entries(history.sites)) {
      siteData.hours = siteData.hours && typeof siteData.hours === "object" ? siteData.hours : {};
      for (const hour of Object.keys(siteData.hours)) if (Number(hour) < cutoffHour) delete siteData.hours[hour];
      if (!Object.keys(siteData.hours).length) delete history.sites[storedSite];
    }
    if (site && site !== "unknown") {
      const siteData = history.sites[site] || { hours: {} };
      for (const event of events || []) {
        const timestamp = Math.max(currentTime - retention, Math.min(currentTime, Number(event.ts) || currentTime));
        const hour = String(Math.floor(timestamp / 3600000) * 3600000);
        const empty = { observed: 0, defended: 0, perturbed: 0, cleaned: 0, blocked: 0, rollback: 0 };
        const emptyAccess = { dangerous: 0, suspicious: 0, benign: 0 };
        const bucket = siteData.hours[hour] || { total: 0, risk: 0, confidence: 0, categories: {}, outcomes: empty, access: emptyAccess };
        const category = event.context && event.context.category || "other";
        const intervention = event.meta && event.meta.intervention;
        const outcome = ["perturbed", "cleaned", "blocked"].includes(intervention) ? intervention : /^compatibility\./.test(event.type) ? "rollback" : "observed";
        bucket.outcomes = Object.assign({}, empty, bucket.outcomes || {});
        bucket.access = Object.assign({}, emptyAccess, bucket.access || {});
        bucket.total += 1;
        bucket.risk += Number(event.riskContribution) || 0;
        bucket.confidence += Number(event.confidenceContribution) || 0;
        bucket.categories[category] = (bucket.categories[category] || 0) + 1;
        bucket.outcomes[outcome] += 1;
        if (["perturbed", "cleaned", "blocked"].includes(outcome)) bucket.outcomes.defended += 1;
        bucket.access[classifyAccess(event)] += 1;
        siteData.hours[hour] = bucket;
      }
      if (Object.keys(siteData.hours).length) history.sites[site] = siteData;
    }
    history.updatedAt = currentTime;
    return history;
  }

  function classifyAccess(event) {
    const risk = Number(event && event.riskContribution) || 0;
    const confidence = Number(event && event.confidenceContribution) || 0;
    const context = event && event.context || {};
    const meta = event && event.meta || {};
    const sequence = Array.isArray(context.sequence) ? context.sequence : [];
    if ((risk >= 18 && confidence >= 8) || (meta.thirdParty && sequence.some((item) => /network/.test(item)))) return "dangerous";
    if (["perturbed", "cleaned", "blocked"].includes(meta.intervention)) return "suspicious";
    if (risk >= 7 || confidence >= 5 || meta.thirdParty) return "suspicious";
    return "benign";
  }

  function validationMetrics(cases) {
    const totals = { tp: 0, tn: 0, fp: 0, fn: 0 };
    for (const item of cases) {
      const predicted = item.riskScore >= (item.threshold == null ? 60 : item.threshold) && item.confidenceScore >= (item.confidenceThreshold == null ? 50 : item.confidenceThreshold);
      if (predicted && item.expected) totals.tp += 1;
      else if (predicted) totals.fp += 1;
      else if (item.expected) totals.fn += 1;
      else totals.tn += 1;
    }
    const precision = totals.tp / Math.max(1, totals.tp + totals.fp);
    const recall = totals.tp / Math.max(1, totals.tp + totals.fn);
    return Object.assign(totals, {
      precision,
      recall,
      f1: 2 * precision * recall / Math.max(Number.EPSILON, precision + recall)
    });
  }

  return Object.freeze({
    VERSION,
    MAX_EVENTS,
    CORRELATION_WINDOW_MS,
    SCORE_WINDOW_MS,
    TRACKING_PARAMETERS,
    registrableDomain,
    isThirdParty,
    fnv1a,
    deriveSyncSeed,
    createPrng,
    sanitizeKnownTrackingUrl,
    FingerprintSignalProfiler,
    EvidenceGraph,
    RiskEngine,
    scoreEvidenceWindow,
    ProtectionController,
    TokenLineage,
    CompatibilityGuard,
    INTERVENTIONS,
    counterfactual,
    optimizeInterventions,
    SessionAnalyzer,
    classifyAccess,
    mergeTrackingHistory,
    validationMetrics
  });
});
