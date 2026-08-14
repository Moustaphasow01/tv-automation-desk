import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export type DeskDensityPreference = "auto" | "native" | "workstation";
export type DeskDensityMode = Exclude<DeskDensityPreference, "auto">;

type DeskDensityEnvironment = {
  devicePixelRatio: number;
  innerWidth: number;
  platform: string;
  screenWidth: number;
};

type DeskDensityContextValue = {
  mode: DeskDensityMode;
  preference: DeskDensityPreference;
  setPreference: (preference: DeskDensityPreference) => void;
};

const STORAGE_KEY = "desk-control-plane:density";

const DeskDensityContext = createContext<DeskDensityContextValue | null>(null);

export function detectDeskDensityMode(
  preference: DeskDensityPreference,
  environment: DeskDensityEnvironment
): DeskDensityMode {
  if (preference !== "auto") {
    return preference;
  }

  const isWindows = /win/i.test(environment.platform);
  const isScaledFullHdWorkstation =
    isWindows &&
    environment.devicePixelRatio >= 1.35 &&
    environment.innerWidth >= 1100 &&
    environment.innerWidth <= 1400 &&
    environment.screenWidth >= 1100 &&
    environment.screenWidth <= 1400;

  return isScaledFullHdWorkstation ? "workstation" : "native";
}

export function DeskDensityViewport({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<DeskDensityPreference>(() => readPreference());
  const mode = useMemo(
    () => detectDeskDensityMode(preference, readEnvironment()),
    [preference]
  );

  const context = useMemo<DeskDensityContextValue>(
    () => ({
      mode,
      preference,
      setPreference(nextPreference) {
        setPreferenceState(nextPreference);
        if (nextPreference === "auto") {
          window.localStorage.removeItem(STORAGE_KEY);
        } else {
          window.localStorage.setItem(STORAGE_KEY, nextPreference);
        }
      }
    }),
    [mode, preference]
  );

  return (
    <DeskDensityContext.Provider value={context}>
      <div
        className="desk-density-viewport"
        data-density-mode={mode}
        data-density-preference={preference}
      >
        {children}
      </div>
    </DeskDensityContext.Provider>
  );
}

export function useDeskDensity() {
  const context = useContext(DeskDensityContext);
  if (!context) {
    throw new Error("useDeskDensity must be used inside DeskDensityViewport");
  }
  return context;
}

function readPreference(): DeskDensityPreference {
  if (typeof window === "undefined") {
    return "auto";
  }

  const queryPreference = new URLSearchParams(window.location.search).get("density");
  if (isDensityPreference(queryPreference)) {
    return queryPreference;
  }

  const storedPreference = window.localStorage.getItem(STORAGE_KEY);
  return isDensityPreference(storedPreference) ? storedPreference : "auto";
}

function readEnvironment(): DeskDensityEnvironment {
  if (typeof window === "undefined") {
    return { devicePixelRatio: 1, innerWidth: 1920, platform: "", screenWidth: 1920 };
  }

  const navigatorWithUserAgentData = window.navigator as Navigator & {
    userAgentData?: { platform?: string };
  };

  return {
    devicePixelRatio: window.devicePixelRatio || 1,
    innerWidth: window.innerWidth,
    platform: navigatorWithUserAgentData.userAgentData?.platform ?? window.navigator.platform ?? "",
    screenWidth: window.screen.width
  };
}

function isDensityPreference(value: string | null): value is DeskDensityPreference {
  return value === "auto" || value === "native" || value === "workstation";
}
