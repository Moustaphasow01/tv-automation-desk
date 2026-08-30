export type LiveFocusPreference = {
  enabled: boolean;
  autoOpen: boolean;
  instrument: string | null;
  timeframe: string | null;
  scrollY: number;
};

export type LiveFocusSoundEvent = "decision" | "expiry" | "expired" | "fill" | "stop";

export type LiveFocusSoundProfile = {
  enabled: boolean;
  doNotDisturb: boolean;
  events: Record<LiveFocusSoundEvent, boolean>;
};

const FOCUS_KEY = "desk.live.focus.v1";
const SOUND_KEY = "desk.live.focus.sound-profile.v1";

const DEFAULT_FOCUS: LiveFocusPreference = {
  enabled: false,
  autoOpen: false,
  instrument: null,
  timeframe: null,
  scrollY: 0,
};

const DEFAULT_SOUND: LiveFocusSoundProfile = {
  enabled: true,
  doNotDisturb: false,
  events: { decision: true, expiry: true, expired: true, fill: true, stop: true },
};

export function readLiveFocusPreference(): LiveFocusPreference {
  if (typeof window === "undefined") return DEFAULT_FOCUS;
  try {
    const stored = JSON.parse(window.localStorage.getItem(FOCUS_KEY) ?? "{}");
    return {
      ...DEFAULT_FOCUS,
      ...(stored && typeof stored === "object" ? stored : {}),
      enabled: stored?.enabled === true,
      autoOpen: stored?.autoOpen === true,
      scrollY: Number.isFinite(stored?.scrollY) ? Math.max(0, Number(stored.scrollY)) : 0,
    };
  } catch {
    return DEFAULT_FOCUS;
  }
}

export function writeLiveFocusPreference(patch: Partial<LiveFocusPreference>): LiveFocusPreference {
  const next = { ...readLiveFocusPreference(), ...patch };
  window.localStorage.setItem(FOCUS_KEY, JSON.stringify(next));
  return next;
}

export function readLiveFocusSoundProfile(): LiveFocusSoundProfile {
  if (typeof window === "undefined") return DEFAULT_SOUND;
  try {
    const stored = JSON.parse(window.localStorage.getItem(SOUND_KEY) ?? "{}");
    return {
      enabled: stored?.enabled !== false,
      doNotDisturb: stored?.doNotDisturb === true,
      events: {
        ...DEFAULT_SOUND.events,
        ...(stored?.events && typeof stored.events === "object" ? stored.events : {}),
      },
    };
  } catch {
    return DEFAULT_SOUND;
  }
}

export function writeLiveFocusSoundProfile(profile: LiveFocusSoundProfile): LiveFocusSoundProfile {
  window.localStorage.setItem(SOUND_KEY, JSON.stringify(profile));
  return profile;
}
