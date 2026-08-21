(function privacyMirrorBridge() {
  "use strict";
  const api = typeof browser !== "undefined" ? browser : chrome;
  const EVENT_NAME = "__privacy_mirror_signal_v1";
  const CONFIG_NAME = "__privacy_mirror_config_v1";
  let queue = [];
  let timer = 0;

  function send(message) {
    try {
      const result = api.runtime.sendMessage(message);
      if (result && typeof result.catch === "function") result.catch(() => undefined);
    } catch (_) { /* extension context invalidated */ }
  }

  function dispatchConfig(config) {
    document.dispatchEvent(new CustomEvent(CONFIG_NAME, { detail: config }));
  }

  function flush() {
    timer = 0;
    if (!queue.length) return;
    const events = queue;
    queue = [];
    send({ type: "PM_EVENT_BATCH", events });
  }

  document.addEventListener(EVENT_NAME, (event) => {
    const detail = event.detail;
    if (!detail || typeof detail.type !== "string" || typeof detail.ts !== "number") return;
    queue.push(detail);
    if (queue.length >= 32) flush();
    else if (!timer) timer = setTimeout(flush, 50);
  });

  api.runtime.onMessage.addListener((message) => {
    if (message && message.type === "PM_POLICY") dispatchConfig(message.config || {});
  });

  Promise.resolve(api.runtime.sendMessage({ type: "PM_INIT", href: location.href }))
    .then((response) => { if (response && response.config) dispatchConfig(response.config); })
    .catch(() => undefined);

  for (const [key, value] of new URL(location.href).searchParams) {
    if (value.length >= 8 && value.length <= 512) {
      queue.push({ id: `url-${key}`, ts: Date.now(), type: "navigation.decorated", meta: { operation: "query-parameter", nameLength: key.length }, rawTokens: [value] });
    }
  }
  if (queue.length && !timer) timer = setTimeout(flush, 0);
})();
