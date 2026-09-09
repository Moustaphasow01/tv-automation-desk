export function positionNumber(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "Non publié" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 8 }).format(value);
}

export function positionR(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "Non publié" : new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" }).format(value) + " R";
}

export function positionDate(value: string | undefined): string {
  const date = value ? new Date(value) : null;
  return !date || !Number.isFinite(date.getTime()) ? "Non publiée" : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(date) + " Paris";
}
