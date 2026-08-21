import type { DeskAppConfig } from "@/app/appConfig";
import { assertCommandAccepted, assertCommandSnapshot, buildCommandHeaders, prepareDeskCommand, type CommandAccepted, type CommandSnapshot, type SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import { assertEventEnvelope, type EventEnvelope, type RealtimeEventState } from "@/domains/realtime/eventEnvelope";
import type { CapabilityCatalog, FrontViewName, ViewEnvelope } from "@/shared/contracts";

export type RealtimeTransportStatus = "CONNECTING" | "OPEN" | "RECONNECTING" | "CLOSED" | "FAILED";

export type RealtimeEventHandlers = {
  onEvent(event: EventEnvelope): void;
  onStatus?(status: RealtimeTransportStatus): void;
  onError?(error: Error): void;
};

export type RealtimeSubscription = {
  close(): void;
};

export type OperatorLoginCredentials = {
  login: string;
  password: string;
};

export type DeskTransport = {
  getView<T>(viewName: FrontViewName, params?: Readonly<Record<string, string | undefined>>): Promise<ViewEnvelope<T>>;
  getCommand(commandId: string): Promise<CommandSnapshot>;
  getCapabilities(): Promise<CapabilityCatalog>;
  subscribeEvents(handlers: RealtimeEventHandlers, lastState?: RealtimeEventState): RealtimeSubscription;
  submitCommand(input: SubmitDeskCommandInput): Promise<CommandAccepted>;
  loginOperator(credentials: OperatorLoginCredentials | string): Promise<void>;
  logoutOperator(): Promise<void>;
};

export function createDeskTransport(config: DeskAppConfig): DeskTransport {
  return createBffTransport(config);
}

function createBffTransport(config: DeskAppConfig): DeskTransport {
  return {
    async getView<T>(viewName: FrontViewName, params: Readonly<Record<string, string | undefined>> = {}): Promise<ViewEnvelope<T>> {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), config.frontApiTimeoutMs);

      try {
        const search = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value) search.set(key, value);
        });
        const query = search.toString();
        const url = `${config.frontApiBaseUrl}/views/${viewName}${query ? `?${query}` : ""}`;
        const response = await fetch(url, {
          cache: "no-store",
          credentials: "include",
          headers: {
            Accept: "application/json"
          },
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`BFF_VIEW_FAILED_${response.status}`);
        }

        return (await response.json()) as ViewEnvelope<T>;
      } finally {
        window.clearTimeout(timeout);
      }
    },
    async getCommand(commandId: string): Promise<CommandSnapshot> {
      const response = await fetch(`${config.frontApiBaseUrl}/commands/${encodeURIComponent(commandId)}`, {
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`BFF_COMMAND_STATUS_FAILED_${response.status}`);
      return assertCommandSnapshot(await response.json());
    },
    async getCapabilities(): Promise<CapabilityCatalog> {
      const response = await fetch(`${config.frontApiBaseUrl}/capabilities`, { cache: "no-store", credentials: "include", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`BFF_CAPABILITIES_FAILED_${response.status}`);
      return (await response.json()) as CapabilityCatalog;
    },
    subscribeEvents(handlers: RealtimeEventHandlers, lastState?: RealtimeEventState): RealtimeSubscription {
      let closed = false;
      let source: EventSource | null = null;
      let reconnectTimer: number | null = null;
      let reconnectAttempt = 0;
      let lastEventId = lastState?.lastEventId ?? null;

      const parseMessage = (data: string) => {
        try {
          const event = assertEventEnvelope(JSON.parse(data));
          lastEventId = event.eventType === "desk.resync_required" ? null : event.eventId;
          handlers.onEvent(event);
        } catch (error) {
          handlers.onError?.(error instanceof Error ? error : new Error("BFF_EVENTS_INVALID_MESSAGE"));
        }
      };

      const startSse = (status: RealtimeTransportStatus = "CONNECTING") => {
        if (closed) return;
        if (typeof EventSource === "undefined") {
          const error = Object.assign(new Error("BFF_EVENTS_UNSUPPORTED"), { code: "BFF_EVENTS_UNSUPPORTED" });
          handlers.onStatus?.("FAILED");
          handlers.onError?.(error);
          return;
        }

        handlers.onStatus?.(status);
        source = new EventSource(buildRealtimeSseUrl(config.frontApiBaseUrl, lastEventId));
        source.onopen = () => {
          reconnectAttempt = 0;
          handlers.onStatus?.("OPEN");
        };
        source.onerror = () => {
          if (closed) {
            return;
          }

          source?.close();
          source = null;
          handlers.onError?.(Object.assign(new Error("BFF_EVENTS_RECONNECTING"), { code: "BFF_EVENTS_RECONNECTING" }));
          const delayMs = Math.min(1_000 * 2 ** reconnectAttempt, 10_000);
          reconnectAttempt += 1;
          reconnectTimer = window.setTimeout(() => startSse("RECONNECTING"), delayMs);
        };
        source.onmessage = (message) => parseMessage(message.data);
      };

      startSse();

      return {
        close() {
          closed = true;
          if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
          source?.close();
          handlers.onStatus?.("CLOSED");
        }
      };
    },
    async submitCommand(input: SubmitDeskCommandInput): Promise<CommandAccepted> {
      const prepared = prepareDeskCommand(normalizeBffCommandInput(input));
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), config.frontApiTimeoutMs);

      try {
        const response = await fetch(`${config.frontApiBaseUrl}/commands`, {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: buildCommandHeaders(prepared),
          body: JSON.stringify({
            commandType: prepared.commandType,
            payload: prepared.payload ?? {},
            environment: prepared.environment,
            expectedVersion: prepared.expectedVersion,
            reason: prepared.reason,
            requestedAt: prepared.requestedAt
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`BFF_COMMAND_FAILED_${response.status}`);
        }

        return assertCommandAccepted(await response.json(), prepared);
      } finally {
        window.clearTimeout(timeout);
      }
    },
    async loginOperator(credentials: OperatorLoginCredentials | string): Promise<void> {
      await submitOperatorAuthRequest(`${config.operatorAuthBaseUrl}/login`, operatorLoginPayload(credentials));
    },
    async logoutOperator(): Promise<void> {
      await submitOperatorAuthRequest(`${config.operatorAuthBaseUrl}/logout`);
    }
  };
}

function operatorLoginPayload(credentials: OperatorLoginCredentials | string): Record<string, string> {
  if (typeof credentials === "string") return { pin: credentials };
  return { login: credentials.login, password: credentials.password };
}

async function submitOperatorAuthRequest(url: string, body?: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(String(payload?.error || `OPERATOR_AUTH_FAILED_${response.status}`));
  }
}

function normalizeBffCommandInput(input: SubmitDeskCommandInput): SubmitDeskCommandInput {
  if (input.environment !== "MOCK") {
    return input;
  }

  return {
    ...input,
    environment: "PAPER"
  };
}

export function buildRealtimeSseUrl(baseUrl: string, cursor?: string | null, origin = window.location.origin): string {
  const url = new URL(`${baseUrl}/events`, origin);
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  return url.toString();
}
