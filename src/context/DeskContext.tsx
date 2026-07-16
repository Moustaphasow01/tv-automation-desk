import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionId } from "@/types";

type MarketPhase = "asia" | "london" | "ny";

interface Value {
  sessionId: SessionId;
  phase: MarketPhase;
  phaseLabel: string;
  nextPhaseAt: string;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}
const Context = createContext<Value | null>(null);

export function resolveAutomaticSession(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === "hour")?.value || 0);
  const minute = Number(parts.find(part => part.type === "minute")?.value || 0);
  const minutes = hour * 60 + minute;
  if (minutes < 8 * 60) return { sessionId: "asia_open" as const, phase: "asia" as const, phaseLabel: "Asia", nextPhaseAt: "08:00" };
  if (minutes < 15 * 60 + 30) return { sessionId: "asia_open" as const, phase: "london" as const, phaseLabel: "London", nextPhaseAt: "15:30" };
  return { sessionId: "ny_open" as const, phase: "ny" as const, phaseLabel: "New York", nextPhaseAt: "00:00" };
}

export function DeskProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const automatic = useMemo(() => resolveAutomaticSession(now), [now]);
  const value = useMemo(() => ({ ...automatic, menuOpen, setMenuOpen }), [automatic, menuOpen]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useDeskContext() {
  const value = useContext(Context);
  if (!value) throw new Error("DeskProvider missing");
  return value;
}
