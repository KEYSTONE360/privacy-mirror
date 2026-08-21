(function initChromeAdapter(root) {
  "use strict";
  const api = root.chrome;
  if (!api) return;

  function call(target, method, args) {
    return new Promise((resolve, reject) => {
      try {
        target[method](...(args || []), (value) => {
          const error = api.runtime && api.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(value);
        });
      } catch (error) { reject(error); }
    });
  }

  root.PrivacyMirrorBrowserAdapter = {
    name: "chrome",
    api,
    storageSession: {
      get: (key) => call(api.storage.session, "get", [key]),
      set: (value) => call(api.storage.session, "set", [value])
    },
    storageLocal: {
      get: (key) => call(api.storage.local, "get", [key]),
      set: (value) => call(api.storage.local, "set", [value])
    },
    sendToTab(tabId, message) {
      return call(api.tabs, "sendMessage", [tabId, message]).catch(() => undefined);
    },
    queryTabs(query) { return call(api.tabs, "query", [query]); },
    onMessage(listener) { api.runtime.onMessage.addListener(listener); },
    onRequest(listener) {
      api.webRequest.onBeforeRequest.addListener(listener, { urls: ["<all_urls>"] });
    },
    onNavigation(listener) {
      api.webNavigation.onCommitted.addListener(listener);
    },
    configurePanel() {
      if (api.sidePanel && api.sidePanel.setPanelBehavior) {
        return api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
      }
      return Promise.resolve();
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
