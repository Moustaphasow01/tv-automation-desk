const DEFAULT_API_ROOT = "https://api.telegram.org";

export class TelegramClient {
  constructor({ token, profile, fetchImpl = globalThis.fetch, apiRoot = DEFAULT_API_ROOT } = {}) {
    this.token = String(token || "").trim();
    this.profile = String(profile || "unknown");
    this.fetch = fetchImpl;
    this.apiRoot = String(apiRoot || DEFAULT_API_ROOT).replace(/\/+$/, "");
  }

  get configured() {
    return Boolean(this.token);
  }

  async getMe() {
    return this.#call("getMe", {});
  }

  async sendMessage({ chatId, text, silent = false } = {}) {
    const message = String(text || "").trim();
    if (!message) throw telegramError("TELEGRAM_MESSAGE_EMPTY", "Telegram message is empty.");
    return this.#call("sendMessage", {
      chat_id: String(chatId || ""),
      text: message.slice(0, 4000),
      disable_notification: Boolean(silent),
      disable_web_page_preview: true,
    });
  }

  async getUpdates({ offset = 0, limit = 20 } = {}) {
    return this.#call("getUpdates", {
      offset: Number(offset) || 0,
      limit: Math.max(1, Math.min(Number(limit) || 20, 100)),
      timeout: 0,
      allowed_updates: ["message"],
    });
  }

  async deleteMessage({ chatId, messageId } = {}) {
    return this.#call("deleteMessage", {
      chat_id: String(chatId || ""),
      message_id: Number(messageId),
    });
  }

  async #call(method, payload) {
    if (!this.configured) throw telegramError("TELEGRAM_NOT_CONFIGURED", `Telegram ${this.profile} bot is not configured.`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetch(`${this.apiRoot}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok !== true) {
        const code = Number(data?.error_code || response.status || 500);
        throw telegramError(
          `TELEGRAM_HTTP_${code}`,
          `Telegram ${this.profile} request failed (${code}): ${String(data?.description || response.statusText || "unknown error").slice(0, 300)}`,
          { retryable: code === 429 || code >= 500, statusCode: code },
        );
      }
      return data.result;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw telegramError("TELEGRAM_TIMEOUT", `Telegram ${this.profile} request timed out.`, { retryable: true });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function telegramError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}
