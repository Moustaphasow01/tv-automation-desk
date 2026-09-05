import { frontApiCacheControl, frontApiEtag, requestMatchesEtag } from "./front-api-cache.js";

export function sendJson(res, status, payload, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

export function sendFrontResource(req, res, payload, headers = {}, maxAgeSeconds = 0) {
  const etag = frontApiEtag(payload);
  const responseHeaders = {
    ...headers,
    etag,
    "cache-control": frontApiCacheControl(maxAgeSeconds),
  };
  if (requestMatchesEtag(req.headers["if-none-match"], etag)) {
    res.writeHead(304, responseHeaders);
    res.end();
    return;
  }
  sendJson(res, 200, payload, responseHeaders);
}

export function sendHtml(res, status, html, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(html);
}
