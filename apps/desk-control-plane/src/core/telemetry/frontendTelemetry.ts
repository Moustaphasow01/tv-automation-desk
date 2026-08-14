export type FrontTelemetryEvent = {
  name: "front.query.succeeded" | "front.query.failed" | "front.view.state";
  at: string;
  context: Record<string, string | number | boolean | null>;
};

export function emitFrontTelemetry(name: FrontTelemetryEvent["name"], context: FrontTelemetryEvent["context"]) {
  if (typeof window === "undefined") return;
  const event: FrontTelemetryEvent = { name, at: new Date().toISOString(), context };
  window.dispatchEvent(new CustomEvent("desk:telemetry", { detail: event }));
}
