(function initFirefoxAdapter(root) {
  "use strict";
  const api = root.browser;
  if (!api) return;
  root.PrivacyMirrorBrowserAdapter = {
    name: "firefox",
    api,
    storageSession: {
      get: (key) => api.storage.session.get(key),
      set: (value) => api.storage.session.set(value)
    },
    storageLocal: {
      get: (key) => api.storage.local.get(key),
      set: (value) => api.storage.local.set(value)
    },
    sendToTab(tabId, message) {
      return api.tabs.sendMessage(tabId, message).catch(() => undefined);
    },
    queryTabs(query) { return api.tabs.query(query); },
    onMessage(listener) { api.runtime.onMessage.addListener(listener); },
    onRequest(listener) {
      api.webRequest.onBeforeRequest.addListener(listener, { urls: ["<all_urls>"] });
    },
    onNavigation(listener) {
      api.webNavigation.onCommitted.addListener(listener);
    },
    configurePanel() { return Promise.resolve(); }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
