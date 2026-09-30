export function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(data));
}
export async function readBody(req, limit = 2_100_000) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error("BODY_TOO_LARGE"), { code: "BODY_TOO_LARGE", status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function readJsonBody(req, limit) {
  try { return JSON.parse(await readBody(req, limit)); }
  catch (error) { throw Object.assign(new Error("INVALID_JSON"), { code: "INVALID_JSON", status: error.status || 400 }); }
}
export function sendHtml(res, body, status = 200, headers = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
    "x-frame-options": "DENY", "x-content-type-options": "nosniff", ...headers });
  res.end(body);
}
