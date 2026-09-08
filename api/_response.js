"use strict";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store, max-age=0");
  res.setHeader("pragma", "no-cache");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(JSON.stringify(body));
}

function validBody(req) {
  const length = Number(req.headers && req.headers["content-length"] || 0);
  if (length > 64 * 1024) throw new Error("payload-too-large");
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new Error("json-required");
  return req.body;
}

module.exports = { send, validBody };
