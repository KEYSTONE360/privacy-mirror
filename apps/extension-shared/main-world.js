(function installPrivacyMirrorHooks() {
  "use strict";
  if (window.__privacyMirrorInstalled) return;
  Object.defineProperty(window, "__privacyMirrorInstalled", { value: true, configurable: false });

  const EVENT_NAME = "__privacy_mirror_signal_v1";
  const CONFIG_NAME = "__privacy_mirror_config_v1";
  const native = {
    getImageData: CanvasRenderingContext2D.prototype.getImageData,
    putImageData: CanvasRenderingContext2D.prototype.putImageData,
    toDataURL: HTMLCanvasElement.prototype.toDataURL,
    toBlob: HTMLCanvasElement.prototype.toBlob,
    getParameter: window.WebGLRenderingContext && WebGLRenderingContext.prototype.getParameter,
    getParameter2: window.WebGL2RenderingContext && WebGL2RenderingContext.prototype.getParameter,
    digest: window.SubtleCrypto && SubtleCrypto.prototype.digest,
    storageGet: Storage.prototype.getItem,
    storageSet: Storage.prototype.setItem,
    storageRemove: Storage.prototype.removeItem,
    idbOpen: IDBFactory.prototype.open,
    idbDelete: IDBFactory.prototype.deleteDatabase
  };
  let config = { seedMaterial: "", policy: "observe", cleanLinks: true };
  let interactionAt = -Infinity;
  let counter = 0;

  function emit(type, meta, rawTokens) {
    try {
      document.dispatchEvent(new CustomEvent(EVENT_NAME, {
        detail: {
          id: `p${++counter}`,
          ts: Date.now(),
          type,
          meta: meta || {},
          rawTokens: Array.isArray(rawTokens) ? rawTokens.filter(isTokenCandidate).slice(0, 8) : []
        }
      }));
    } catch (_) { /* fail open */ }
  }

  function isTokenCandidate(value) {
    return typeof value === "string" && value.length >= 8 && value.length <= 512 && /^[\w.~-]+$/.test(value);
  }

  function hiddenCanvas(canvas) {
    try {
      const rect = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      return !canvas.isConnected || rect.width * rect.height === 0 || style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
    } catch (_) { return false; }
  }

  function seedFor(surface) {
    let hash = 0x811c9dc5;
    const text = `${config.seedMaterial}|${surface}`;
    for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
    return hash >>> 0;
  }

  function shouldProtect() {
    return Boolean(config.seedMaterial) && config.policy === "protect";
  }

  function perturbImageData(imageData, surface) {
    if (!shouldProtect() || !imageData || imageData.data.length < 4) return imageData;
    const copy = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
    const seed = seedFor(surface);
    const pixels = Math.max(1, copy.data.length / 4);
    const pixel = seed % pixels;
    const channel = seed % 3;
    const index = pixel * 4 + channel;
    copy.data[index] = copy.data[index] ^ (1 + ((seed >>> 8) & 1));
    return copy;
  }

  CanvasRenderingContext2D.prototype.getImageData = function privacyMirrorGetImageData(...args) {
    const started = performance.now();
    try {
      const result = native.getImageData.apply(this, args);
      const canvas = this.canvas;
      emit("canvas.read", { hidden: hiddenCanvas(canvas), area: canvas.width * canvas.height, operation: "getImageData", durationMs: performance.now() - started });
      return perturbImageData(result, `2d:${canvas.width}x${canvas.height}:${args.join(",")}`);
    } catch (_) { return native.getImageData.apply(this, args); }
  };

  HTMLCanvasElement.prototype.toDataURL = function privacyMirrorToDataURL(...args) {
    const started = performance.now();
    try {
      emit("canvas.export", { hidden: hiddenCanvas(this), area: this.width * this.height, operation: "toDataURL", durationMs: performance.now() - started });
      if (!shouldProtect() || !this.width || !this.height) return native.toDataURL.apply(this, args);
      const context = this.getContext("2d");
      if (!context) return native.toDataURL.apply(this, args);
      const x = seedFor("canvas-x") % this.width;
      const y = seedFor("canvas-y") % this.height;
      const original = native.getImageData.call(context, x, y, 1, 1);
      const changed = perturbImageData(original, `export:${this.width}x${this.height}`);
      native.putImageData.call(context, changed, x, y);
      try { return native.toDataURL.apply(this, args); }
      finally { native.putImageData.call(context, original, x, y); }
    } catch (_) { return native.toDataURL.apply(this, args); }
  };

  HTMLCanvasElement.prototype.toBlob = function privacyMirrorToBlob(...args) {
    emit("canvas.export", { hidden: hiddenCanvas(this), area: this.width * this.height, operation: "toBlob" });
    return native.toBlob.apply(this, args);
  };

  function wrapWebGL(prototype, original) {
    if (!prototype || !original) return;
    prototype.getParameter = function privacyMirrorGetParameter(parameter) {
      let result = original.call(this, parameter);
      const sensitive = parameter === 0x9245 || parameter === 0x9246;
      emit("webgl.parameter", { operation: String(parameter), hidden: hiddenCanvas(this.canvas), area: this.canvas.width * this.canvas.height });
      if (shouldProtect() && sensitive) result = parameter === 0x9245 ? "Privacy Mirror" : "Generic GPU";
      return result;
    };
  }
  wrapWebGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype, native.getParameter);
  wrapWebGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, native.getParameter2);

  if (native.digest) {
    SubtleCrypto.prototype.digest = function privacyMirrorDigest(algorithm, data) {
      const name = typeof algorithm === "string" ? algorithm : algorithm && algorithm.name;
      emit("crypto.digest", { algorithm: String(name || "unknown"), byteLength: data && data.byteLength || 0 });
      return native.digest.call(this, algorithm, data);
    };
  }

  Storage.prototype.getItem = function privacyMirrorStorageGet(key) {
    emit("storage.read", { operation: "getItem", nameLength: String(key).length });
    return native.storageGet.call(this, key);
  };
  Storage.prototype.setItem = function privacyMirrorStorageSet(key, value) {
    emit("storage.write", { operation: "setItem", nameLength: String(key).length, byteLength: String(value).length }, [String(value)]);
    return native.storageSet.call(this, key, value);
  };
  Storage.prototype.removeItem = function privacyMirrorStorageRemove(key) {
    emit("storage.delete", { operation: "removeItem", nameLength: String(key).length });
    return native.storageRemove.call(this, key);
  };

  try {
    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie") || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "cookie");
    if (cookieDescriptor && cookieDescriptor.get && cookieDescriptor.set) {
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get() { const value = cookieDescriptor.get.call(document); emit("storage.cookie-read", { operation: "cookie.get", byteLength: value.length }); return value; },
        set(value) { const token = String(value).split(";")[0].split("=").slice(1).join("="); emit("storage.cookie-write", { operation: "cookie.set", byteLength: String(value).length }, [token]); return cookieDescriptor.set.call(document, value); }
      });
    }
  } catch (_) { /* browsers may reject own cookie descriptor */ }

  IDBFactory.prototype.open = function privacyMirrorIdbOpen(name, ...rest) {
    emit("storage.indexeddb-open", { operation: "indexedDB.open", nameLength: String(name).length });
    return native.idbOpen.call(this, name, ...rest);
  };
  IDBFactory.prototype.deleteDatabase = function privacyMirrorIdbDelete(name) {
    emit("storage.indexeddb-delete", { operation: "indexedDB.deleteDatabase", nameLength: String(name).length });
    return native.idbDelete.call(this, name);
  };

  function observeInteraction(event) {
    if (event.isTrusted) { interactionAt = Date.now(); emit("user.interaction", { operation: event.type }); }
  }
  for (const type of ["pointerdown", "keydown", "touchstart"]) addEventListener(type, observeInteraction, { capture: true, passive: true });

  addEventListener("click", (event) => {
    if (!config.cleanLinks) return;
    const anchor = event.target && event.target.closest && event.target.closest("a[href]");
    if (!anchor) return;
    try {
      const url = new URL(anchor.href);
      const removed = [];
      for (const key of [...url.searchParams.keys()]) {
        if (["utm_source","utm_medium","utm_campaign","utm_term","utm_content","gclid","fbclid","msclkid","dclid","_gl"].includes(key.toLowerCase())) { url.searchParams.delete(key); removed.push(key); }
      }
      if (removed.length) { anchor.href = url.href; emit("navigation.link-cleaned", { operation: "known-parameter-cleaner", removedCount: removed.length }); }
    } catch (_) { /* invalid URL */ }
  }, true);

  addEventListener("error", (event) => emit(event.target && event.target !== window ? "compatibility.resource-failure" : "compatibility.error", { operation: "window.error" }), true);
  addEventListener("unhandledrejection", () => emit("compatibility.error", { operation: "unhandledrejection" }));
  document.addEventListener(CONFIG_NAME, (event) => {
    const next = event.detail || {};
    config = {
      seedMaterial: typeof next.seedMaterial === "string" ? next.seedMaterial : config.seedMaterial,
      policy: ["observe", "protect"].includes(next.policy) ? next.policy : config.policy,
      cleanLinks: next.cleanLinks !== false
    };
  });
  emit("instrumentation.ready", { operation: "main-world", durationMs: Date.now() - interactionAt });
})();
