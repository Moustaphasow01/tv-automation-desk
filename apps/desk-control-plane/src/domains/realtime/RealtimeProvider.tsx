import { createContext, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { DeskAppConfig } from "@/app/appConfig";
import type { FrontViewName } from "@/shared/contracts";
import { createCommandRuntimeState, reduceCommandEvent, type CommandRuntimeState } from "@/domains/realtime/commandRuntime";
import {
  createRealtimeEventState,
  frontViewNamesForRealtimeEvent,
  reduceRealtimeEvent,
  type EventEnvelope,
  type RealtimeEventState
} from "@/domains/realtime/eventEnvelope";
import { createDeskTransport, type RealtimeTransportStatus } from "@/shared/transport";

export type RealtimeStatus = {
  now: Date;
  heartbeatLabel: string;
  connectionStatus: RealtimeTransportStatus;
  latestError: string | null;
  events: RealtimeEventState;
  commands: CommandRuntimeState;
  resyncing: boolean;
};

export const RealtimeContext = createContext<RealtimeStatus | null>(null);

type RealtimeProviderProps = {
  config: DeskAppConfig;
  queryClient: QueryClient;
  children: ReactNode;
};

export function RealtimeProvider({ config, queryClient, children }: RealtimeProviderProps) {
  const [now, setNow] = useState(() => new Date());
  const [connectionStatus, setConnectionStatus] = useState<RealtimeTransportStatus>(
    "CONNECTING"
  );
  const [latestError, setLatestError] = useState<string | null>(null);
  const [events, setEvents] = useState<RealtimeEventState>(() => loadPersistedRealtimeState(config));
  const [commands, setCommands] = useState<CommandRuntimeState>(() => createCommandRuntimeState());
  const [resyncing, setResyncing] = useState(false);
  const connectionStatusRef = useRef<RealtimeTransportStatus>("CONNECTING");
  const initialEventsRef = useRef(events);
  const pendingInvalidationsRef = useRef(new Set<FrontViewName>());
  const invalidationTimerRef = useRef<number | null>(null);
  const transport = useMemo(() => createDeskTransport(config), [config]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const scheduleViewInvalidations = (viewNames: readonly FrontViewName[]) => {
      viewNames.forEach((viewName) => pendingInvalidationsRef.current.add(viewName));
      if (invalidationTimerRef.current !== null) return;
      invalidationTimerRef.current = window.setTimeout(() => {
        const pending = [...pendingInvalidationsRef.current];
        pendingInvalidationsRef.current.clear();
        invalidationTimerRef.current = null;
        pending.forEach((viewName) => {
          void queryClient.invalidateQueries({ queryKey: ["front-view", viewName] });
        });
      }, 100);
    };
    const subscription = transport.subscribeEvents({
      onEvent(event: EventEnvelope) {
        if (event.eventType === "desk.resync_required") {
          clearPersistedRealtimeCursor(config);
          setResyncing(true);
          const affected = frontViewNamesForRealtimeEvent(event);
          void Promise.all(affected.map((viewName) => queryClient.refetchQueries({ queryKey: ["front-view", viewName] })))
            .finally(() => {
              setEvents(createRealtimeEventState());
              setResyncing(false);
            });
          return;
        }
        setEvents((current) => {
          const next = reduceRealtimeEvent(current, event);
          persistRealtimeCursor(config, next.lastEventId);
          if (next.sequenceGapCount > current.sequenceGapCount) {
            setResyncing(true);
            const affected = frontViewNamesForRealtimeEvent(event);
            void Promise.all(affected.map((viewName) => queryClient.refetchQueries({ queryKey: ["front-view", viewName] })))
              .finally(() => setResyncing(false));
          }
          return next;
        });
        setCommands((current) => reduceCommandEvent(current, event));
        scheduleViewInvalidations(frontViewNamesForRealtimeEvent(event));
        setLatestError(null);
      },
      onStatus(status) {
        const previous = connectionStatusRef.current;
        connectionStatusRef.current = status;
        setConnectionStatus(status);
        if (status === "OPEN" && previous === "RECONNECTING") {
          setResyncing(true);
          void Promise.all([
            queryClient.refetchQueries({ queryKey: ["front-view", "command-center"] }),
            queryClient.refetchQueries({ queryKey: ["front-view", "live-trading"] }),
          ]).finally(() => setResyncing(false));
        }
      },
      onError(error) {
        setLatestError(error.message);
      }
    }, initialEventsRef.current);

    return () => {
      subscription.close();
      if (invalidationTimerRef.current !== null) window.clearTimeout(invalidationTimerRef.current);
      invalidationTimerRef.current = null;
      pendingInvalidationsRef.current.clear();
    };
  }, [config, queryClient, transport]);

  const value = useMemo<RealtimeStatus>(
    () => ({
      now,
      heartbeatLabel: new Intl.DateTimeFormat("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(now),
      connectionStatus,
      latestError,
      events,
      commands,
      resyncing
    }),
    [commands, connectionStatus, events, latestError, now, resyncing]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

const REALTIME_CURSOR_VERSION = 1;

export function realtimeCursorStorageKey(config: DeskAppConfig, origin = typeof window === "undefined" ? "server" : window.location.origin): string {
  return `desk-vnext:realtime-cursor:v${REALTIME_CURSOR_VERSION}:${origin}:${config.frontApiBaseUrl}`;
}

export function loadPersistedRealtimeState(config: DeskAppConfig): RealtimeEventState {
  const empty = createRealtimeEventState();
  if (typeof window === "undefined" || !window.localStorage) return empty;
  try {
    const raw = window.localStorage.getItem(realtimeCursorStorageKey(config));
    const value = raw ? JSON.parse(raw) as { eventId?: unknown } : null;
    return typeof value?.eventId === "string" && value.eventId
      ? { ...empty, lastEventId: value.eventId }
      : empty;
  } catch {
    return empty;
  }
}

export function persistRealtimeCursor(config: DeskAppConfig, eventId: string | null): void {
  if (!eventId || typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(realtimeCursorStorageKey(config), JSON.stringify({ eventId }));
  } catch {
    // Cursor persistence is best-effort and contains no credential or payload.
  }
}

export function clearPersistedRealtimeCursor(config: DeskAppConfig): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(realtimeCursorStorageKey(config));
  } catch {
    // A blocked storage API must not break the read-only realtime surface.
  }
}
