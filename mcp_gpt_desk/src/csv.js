export function parseCsv(text, { maxRows = 1000 } = {}) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) {
    return [];
  }
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    if (rows.length >= maxRows) {
      break;
    }
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = coerceCsvValue(values[index] ?? "");
    });
    rows.push(row);
  }
  return rows;
}

export function trimCsv(text, { maxRows = 1000 } = {}) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) {
    return "";
  }
  return lines.slice(0, Math.max(1, maxRows + 1)).join("\n") + "\n";
}

export function parseCsvLine(line) {
  const values = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(value);
      value = "";
      continue;
    }
    value += char;
  }

  values.push(value);
  return values;
}

function coerceCsvValue(value) {
  const text = String(value ?? "").trim();
  if (text === "") {
    return "";
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }
  return text;
}
