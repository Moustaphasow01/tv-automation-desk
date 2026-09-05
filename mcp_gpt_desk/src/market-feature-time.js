export function parisOffsetForDate(dateText) {
  const date = new Date(`${dateText}T12:00:00Z`);
  const year = date.getUTCFullYear();
  const dstStart = lastSundayUtc(year, 2);
  const dstEnd = lastSundayUtc(year, 9);
  return date >= dstStart && date < dstEnd ? "+02:00" : "+01:00";
}

export function lastSundayUtc(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date;
}
