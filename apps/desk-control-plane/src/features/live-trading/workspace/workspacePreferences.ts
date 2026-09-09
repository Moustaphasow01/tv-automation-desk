import type { AuthSessionView } from "@/domains/front-api/viewModels";

export type WatchGroup = { id: string; name: string; symbols: string[] };
export type WorkspacePreferences = {
  version: 1;
  chartCount: 1 | 2 | 4;
  secondary: string[];
  timeframes: string[];
  density: "comfortable" | "compact";
  inspectorWidth: number;
  watchlistVisible: boolean;
  linkedCursor: boolean;
  sound: boolean;
  favorites: string[];
  groups: WatchGroup[];
  activeGroup: string;
};

export const defaultWorkspacePreferences: WorkspacePreferences = {
  version: 1, chartCount: 2, secondary: [], timeframes: [], density: "comfortable",
  inspectorWidth: 344, watchlistVisible: true, linkedCursor: false, sound: false,
  favorites: [], groups: [], activeGroup: "desk",
};

export function workspacePreferenceKey(session: AuthSessionView | null): string | null {
  if (!session?.summary.authenticated || !session.principal.userId) return null;
  return ["desk-workspace", "v1", encodeURIComponent(session.principal.userId), session.summary.environment].join(":");
}

function stringList(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length < 100))].slice(0, maximum);
}

export function parseWorkspacePreferences(raw: string | null): WorkspacePreferences {
  if (!raw) return { ...defaultWorkspacePreferences };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return { ...defaultWorkspacePreferences };
    const input = value as Record<string, unknown>;
    const groups = parseWatchGroups(input.groups);
    const activeGroup = typeof input.activeGroup === "string" && ["desk", "favorites", ...groups.map((group) => group.id)].includes(input.activeGroup) ? input.activeGroup : "desk";
    return {
      version: 1, chartCount: input.chartCount === 1 || input.chartCount === 4 ? input.chartCount : 2,
      secondary: stringList(input.secondary, 3),
      // Repeated timeframes are intentional: each chart owns its unit.
      timeframes: Array.isArray(input.timeframes) ? input.timeframes.slice(0, 4).map((item) => typeof item === "string" && item.length < 12 ? item : "") : [],
      density: input.density === "compact" ? "compact" : "comfortable",
      inspectorWidth: typeof input.inspectorWidth === "number" && Number.isFinite(input.inspectorWidth) ? Math.max(300, Math.min(480, Math.round(input.inspectorWidth))) : 344,
      watchlistVisible: input.watchlistVisible !== false,
      linkedCursor: input.linkedCursor === true, sound: input.sound === true,
      favorites: stringList(input.favorites, 30), groups, activeGroup,
    };
  } catch { return { ...defaultWorkspacePreferences }; }
}

function parseWatchGroups(value: unknown): WatchGroup[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^group-[a-z0-9-]+$/.test(item.id) || seen.has(item.id) || typeof item.name !== "string" || !item.name.trim()) return [];
    seen.add(item.id);
    return [{ id: item.id, name: item.name.trim().slice(0, 32), symbols: stringList(item.symbols, 30) }];
  }).slice(0, 8);
}

export function normalizedSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").trim();
}

export function groupSymbols(preferences: WorkspacePreferences, desk: readonly string[], supported: readonly string[]): string[] {
  const selected = preferences.activeGroup === "favorites" ? preferences.favorites
    : preferences.groups.find((group) => group.id === preferences.activeGroup)?.symbols ?? desk;
  return [...new Set(selected)].filter((symbol) => supported.includes(symbol));
}
