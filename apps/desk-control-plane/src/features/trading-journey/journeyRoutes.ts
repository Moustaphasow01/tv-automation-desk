const origins = new Set(["/command-center", "/live", "/live/signals", "/orders", "/execution/orders", "/portfolio", "/execution/portfolio", "/execution/portfolio/positions"]);
const contextKeys = new Set(["focus", "workspace", "instrument", "timeframe", "panel", "livePanel", "ticketId", "signalId", "chartAt", "period", "scope", "search", "status", "sort", "filter", "trackingScope", "trackingSearch", "journalSearch", "journalScope", "ticketSection", "ticketSearch"]);

/** UI navigation only; never an authority, resource identity, or permission. */
export function safeJourneyOrigin(value: string | null): string | null {
  if (!value || value.length > 4096 || !value.startsWith("/") || /[\\#\u0000-\u001f]/.test(value)) return null;
  const [path, query = ""] = value.split("?");
  if (!origins.has(path)) return null;
  const clean = new URLSearchParams();
  new URLSearchParams(query).forEach((entry, key) => {
    if (contextKeys.has(key) && entry.length <= 512) clean.set(key, entry);
  });
  return path + (clean.size ? "?" + clean.toString() : "");
}

export function journeyOrigin(location: { pathname: string; search: string }): string | null {
  return safeJourneyOrigin(new URLSearchParams(location.search).get("returnTo"))
    ?? safeJourneyOrigin(location.pathname + location.search);
}

export function journeyHref(destination: string, origin: string | null): string {
  if (!destination.startsWith("/") || destination.startsWith("//") || /[\\\u0000-\u001f]/.test(destination)) return "/live";
  const [path, query = ""] = destination.split("?");
  const params = new URLSearchParams(query);
  params.delete("returnTo");
  const safe = safeJourneyOrigin(origin);
  if (safe && safe !== destination) params.set("returnTo", safe);
  return path + (params.size ? "?" + params.toString() : "");
}

export function journeyReturnLabel(origin: string): string {
  const [path, search = ""] = origin.split("?");
  if (path === "/live") return new URLSearchParams(search).get("focus") === "1" ? "Retour à Focus" : "Retour au Live";
  if (path === "/command-center") return "Retour à l’accueil";
  if (path.includes("portfolio")) return "Retour aux positions";
  if (path === "/live/signals") return "Retour aux signaux";
  return "Retour aux ordres";
}
