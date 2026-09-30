import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createOAuthClientRegistration } from "./oauth.js";

const denied = code => Object.assign(new Error(code), { code, status: 400 });
const scopes = ["desk.read", "desk.write"];

/** OOS-only public client registry. No trading storage, secrets or legacy policies. */
export class OosOAuthClients {
  constructor({ issuer, directory }) {
    Object.assign(this, { issuer, directory }); this.records = new Map();
  }
  async register(metadata) {
    const redirects = metadata.redirect_uris;
    if (!Array.isArray(redirects) || !redirects.length || redirects.length > 8 || !redirects.every(allowedCallback)) {
      throw denied("invalid_redirect_uri");
    }
    if (metadata.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== "none") throw denied("invalid_client_metadata");
    if (metadata.grant_types && (!Array.isArray(metadata.grant_types) || !metadata.grant_types.every(x => ["authorization_code", "refresh_token"].includes(x)))) throw denied("invalid_client_metadata");
    if (metadata.response_types && (!Array.isArray(metadata.response_types) || metadata.response_types.some(x => x !== "code"))) throw denied("invalid_client_metadata");
    const scope = metadata.scope || scopes.join(" ");
    if (typeof scope !== "string" || !scope.trim() || !scope.split(/\s+/).every(x => scopes.includes(x))) throw denied("invalid_scope");
    const record = createOAuthClientRegistration(this.issuer, { ...metadata, scope });
    if (this.directory) {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(this.directory, `${record.client_id}.json`), JSON.stringify(record), { flag: "wx", mode: 0o600 });
    }
    this.records.set(record.client_id, record); return record;
  }
  async get(id) {
    if (!/^desk_dcr_[A-Za-z0-9_-]{24}$/.test(id || "")) throw denied("invalid_client");
    if (this.records.has(id)) return this.records.get(id);
    if (this.directory) {
      try {
        const record = JSON.parse(await readFile(path.join(this.directory, `${id}.json`), "utf8"));
        if (record.client_id !== id) throw denied("invalid_client");
        this.records.set(id, record); return record;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    throw denied("invalid_client");
  }
}

function allowedCallback(value) {
  try {
    const uri = new URL(value);
    if (uri.username || uri.password || uri.hash) return false;
    if (uri.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(uri.hostname)) return true;
    return uri.protocol === "https:" && uri.hostname === "chatgpt.com" && !uri.port &&
      (uri.pathname === "/connector_platform_oauth_redirect" || uri.pathname.startsWith("/connector/oauth/"));
  } catch { return false; }
}
