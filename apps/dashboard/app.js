(function liveDashboard() {
  "use strict";
  const api = window.PMDashboardConnection || (typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" && chrome.runtime ? chrome : null);
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const requestedTabId = params.has("tabId") ? Number(params.get("tabId")) : null;
  let historyAiRunning = false;
  let extensionConnected = false;
  let historyState = { sites: {} };
  const colors = { canvas: "#ff5e7b", webgl: "#8b5cf6", environment: "#31d8ff", digest: "#ffc857", storage: "#62e6a7", network: "#ff8a4c", navigation: "#d39bff", other: "#687080" };
  function number(id, value) { if (window.PMEffects) window.PMEffects.number($(id), value); else $(id).textContent = value.toLocaleString(); }

  function svgElement(name, attrs) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attrs || {})) element.setAttribute(key, value);
    return element;
  }

  function featureCategory(node) {
    const value = node.category || "other";
    if (value.startsWith("canvas")) return "canvas";
    return colors[value] ? value : "other";
  }

  function nodePositions(count) {
    if (!count) return [];
    const columns = Math.min(4, count);
    return Array.from({ length: count }, (_, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      return [110 + column * 195 + (row % 2) * 42, 95 + row * 135];
    });
  }

  function renderGraph(graph) {
    const svg = $("graph-canvas"); svg.replaceChildren();
    const nodes = (graph && graph.nodes || []).slice(-12);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const positions = nodePositions(nodes.length);
    const indexById = new Map(nodes.map((node, index) => [node.id, index]));
    for (const edge of (graph && graph.edges || []).filter((item) => nodeIds.has(item.from) && nodeIds.has(item.to))) {
      const from = positions[indexById.get(edge.from)]; const to = positions[indexById.get(edge.to)];
      if (!from || !to) continue;
      const line = svgElement("line", { x1: from[0], y1: from[1], x2: to[0], y2: to[1], class: "edge" });
      line.style.opacity = String(Math.max(0.25, edge.weight || 0.5)); svg.append(line);
    }
    nodes.forEach((node, index) => {
      const position = positions[index]; const category = featureCategory(node);
      const group = svgElement("g", { class: "node" });
      const circle = svgElement("circle", { cx: position[0], cy: position[1], r: 36 }); circle.style.stroke = colors[category];
      const title = svgElement("text", { x: position[0], y: position[1] - 3, "text-anchor": "middle" }); title.textContent = category.toUpperCase();
      const score = svgElement("text", { x: position[0], y: position[1] + 14, "text-anchor": "middle", class: "node-score" }); score.textContent = `+${node.risk || 0}`;
      group.append(circle, title, score); svg.append(group);
    });
    const categories = [...new Set(nodes.map(featureCategory))];
    $("legend").replaceChildren(...categories.map((category) => { const span = document.createElement("span"); span.textContent = category; span.style.setProperty("--dot", colors[category]); return span; }));
  }

  function renderTimeline(events) {
    $("timeline").replaceChildren(...(events || []).slice(-18).reverse().map((event) => {
      const item = document.createElement("li");
      const dot = document.createElement("i"); dot.style.background = colors[featureCategory({ category: event.context && event.context.category })];
      const body = document.createElement("div"); const title = document.createElement("b"); title.textContent = event.type;
      const detail = document.createElement("span"); detail.textContent = `위험 +${event.riskContribution || 0} · 확신 +${event.confidenceContribution || 0}`; body.append(title, detail);
      const time = document.createElement("time"); time.textContent = new Date(event.ts).toLocaleTimeString();
      item.append(dot, body, time); return item;
    }));
  }

  function render(report, ai) {
    if (!report) return;
    $("before").textContent = report.riskScore;
    $("after").textContent = report.recommendation.projectedRisk;
    $("recommendation").textContent = report.recommendation.selected.length
      ? `호환성 비용 ${report.recommendation.compatibilityCost}로 위험도를 ${report.recommendation.projectedRisk}까지 낮추는 조합입니다.`
      : "현재 점수에서는 추가 개입보다 관찰을 유지합니다.";
    $("interventions").replaceChildren(...report.recommendation.selected.map((name) => { const item = document.createElement("li"); item.textContent = name; return item; }));
    renderGraph(report.graph); renderTimeline(report.events);
  }

  function sumOutcomes(target, source) {
    const outcomes = source || {};
    for (const key of ["observed", "perturbed", "cleaned", "blocked", "rollback"]) target[key] += Number(outcomes[key]) || 0;
    target.defended += Math.max(Number(outcomes.defended) || 0, ["perturbed", "cleaned", "blocked"].reduce((sum, key) => sum + (Number(outcomes[key]) || 0), 0));
  }
  function sumAccess(target, source) { for (const key of ["dangerous", "suspicious", "benign"]) target[key] += Number(source && source[key]) || 0; }
  const categoryLabels = { canvas: "Canvas", "canvas-read": "Canvas 읽기", "canvas-write": "Canvas 쓰기", webgl: "WebGL", environment: "환경 정보", digest: "해시 연산", storage: "저장소", network: "외부 요청", navigation: "페이지 이동", other: "기타" };
  function percent(numerator, denominator) { return denominator > 0 ? Math.round(numerator / denominator * 100) : 0; }
  function riskIndex(access, total) { return percent((access.dangerous || 0) + (access.suspicious || 0) * 0.5, total); }
  function severityInfo(value) { return value >= 55 ? { label: "높음", className: "high" } : value >= 25 ? { label: "주의", className: "medium" } : { label: "낮음", className: "low" }; }
  function severityCell(value) { const info = severityInfo(value); const span = document.createElement("span"); span.className = `severity ${info.className}`; span.textContent = info.label; return span; }
  function topCategory(categories) { const entry = Object.entries(categories || {}).sort((a, b) => b[1] - a[1])[0]; return entry ? categoryLabels[entry[0]] || entry[0] : "–"; }
  function formatAgo(timestamp) { const diff = Math.max(0, Date.now() - timestamp); if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}분 전`; if (diff < 86400000) return `${Math.round(diff / 3600000)}시간 전`; return `${Math.round(diff / 86400000)}일 전`; }

  function filteredHistory() {
    const selected = $("site-filter").value;
    const rangeHours = Number($("range-filter").value) || 168;
    const cutoff = Date.now() - rangeHours * 3600000;
    const rows = [];
    for (const [site, data] of Object.entries(historyState.sites || {})) {
      if (selected !== "*" && site !== selected) continue;
      for (const [hour, bucket] of Object.entries(data.hours || {})) if (Number(hour) >= cutoff) rows.push({ site, hour: Number(hour), bucket });
    }
    return rows.sort((a, b) => a.hour - b.hour);
  }

  function renderHistoryChart(rows) {
    const svg = $("history-chart"); svg.replaceChildren();
    const byHour = new Map();
    for (const row of rows) {
      const item = byHour.get(row.hour) || { total: 0, defended: 0 };
      item.total += Number(row.bucket.total) || 0;
      const outcomes = row.bucket.outcomes || {};
      item.defended += Math.max(Number(outcomes.defended) || 0, ["perturbed", "cleaned", "blocked"].reduce((sum, key) => sum + (Number(outcomes[key]) || 0), 0));
      byHour.set(row.hour, item);
    }
    const points = [...byHour.entries()].slice(-168);
    $("history-empty").hidden = points.length > 0;
    if (!points.length) return;
    const width = 1000; const height = 235; const left = 24; const bottom = 260;
    const max = Math.max(1, ...points.map(([, item]) => item.total));
    const slot = width / points.length; const barWidth = Math.max(2, Math.min(14, slot * 0.58));
    points.forEach(([hour, item], index) => {
      const x = left + index * slot;
      const totalHeight = item.total / max * height;
      const defendedHeight = item.defended / max * height;
      const total = svgElement("rect", { x, y: bottom - totalHeight, width: barWidth, height: totalHeight, rx: 3, class: "history-bar detected-bar" });
      const defended = svgElement("rect", { x, y: bottom - defendedHeight, width: barWidth, height: defendedHeight, rx: 3, class: "history-bar defended-bar" });
      const title = svgElement("title"); title.textContent = `${new Date(hour).toLocaleString()} · 감지 ${item.total} · 방어 ${item.defended}`;
      total.append(title); svg.append(total, defended);
      if (index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 6)) === 0) {
        const label = svgElement("text", { x, y: 287, class: "axis-label" }); label.textContent = new Date(hour).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit" }); svg.append(label);
      }
    });
  }

  function renderHistory() {
    if (!historyAiRunning && $("history-ai-scope").dataset.selection && $("history-ai-scope").dataset.selection !== `${$("site-filter").value}:${$("range-filter").value}`) {
      $("history-ai-status").textContent = "필터가 변경됐습니다. 아래 결과는 이전 선택의 평가입니다. 다시 실행해 주세요.";
    }
    const rows = filteredHistory();
    const totals = { total: 0, observed: 0, defended: 0, perturbed: 0, cleaned: 0, blocked: 0, rollback: 0, dangerous: 0, suspicious: 0, benign: 0 };
    const categories = {};
    const activeSites = new Set();
    for (const row of rows) { totals.total += Number(row.bucket.total) || 0; sumOutcomes(totals, row.bucket.outcomes); sumAccess(totals, row.bucket.access); activeSites.add(row.site); for (const [name, count] of Object.entries(row.bucket.categories || {})) categories[name] = (categories[name] || 0) + Number(count || 0); }
    const weightedRisk = riskIndex(totals, totals.total);
    const defendedRate = percent(totals.defended, totals.total);
    number("history-total", totals.total);
    number("history-defended", totals.defended);
    number("overall-risk-index", weightedRisk);
    $("defense-rate").textContent = totals.total ? `${defendedRate}%` : "–";
    $("defense-detail").textContent = totals.total ? `실제 방어 ${totals.defended.toLocaleString()} / 관찰 ${totals.total.toLocaleString()}건` : "선택 범위에 기록 없음";
    $("risk-label").textContent = weightedRisk >= 55 ? "우선 확인 필요" : weightedRisk >= 25 ? "주의 신호 관찰" : totals.total ? "낮은 위험 집중도" : "분석 대기";
    $("risk-track-fill").style.width = `${weightedRisk}%`;
    $("history-perturbed").textContent = totals.perturbed.toLocaleString();
    $("history-cleaned").textContent = totals.cleaned.toLocaleString();
    $("history-blocked").textContent = totals.blocked.toLocaleString();
    $("history-rollback").textContent = totals.rollback.toLocaleString();
    $("history-dangerous").textContent = totals.dangerous.toLocaleString();
    $("history-suspicious").textContent = totals.suspicious.toLocaleString();
    $("history-benign").textContent = totals.benign.toLocaleString();
    number("history-sites", activeSites.size);
    $("site").textContent = $("site-filter").value === "*" ? "모든 사이트" : $("site-filter").value;
    renderHistoryChart(rows);
    renderCategories(categories);
    renderSiteTable();
    renderHourTable(rows);
  }

  function renderCategories(categories) {
    const entries = Object.entries(categories).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!entries.length) { $("category-grid").replaceChildren(Object.assign(document.createElement("p"), { className: "empty-message", textContent: "관찰 데이터가 없습니다." })); return; }
    const max = entries[0][1];
    $("category-grid").replaceChildren(...entries.map(([name, count]) => {
      const row = document.createElement("div"); row.className = "category-row";
      const label = document.createElement("span"); label.textContent = categoryLabels[name] || name;
      const bar = document.createElement("div"); bar.className = "category-bar"; bar.style.setProperty("--category-color", colors[featureCategory({ category: name })]);
      const fill = document.createElement("i"); fill.style.width = `${Math.max(4, count / max * 100)}%`; bar.append(fill);
      const value = document.createElement("b"); value.textContent = count.toLocaleString(); row.append(label, bar, value); return row;
    }));
  }

  function renderHourTable(rows) {
    const rendered = rows.slice().reverse().slice(0, 240).map(({ site, hour, bucket }) => {
      const outcomes = Object.assign(emptyDashboardOutcomes(), bucket.outcomes || {});
      const access = Object.assign({ dangerous: 0, suspicious: 0, benign: 0 }, bucket.access || {});
      const total = Number(bucket.total) || 0;
      const risk = riskIndex(access, total);
      const averageRisk = total ? Math.round((Number(bucket.risk) || 0) / total) : 0;
      const averageConfidence = total ? Math.round((Number(bucket.confidence) || 0) / total) : 0;
      const treatment = [outcomes.perturbed ? `바꿔치기 ${outcomes.perturbed}` : "", outcomes.cleaned ? `정리 ${outcomes.cleaned}` : "", outcomes.blocked ? `차단 ${outcomes.blocked}` : "", outcomes.rollback ? `복구 ${outcomes.rollback}` : ""].filter(Boolean).join(" · ") || "관찰만";
      const values = [new Date(hour).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit" }), site];
      const row = document.createElement("tr");
      for (const value of values) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
      const level = document.createElement("td"); level.append(severityCell(risk)); row.append(level);
      const defended = Math.max(outcomes.defended, outcomes.perturbed + outcomes.cleaned + outcomes.blocked);
      for (const [value, className] of [[topCategory(bucket.categories), "signal-value"], [total, "number-value"], [`${defended}/${total} (${percent(defended, total)}%)`, "defense-value"], [`${averageRisk}/100`, averageRisk >= 55 ? "risk-high" : averageRisk >= 25 ? "risk-medium" : "risk-low"], [`${averageConfidence}/100`, "confidence-value"], [treatment, defended ? "defense-value" : "muted-value"]]) { const cell = document.createElement("td"); cell.textContent = typeof value === "number" ? value.toLocaleString() : value; cell.className = className; row.append(cell); }
      return row;
    });
    if (!rendered.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 9; cell.className = "table-empty"; cell.textContent = extensionConnected ? "선택한 기간의 기록이 없습니다 · 관찰 0건 · 방어 0건" : "확장 프로그램 연결 필요 · 기록을 불러오지 못했습니다"; row.append(cell); rendered.push(row); }
    $("hour-table").replaceChildren(...rendered);
  }

  function emptyDashboardOutcomes() { return { observed: 0, defended: 0, perturbed: 0, cleaned: 0, blocked: 0, rollback: 0 }; }

  function renderSiteTable() {
    const rangeMs = (Number($("range-filter").value) || 168) * 3600000;
    const cutoff = Date.now() - rangeMs;
    const midpoint = Date.now() - rangeMs / 2;
    const rows = Object.entries(historyState.sites || {}).map(([site, data]) => {
      const totals = { total: 0, observed: 0, defended: 0, perturbed: 0, cleaned: 0, blocked: 0, rollback: 0, dangerous: 0, suspicious: 0, benign: 0 };
      const categories = {}; let recent = 0; let previous = 0; let last = 0;
      for (const [hour, bucket] of Object.entries(data.hours || {})) if (Number(hour) >= cutoff) { const count = Number(bucket.total) || 0; totals.total += count; sumOutcomes(totals, bucket.outcomes); sumAccess(totals, bucket.access); for (const [name, value] of Object.entries(bucket.categories || {})) categories[name] = (categories[name] || 0) + Number(value || 0); if (Number(hour) >= midpoint) recent += count; else previous += count; last = Math.max(last, Number(hour)); }
      const risk = riskIndex(totals, totals.total); return { site, totals, categories, risk, defense: percent(totals.defended, totals.total), last, trend: recent - previous };
    }).filter(item => item.totals.total > 0).sort((a, b) => b.risk - a.risk || b.totals.total - a.totals.total);
    $("site-table").replaceChildren(...rows.map(({ site, totals, categories, risk, defense, last, trend }) => {
      const row = document.createElement("tr");
      const siteCell = document.createElement("td"); siteCell.textContent = site; const status = document.createElement("td"); status.append(severityCell(risk)); row.append(siteCell, status);
      const trendText = trend > 0 ? `▲ ${trend}` : trend < 0 ? `▼ ${Math.abs(trend)}` : "—";
      const dominant = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
      for (const [value, className] of [[`${risk}/100`, risk >= 55 ? "risk-high" : risk >= 25 ? "risk-medium" : "risk-low"], [`${totals.defended}/${totals.total} (${defense}%)`, "defense-value"], [totals.total, "number-value"], [`${totals.dangerous}건`, totals.dangerous ? "risk-high" : "risk-low"], [dominant ? `${categoryLabels[dominant[0]] || dominant[0]} ${dominant[1]}건` : "–", "signal-value"], [formatAgo(last), "muted-value"], [trendText, trend > 0 ? "trend-up" : trend < 0 ? "trend-down" : "trend-flat"]]) { const cell = document.createElement("td"); cell.textContent = typeof value === "number" ? value.toLocaleString() : value; cell.className = className; row.append(cell); }
      row.addEventListener("click", () => { $("site-filter").value = site; renderHistory(); scrollTo({ top: 0, behavior: "smooth" }); });
      return row;
    }));
    if (!$('site-table').children.length) { const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 9; cell.className = 'table-empty'; cell.textContent = extensionConnected ? '선택한 기간의 사이트 기록이 없습니다 · 관찰 0건 · 위험 0건 · 방어 0건' : '확장 프로그램 연결 필요 · 최근 추적 데이터 보기에서 열어 주세요'; row.append(cell); $('site-table').append(row); }
  }

  function hydrateSiteFilter() {
    const select = $("site-filter"); const selected = select.value;
    const sites = Object.keys(historyState.sites || {}).sort();
    select.replaceChildren(Object.assign(document.createElement("option"), { value: "*", textContent: "모든 사이트" }), ...sites.map((site) => Object.assign(document.createElement("option"), { value: site, textContent: site })));
    select.value = sites.includes(selected) || selected === "*" ? selected : "*";
  }

  async function currentTabId() {
    if (Number.isInteger(requestedTabId)) return requestedTabId;
    if (!api || !api.tabs) return null;
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs[0] && tabs[0].id;
  }

  async function refresh() {
    if (!api || !api.runtime || !api.runtime.sendMessage) {
      extensionConnected = false;
      $("live-status").innerHTML = "<i></i> EXTENSION REQUIRED";
      $("defense-rate").textContent = "연결 필요"; $("defense-detail").textContent = "방어 기록을 불러오지 못했습니다";
      renderSiteTable(); renderHourTable([]);
      $("recommendation").textContent = "이 페이지는 Privacy Mirror 확장 프로그램 내부에서 열어야 실시간 데이터가 표시됩니다.";
      return;
    }
    try {
      const tabId = await currentTabId();
      const [response, historyResponse] = await Promise.all([
        api.runtime.sendMessage({ type: "PM_GET_REPORT", tabId }),
        api.runtime.sendMessage({ type: "PM_GET_HISTORY" })
      ]);
      if (!historyResponse || historyResponse.error || !historyResponse.history) throw new Error('history-unavailable');
      historyState = historyResponse && historyResponse.history || { sites: {} };
      extensionConnected = true;
      hydrateSiteFilter(); renderHistory();
      render(response && response.report, response && response.ai);
      $("live-status").innerHTML = "<i></i> LIVE EXTENSION";
      $('connection-help').textContent = `연결됨 · 현재 탭 ${response && response.report && response.report.site || '–'} · ${new Date().toLocaleTimeString()} 갱신`;
      $('connect-extension').hidden = true;
    } catch (_) { extensionConnected = false; $("live-status").innerHTML = "<i></i> DISCONNECTED"; $("defense-rate").textContent = "연결 필요"; $("defense-detail").textContent = "방어 기록을 불러오지 못했습니다"; renderSiteTable(); renderHourTable([]); }
  }

  $("refresh").addEventListener("click", refresh);
  $('connect-extension').addEventListener('click', async () => {
    const button = $('connect-extension'); button.disabled = true;
    try {
      if (!api) throw new Error('최신 확장 프로그램 설치 후 이 페이지를 새로고침해 주세요.');
      if (window.PMDashboardConnection) await api.runtime.sendMessage({ type: 'PM_CONNECT_DASHBOARD' });
      await refresh();
    } catch (error) { $('connection-help').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $("run-history-ai").addEventListener("click", async () => {
    if (historyAiRunning) return;
    if (!api) { $("history-ai-status").textContent = "확장 프로그램의 ‘최근 추적 데이터 보기’에서 열어 주세요."; return; }
    historyAiRunning = true;
    const button = $("run-history-ai"); button.disabled = true;
    if (window.PMEffects) window.PMEffects.reviewCards(null);
    const site = $("site-filter").value; const hours = Number($("range-filter").value);
    $("history-ai-scope").textContent = `${site === "*" ? "모든 사이트" : site} · 최근 ${hours}시간 · 실행 시점의 기록`;
    $("history-ai-scope").dataset.selection = `${site}:${hours}`;
    $("history-ai-status").textContent = "AI가 위험 신호와 방어 결과를 종합 평가하고 있습니다…";
    $("history-ai-metrics").textContent = ""; $("history-ai-findings").replaceChildren(); $("history-ai-uncertainty").textContent = "";
    try {
      const result = await api.runtime.sendMessage({ type: "PM_RUN_HISTORY_AI", site, hours, mode: $("history-ai-mode").value });
      const ai = result && result.ai;
      if (!ai || ai.status !== "OK" || !ai.analysis) throw new Error(ai && ai.status === "NO_DATA" ? "선택한 기간에 분석할 기록이 없습니다." : "AI 평가를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      const names = { LIKELY_TRACKING: "추적 가능성 높음", POSSIBLE_TRACKING: "추적 의심", AMBIGUOUS: "판단 근거 부족", LIKELY_BENIGN: "정상 사용 가능성 높음" };
      $("history-ai-status").textContent = `${names[ai.analysis.classification] || "평가 완료"} · ${new Date(result.evaluatedAt).toLocaleString()}`;
      $("history-ai-metrics").textContent = `위험 접근 지수 ${result.riskIndex}/100 · AI 확신도 ${ai.analysis.aiConfidence}/100 · 관찰 ${result.summary.totals.total}건 · 방어 ${result.summary.totals.defended}건`;
      $("history-ai-findings").replaceChildren(...(ai.analysis.explanation || []).map((line) => { const item = document.createElement("li"); item.textContent = line; return item; }));
      if (window.PMEffects) window.PMEffects.reviewCards(ai.analysis, result.summary);
      $("history-ai-uncertainty").textContent = `판단 한계: ${(ai.analysis.uncertaintyReasons || []).join(" ") || "집계만으로 실제 추적이나 데이터 유출을 확정할 수 없습니다."} 위험 접근 지수 = (위험 접근 + 주의 접근 × 0.5) ÷ 전체 접근 × 100.`;
    } catch (error) { $("history-ai-status").textContent = error.message; }
    finally { historyAiRunning = false; button.disabled = false; renderHistory(); }
  });
  $("site-filter").addEventListener("change", renderHistory);
  $("range-filter").addEventListener("change", renderHistory);
  setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
  void refresh();
})();
