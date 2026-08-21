(function sidepanel() {
  "use strict";
  const api = typeof browser !== "undefined" ? browser : chrome;
  let activeTabId;
  let lastReport;
  const byId = (id) => document.getElementById(id);

  async function queryActive() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    activeTabId = tabs[0] && tabs[0].id;
    return tabs[0];
  }

  function render(report, tab, ai) {
    lastReport = report;
    byId("site").textContent = report ? report.site : (tab && tab.url) || "분석 데이터 없음";
    byId("risk").textContent = report ? report.riskScore : "–";
    byId("confidence").textContent = report ? report.confidenceScore : "–";
    byId("policy").textContent = report ? report.policy.toUpperCase() : "OBSERVE";
    byId("count").textContent = report ? report.eventCount : "0";
    byId("recommendation").textContent = report && report.recommendation.selected.length
      ? `예상 위험 ${report.riskScore} → ${report.recommendation.projectedRisk}, 호환성 비용 ${report.recommendation.compatibilityCost}`
      : "현재는 추가 개입을 권장하지 않습니다.";
    const events = report ? report.events.slice(-12).reverse() : [];
    byId("events").replaceChildren(...events.map((event) => {
      const item = document.createElement("li");
      const title = document.createElement("b"); title.textContent = event.type;
      const time = document.createElement("span"); time.textContent = new Date(event.ts).toLocaleTimeString();
      item.append(title, time); return item;
    }));
    const selected = report ? report.recommendation.selected : [];
    byId("interventions").replaceChildren(...selected.map((name) => {
      const item = document.createElement("li"); item.textContent = name; return item;
    }));
    byId("ai-status").textContent = ai ? ai.status : "OFF";
    byId("ai-summary").textContent = ai && ai.analysis
      ? `${ai.analysis.classification} · AI 확신 ${ai.analysis.aiConfidence} · 정상 가능성 ${ai.analysis.benignPlausibility}`
      : "기본값은 OFF입니다. AI가 없어도 로컬 보호는 동일하게 동작합니다.";
  }

  async function refresh() {
    try {
      const tab = await queryActive();
      const response = await api.runtime.sendMessage({ type: "PM_GET_REPORT", tabId: activeTabId });
      render(response && response.report, tab, response && response.ai);
    } catch (_) { render(null, null, null); }
  }

  byId("toggle").addEventListener("click", async () => {
    const policy = lastReport && lastReport.policy === "protect" ? "observe" : "protect";
    await api.runtime.sendMessage({ type: "PM_SET_POLICY", tabId: activeTabId, policy });
    await refresh();
  });
  if (api.tabs.onActivated) api.tabs.onActivated.addListener(refresh);
  setInterval(refresh, 1000);
  void refresh();
})();
