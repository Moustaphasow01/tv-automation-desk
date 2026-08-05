export class FixedWindowRateLimiter {
  constructor({ limit, windowMs, clock = () => Date.now(), maxKeys = 10_000 }) {
    this.limit = Math.max(1, Number(limit) || 1);
    this.windowMs = Math.max(1_000, Number(windowMs) || 60_000);
    this.clock = clock;
    this.maxKeys = Math.max(100, Number(maxKeys) || 10_000);
    this.entries = new Map();
  }

  consume(key) {
    const now = this.clock();
    const normalizedKey = String(key || "unknown");
    let entry = this.entries.get(normalizedKey);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
    }
    entry.count += 1;
    this.entries.set(normalizedKey, entry);
    if (this.entries.size > this.maxKeys) this.prune(now);
    return {
      allowed: entry.count <= this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      resetAt: entry.resetAt,
    };
  }

  prune(now = this.clock()) {
    for (const [key, entry] of this.entries) {
      if (now >= entry.resetAt) this.entries.delete(key);
      if (this.entries.size <= this.maxKeys) break;
    }
  }
}
