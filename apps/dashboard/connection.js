(function connectDashboard() {
  'use strict';
  const origins = ['https://privacy-mirror-analysis-blazetiger10-5946s-projects.vercel.app', 'http://127.0.0.1:4173', 'http://localhost:4173'];
  const origin = location.origin;
  if (!origins.includes(origin)) return;
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== origin || !event.data || event.data.channel !== 'pm-dashboard-response') return;
    const item = pending.get(event.data.id); if (!item) return;
    clearTimeout(item.timeout); pending.delete(event.data.id);
    if (event.data.result && event.data.result.error) item.reject(new Error('확장 창의 최근 추적 데이터 보기에서 다시 열어 주세요.'));
    else item.resolve(event.data.result);
  });
  window.PMDashboardConnection = { runtime: { sendMessage(message) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('확장 프로그램 연결을 확인해 주세요.')); }, message.type === 'PM_RUN_HISTORY_AI' ? 195000 : 6000);
      pending.set(id, { resolve, reject, timeout });
      window.postMessage({ channel: 'pm-dashboard-request', id, message }, origin);
    });
  } } };
})();
