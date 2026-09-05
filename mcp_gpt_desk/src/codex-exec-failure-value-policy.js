export function classifyCodexFailure(result) {
  const diagnostic = `${result.stderr || ""}\n${result.stdout || ""}`.toLowerCase();
  if (diagnostic.includes("401") || diagnostic.includes("authentication") || diagnostic.includes("login")) {
    return codexError("CODEX_AUTH_REQUIRED", "Codex authentication is missing or invalid.", {
      stderr: tail(result.stderr),
    });
  }
  if (diagnostic.includes("429") || diagnostic.includes("rate limit")) {
    return codexError("CODEX_RATE_LIMITED", "Codex is temporarily rate limited.", {
      stderr: tail(result.stderr),
    }, true);
  }
  return codexError("CODEX_EXEC_FAILED", `Codex exited with code ${result.exitCode}.`, {
    stderr: tail(result.stderr),
    stdout: tail(result.stdout),
  }, true);
}

export function codexError(code, message, details = undefined, retryable = false) {
  return Object.assign(new Error(message), { code, details, retryable });
}

export function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

export function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function tail(value, max = 4_000) {
  const text = String(value || "");
  return text.length <= max ? text : text.slice(-max);
}
