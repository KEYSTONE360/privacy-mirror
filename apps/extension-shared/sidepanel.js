(function sidepanel() {
  "use strict";
  const api = typeof browser !== "undefined" ? browser : chrome;
  const byId = (id) => document.getElementById(id);
  let activeTabId;
  let lastReport;
  let refreshing = false;
  let initialAiStarted = false;

  const reasonText = {
    "collecting-evidence": "초기 근거를 수집하고 있습니다.",
    "auto-collecting-evidence": "자동 모드에서 보호 기준을 확인하고 있습니다.",
    "auto-threshold-met": "위험도와 근거 확신도가 보호 기준을 충족했습니다.",
    "auto-protect-hold": "보호 기준이 유지되어 개입을 계속합니다.",
    "auto-evidence-released": "위험 신호가 낮아져 관찰 상태로 완화했습니다.",
    "manual-observe": "이 사이트를 관찰 전용으로 고정했습니다.",
    "manual-protect": "이 사이트를 보호 모드로 고정했습니다.",
    "compatibility-rollback": "페이지 오류를 감지해 보호를 되돌렸습니다.",
    "compatibility-cooldown": "호환성 확인을 위해 잠시 관찰 모드를 유지합니다."
  };

  async function queryActive() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    activeTabId = tabs[0] && tabs[0].id;
    return tabs[0];
  }

  async function ensureFirefoxAiConsent(mode) {
    return mode !== "OFF";
  }

  function setScore(id, value) {
    const score = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
    if (window.PMEffects) window.PMEffects.number(byId(id), Number.isFinite(value) ? score : null);
    else byId(id).textContent = Number.isFinite(value) ? String(score) : "–";
    byId(`${id}-ring`).style.setProperty("--score", score);
  }

  function renderProtection(report) {
    const protection = report && report.protection || { mode: "auto", effective: "observe", reason: "collecting-evidence" };
    const policy = byId("policy");
    policy.textContent = protection.effective === "protect" ? "보호 중" : "관찰 중";
    policy.className = `state-pill ${protection.effective}`;
    if (window.PMEffects) window.PMEffects.protection(protection.effective === "protect");
    byId("protection-reason").textContent = reasonText[protection.reason] || protection.reason;
    document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === protection.mode));
  }

  function renderAi(ai, settings) {
    const labels = { canvas: "Canvas 읽기", webgl: "WebGL 조회", environment: "환경 조회", crypto: "해시 연산", storage: "저장소 접근", network: "외부 요청", navigation: "이동·링크" };
    const factors = {};
    for (const event of lastReport && lastReport.events || []) {
      if (Date.now() - event.ts > 300000) continue;
      const name = labels[event.type.split(".")[0]] || "기타 신호";
      factors[name] = (factors[name] || 0) + Math.max(0, Number(event.riskContribution) || 0);
    }
    byId("ai-factors").replaceChildren(...Object.entries(factors).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, value]) => {
      const item = document.createElement("li"); item.textContent = `${name} · +${Math.round(value)}`; return item;
    }));
    byId("ai-numbers").textContent = `현재 위험도 ${lastReport ? lastReport.riskScore : "–"}/100 · AI 확신도 ${ai && ai.analysis ? ai.analysis.aiConfidence : "–"}/100`;
    const status = ai && ai.status || settings && settings.mode || "OFF";
    const badge = byId("ai-status");
    badge.textContent = status;
    badge.className = `state-pill ${status === "OK" ? "ok" : status === "RUNNING" ? "running" : ["UNAVAILABLE", "CONFIG_REQUIRED"].includes(status) ? "error" : "off"}`;
    if (status === "RUNNING") byId("ai-summary").textContent = "NVIDIA NIM이 최소화된 근거를 분석하고 있습니다…";
    else if (ai && ai.analysis) {
      const names = { LIKELY_TRACKING: "추적 가능성 높음", POSSIBLE_TRACKING: "추적 의심", AMBIGUOUS: "판단 근거 부족", LIKELY_BENIGN: "정상 사용 가능성 높음" };
      byId("ai-summary").textContent = `${names[ai.analysis.classification] || "판단 보류"}. ${(ai.analysis.explanation || []).slice(0, 2).join(" ").slice(0, 220)}`;
    }
    else if (status === "SKIPPED") byId("ai-summary").textContent = "로컬 근거가 충분해 AI 호출을 생략했습니다.";
    else if (status === "UNAVAILABLE") byId("ai-summary").textContent = "원격 서버 또는 모델 호출에 실패했습니다. 브라우저 내 보호는 계속 동작합니다.";
    else if (status === "CONFIG_REQUIRED") byId("ai-summary").textContent = "고정 분석 서버 설정을 확인해 주세요.";
    else byId("ai-summary").textContent = "AI 분석을 준비하고 있습니다.";
  }

  function render(report, tab, ai, settings) {
    lastReport = report;
    byId("site").textContent = report && report.site || tab && tab.url || "분석 데이터 없음";
    setScore("risk", report && report.riskScore);
    setScore("confidence", report && report.confidenceScore);
    byId("count").textContent = report ? String(report.eventCount) : "0";
    renderProtection(report);
    const recommendation = report && report.recommendation;
    byId("recommendation").textContent = recommendation && recommendation.selected.length
      ? `현재 ${report.riskScore}에서 ${recommendation.projectedRisk}까지 낮출 수 있으며 호환성 비용은 ${recommendation.compatibilityCost}입니다.`
      : "현재는 추가 개입보다 관찰 유지가 적합합니다.";
    byId("interventions").replaceChildren(...(recommendation ? recommendation.selected : []).map((name) => {
      const item = document.createElement("li"); item.textContent = name; return item;
    }));
    const events = report ? report.events.slice(-14).reverse() : [];
    byId("events").replaceChildren(...events.map((event) => {
      const item = document.createElement("li");
      if ((event.riskContribution || 0) >= 20) item.className = "high";
      const dot = document.createElement("i");
      const title = document.createElement("b"); title.textContent = event.type;
      const time = document.createElement("span"); time.textContent = new Date(event.ts).toLocaleTimeString();
      item.append(dot, title, time); return item;
    }));
    renderAi(ai, settings);
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const tab = await queryActive();
      const response = await api.runtime.sendMessage({ type: "PM_GET_REPORT", tabId: activeTabId });
      render(response && response.report, tab, response && response.ai, response && response.aiSettings);
    } catch (_) { render(null, null, null, null); }
    finally { refreshing = false; }
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await api.runtime.sendMessage({ type: "PM_SET_POLICY", tabId: activeTabId, mode: button.dataset.mode });
      if (response && response.report) render(response.report, null, null, null);
      await refresh();
    } finally { button.disabled = false; }
  }));

  byId("run-ai").addEventListener("click", async () => {
    const button = byId("run-ai"); button.disabled = true; button.textContent = "분석 중";
    byId("ai-status").textContent = "RUNNING"; byId("ai-status").className = "state-pill running";
    try {
      if (!await ensureFirefoxAiConsent("ADAPTIVE")) {
        byId("ai-summary").textContent = "AI 분석 권한이 없어 실행하지 않았습니다.";
        return;
      }
      const response = await api.runtime.sendMessage({ type: "PM_RUN_AI", tabId: activeTabId, mode: "ADAPTIVE" });
      renderAi(response && response.ai, { mode: "ADAPTIVE" });
    } finally { button.disabled = false; button.textContent = "다시 분석"; }
  });

  byId("open-dashboard").addEventListener("click", async () => {
    if (typeof browser !== 'undefined') await ensureFirefoxAiConsent('ADAPTIVE');
    await api.runtime.sendMessage({ type: 'PM_OPEN_DASHBOARD', tabId: activeTabId });
  });

  if (api.tabs.onActivated) api.tabs.onActivated.addListener(refresh);
  setInterval(refresh, 1500);
  async function start() {
    await refresh();
    if (initialAiStarted || !Number.isInteger(activeTabId)) return;
    initialAiStarted = true;
    if (!await ensureFirefoxAiConsent("ADAPTIVE")) { byId("ai-summary").textContent = "AI 분석 권한이 없어 실행하지 않았습니다."; return; }
    byId("ai-status").textContent = "RUNNING"; byId("ai-status").className = "state-pill running";
    const response = await api.runtime.sendMessage({ type: "PM_RUN_AI", tabId: activeTabId, mode: "ADAPTIVE" });
    renderAi(response && response.ai, { mode: "ADAPTIVE" });
  }
  void start();
})();
