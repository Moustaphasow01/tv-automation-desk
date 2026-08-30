export function projectOperationalServices(rows = [], { expectedServices = [], staleAfterSeconds = 90 } = {}) {
  const expected = new Set(expectedServices);
  const projected = rows.map((row) => ({
    ...row,
    age_seconds: Number(row.age_seconds || 0),
    healthy: ["healthy", "starting"].includes(row.status)
      && Number(row.age_seconds || 0) <= staleAfterSeconds,
  }));
  const actualServiceIds = new Set(projected.map((service) => service.service_id));
  const missingServices = expectedServices.filter((serviceId) => !actualServiceIds.has(serviceId));
  const services = projected.filter((service) => service.status !== "stopped" || expected.has(service.service_id));
  const ok = missingServices.length === 0 && projected.every((service) => {
    if (service.status === "stopped" && !expected.has(service.service_id)) return true;
    return service.healthy || service.status === "disabled";
  });
  return { ok, services, missingServices };
}
