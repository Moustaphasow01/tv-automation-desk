export const FRONT_REQUEST_TIMEOUT_MS = 12_000;

interface FetchJsonOptions {
  label?: string;
  timeoutMs?: number;
}

export async function fetchJsonWithTimeout<T>(url: string, init: RequestInit = {}, options: FetchJsonOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? FRONT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
      throw new Error(payload?.code ? `${payload.code}: ${payload.error || response.statusText}` : payload?.error || `API ${response.status}: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`TIMEOUT_AFTER_${timeoutMs}MS: ${options.label || url} ne répond pas assez vite.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
