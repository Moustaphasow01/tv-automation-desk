export function toolResult(data, isError = false, meta = undefined, text = undefined) {
  const contentText = text !== undefined
    ? String(text)
    : isError ? errorText(data) : null;
  const metrics = resultTransportMetrics(data, contentText);
  const result = {
    structuredContent: data,
    content: contentText === null ? [] : [{ type: "text", text: contentText }],
    isError,
  };
  result._meta = {
    ...(meta || {}),
    "desk/transport": {
      ...(meta?.["desk/transport"] || {}),
      ...metrics,
    },
  };
  return result;
}

export function resultTransportMetrics(data, text = null) {
  const structuredBytes = Buffer.byteLength(JSON.stringify(data ?? null));
  const contentBytes = text === null || text === undefined ? 0 : Buffer.byteLength(String(text));
  return {
    structured_bytes: structuredBytes,
    content_bytes: contentBytes,
    total_payload_bytes: structuredBytes + contentBytes,
    double_serialized: false,
  };
}

export function publicError(error) {
  return error && error.message ? error.message : String(error || "unknown_error");
}

function errorText(data) {
  const message = data?.error || data?.message || "tool_error";
  return JSON.stringify({ ok: false, error: message });
}
