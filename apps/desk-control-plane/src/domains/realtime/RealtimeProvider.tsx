import { createContext, type ReactNode, useEffect, useMemo, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { DeskAppConfig } from "@/app/appConfig";
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
  const [events, setEvents] = useState<RealtimeEventState>(() => createRealtimeEventState());
  const [commands, setCommands] = useState<CommandRuntimeState>(() => createCommandRuntimeState());
  const transport = useMemo(() => createDeskTransport(config), [config]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const subscription = transport.subscribeEvents({
      onEvent(event: EventEnvelope) {
        setEvents((current) => reduceRealtimeEvent(current, event));
        setCommands((current) => reduceCommandEvent(current, event));
        for (const viewName of frontViewNamesForRealtimeEvent(event)) {
          void queryClient.invalidateQueries({ queryKey: ["front-view", viewName] });
        }
        setLatestError(null);
      },
      onStatus(status) {
        setConnectionStatus(status);
      },
      onError(error) {
        setLatestError(error.message);
      }
    });

    return () => subscription.close();
  }, [queryClient, transport]);

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
      commands
    }),
    [commands, connectionStatus, events, latestError, now]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
