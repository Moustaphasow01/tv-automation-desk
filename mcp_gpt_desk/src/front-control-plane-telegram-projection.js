import { rows, text, upper, firstValue, number } from "./front-control-plane-projection-helpers.js";

export function telegramDrilldownFromHealth(health = {}) {
  const service = rows(health?.operations?.services).find((item) => ["telegram_alerting", "telegram_alert_worker"].includes(text(item.service_kind || item.service_id, ""))) || null;
  if (!service) {
    return {
      schemaVersion: "telegram_drilldown_front_v1",
      availability: "UNAVAILABLE",
      enabled: false,
      healthy: false,
      reason: "Telegram service health is not exposed by the backend health source.",
      secretsExposed: false,
    };
  }
  const details = service.details || {};
  const environment = details.environment || {};
  const deliveries = rows(details.deliveries);
  const latestDelivery = deliveries[0] || null;
  const destinations = [
    telegramDestination("administration", environment.adminConfigured, deliveries, "admin"),
    telegramDestination("trading", environment.tradingConfigured, deliveries, "trading"),
  ].filter((item) => item.configured || item.observed);
  return {
    schemaVersion: "telegram_drilldown_front_v1",
    availability: "KNOWN",
    enabled: environment.workerEnabled === true || (environment.workerEnabled == null && service.enabled !== false),
    healthy: service.healthy === true || ["HEALTHY", "OK", "READY", "RUNNING"].includes(upper(service.status || service.health)),
    status: text(service.status || service.health, "UNKNOWN"),
    lastHeartbeatAt: text(service.last_heartbeat_at_utc || service.heartbeat_at_utc, "unavailable"),
    destinations,
    lastDeliveryAt: text(firstValue(latestDelivery?.sent_at_utc, latestDelivery?.last_delivery_at_utc), ""),
    deliveryStatus: text(firstValue(latestDelivery?.status, deliveries.length ? "OBSERVED" : "IDLE"), "IDLE").toUpperCase(),
    errorReason: text(firstValue(latestDelivery?.error, latestDelivery?.last_error, details.error, service.error_reason, service.last_error), ""),
    secretsExposed: false,
  };
}

function telegramDestination(label, configured, deliveries, profile) {
  const delivery = deliveries.find((item) => text(item.profile, "").toLowerCase() === profile) || null;
  return {
    label,
    configured: configured === true,
    observed: Boolean(delivery),
    lastDeliveryAt: text(firstValue(delivery?.sent_at_utc, delivery?.last_delivery_at_utc), ""),
    deliveryStatus: text(delivery?.status, delivery ? "OBSERVED" : "IDLE").toUpperCase(),
    retryCount: number(firstValue(delivery?.attempt_count, delivery?.retry_count), 0),
    errorReason: text(firstValue(delivery?.error, delivery?.last_error), ""),
  };
}
