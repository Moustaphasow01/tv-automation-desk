import {
  FRONT_CONTROL_PLANE_EVENTS_PATH,
  handleFrontControlPlane,
  isFrontControlPlaneMethodAllowed,
  isFrontControlPlanePath,
  isFrontControlPlaneWriteRequest,
  writeFrontControlPlaneEvents,
} from "./front-control-plane-api.js";
import {
  buildFrontErrorEvent,
  buildFrontHeartbeatEvent,
  buildFrontOperationsEvent,
  frontEventSseFrame,
  shouldEmitFrontEvent,
} from "./front-events-contract-v1.js";

export {
  isFrontControlPlaneMethodAllowed,
  isFrontControlPlanePath,
  isFrontControlPlaneWriteRequest,
};

export async function handleFrontControlPlaneHttp({
  store,
  req,
  res,
  pathname,
  query = {},
  corsHeaders = {},
  auth = {},
  operatorWrite = false,
  readJsonBody,
  sendJson,
  sendFrontResource,
  clientIp = null,
}) {
  if (pathname === FRONT_CONTROL_PLANE_EVENTS_PATH) {
    writeFrontControlPlaneEvents(store, req, res, query, corsHeaders);
    return;
  }

  const body = operatorWrite ? await readJsonBody(req, 64_000) : undefined;
  const payload = await handleFrontControlPlane(store, {
    pathname,
    method: req.method,
    query,
    body: body || {},
    headers: req.headers,
    actor: {
      kind: auth.kind,
      email: auth.email || null,
      uid: auth.uid || null,
      scopes: auth.scopes || [],
      clientIp,
    },
  });
  const headers = { ...corsHeaders, "cache-control": "no-store" };
  operatorWrite ? sendJson(res, 200, payload, headers) : sendFrontResource(req, res, payload, corsHeaders, 2);
}

export async function handleFrontOperationsEvents(store, req, res, input, corsHeaders) {
  res.writeHead(200, {
    ...corsHeaders,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  let lastEventId = String(input.cursor || input.last_event_id || req.headers["last-event-id"] || "");
  let closed = false, busy = false;
  const emit = async () => {
    if (closed || res.writableEnded || busy) return;
    busy = true;
    try {
      const event = buildFrontOperationsEvent(await store.getOperationsSummary(input));
      if (shouldEmitFrontEvent(event, { lastEventId })) {
        lastEventId = event.event_id;
        res.write(frontEventSseFrame(event));
      } else {
        res.write(`retry: 5000\n${frontEventSseFrame(buildFrontHeartbeatEvent({ lastEventId }))}`);
      }
    } catch (error) {
      res.write(frontEventSseFrame(buildFrontErrorEvent(error, { lastEventId })));
    } finally {
      busy = false;
    }
  };

  await emit();
  const interval = setInterval(emit, 10_000);
  req.on("close", () => {
    closed = true;
    clearInterval(interval);
  });
}
