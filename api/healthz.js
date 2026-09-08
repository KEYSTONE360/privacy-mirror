"use strict";
const { send } = require("./_response.js");
module.exports = function health(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "method-not-allowed" });
  return send(res, 200, { ok: true, service: "privacy-mirror-analysis", retention: "none-at-application-layer" });
};
