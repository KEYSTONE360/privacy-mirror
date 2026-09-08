(function dashboardBridge() {
  'use strict';
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const origins = ['https://privacy-mirror-analysis-blazetiger10-5946s-projects.vercel.app', 'http://127.0.0.1:4173', 'http://localhost:4173'];
  const origin = location.origin;
  if (!origins.includes(origin) || location.pathname !== '/dashboard/index.html' || window.top !== window) return;
  const allowed = new Set(['PM_CONNECT_DASHBOARD', 'PM_GET_HISTORY', 'PM_GET_REPORT', 'PM_RUN_HISTORY_AI']);
  window.addEventListener('message', async event => {
    const data = event.data;
    if (event.source !== window || event.origin !== origin || !data || data.channel !== 'pm-dashboard-request' || !allowed.has(data.message && data.message.type)) return;
    if (typeof data.id !== 'string' || data.id.length > 80) return;
    let result;
    try { result = await api.runtime.sendMessage({ type: 'PM_DASHBOARD_REQUEST', request: data.message }); }
    catch (_) { result = { error: 'extension-unavailable' }; }
    window.postMessage({ channel: 'pm-dashboard-response', id: data.id, result }, origin);
  });
})();
