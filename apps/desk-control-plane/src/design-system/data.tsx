import type { ReactNode } from "react";
import type { DeskTone } from "@/design-system/tokens";
import { StatusBadge } from "@/design-system/primitives";
import type { DataValue } from "@/shared/contracts";

export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyLabel = "Aucune donnée",
  caption
}: {
  columns: readonly DataColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  emptyLabel?: string;
  caption?: string;
}) {
  if (rows.length === 0) {
    return <p className="empty-state">{emptyLabel}</p>;
  }
  const rowKeys = stableUniqueRowKeys(rows, rowKey);

  return (
    <div className="data-table-wrap" tabIndex={0} aria-label={caption ?? "Tableau de données défilable"}>
      <table className="data-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align ? `align-${column.align}` : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKeys[index]}>
              {columns.map((column) => (
                <td key={column.key} className={column.align ? `align-${column.align}` : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stableUniqueRowKeys<T>(rows: readonly T[], rowKey: (row: T) => string) {
  const seen = new Map<string, number>();
  return rows.map((row, index) => {
    const key = rowKey(row);
    const safeKey = key.trim() || `row-${index}`;
    const count = seen.get(safeKey) ?? 0;
    seen.set(safeKey, count + 1);
    return count === 0 ? safeKey : `${safeKey}__duplicate_${count}`;
  });
}

/** Renders a backend truth state without coercing unknown values into business data. */
export function DataValueText<T>({
  data,
  format = (value) => String(value)
}: {
  data: DataValue<T>;
  format?: (value: T) => string;
}) {
  if (data.state === "KNOWN") {
    return <span className="data-value data-value--known" title={`${data.source} · ${data.asOf}`}>{format(data.value)}</span>;
  }
  if (data.state === "STALE") {
    return <span className="data-value data-value--stale" title={data.reason}>{format(data.value)} · périmé</span>;
  }
  if (data.state === "PARTIAL" && data.value !== undefined) {
    return <span className="data-value data-value--partial" title={data.reason}>{format(data.value)} · partiel</span>;
  }
  const label: Record<Exclude<DataValue<T>["state"], "KNOWN" | "STALE">, string> = {
    UNKNOWN: "Inconnu",
    UNAVAILABLE: "Indisponible",
    PARTIAL: "Partiel",
    NOT_IMPLEMENTED: "Non implémenté",
    DISCONNECTED: "Déconnecté",
    ERROR: "Erreur",
    FORBIDDEN: "Accès refusé",
    NOT_APPLICABLE: "Non applicable"
  };
  return <span className={`data-value data-value--${data.state.toLowerCase()}`} title={data.reason}>{label[data.state]}</span>;
}

export function MobileDataList<T>({
  rows,
  rowKey,
  renderTitle,
  renderMeta,
  renderBody
}: {
  rows: readonly T[];
  rowKey: (row: T) => string;
  renderTitle: (row: T) => ReactNode;
  renderMeta?: (row: T) => ReactNode;
  renderBody: (row: T) => ReactNode;
}) {
  const rowKeys = stableUniqueRowKeys(rows, rowKey);
  return (
    <div className="mobile-data-list">
      {rows.map((row, index) => (
        <article key={rowKeys[index]} className="mobile-data-item">
          <header>
            <strong>{renderTitle(row)}</strong>
            {renderMeta ? <span>{renderMeta(row)}</span> : null}
          </header>
          <div>{renderBody(row)}</div>
        </article>
      ))}
    </div>
  );
}

export type TimelineEvent = {
  id: string;
  title: string;
  at: string;
  tone?: DeskTone;
  description?: string;
};

export function Timeline({ events }: { events: readonly TimelineEvent[] }) {
  return (
    <ol className="timeline">
      {events.map((event) => (
        <li key={event.id} className={`timeline__item timeline__item--${event.tone ?? "neutral"}`}>
          <span>{formatTime(event.at)}</span>
          <strong>{event.title}</strong>
          {event.description ? <p>{event.description}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function EventBadge({
  eventType,
  tone = "info"
}: {
  eventType: string;
  tone?: DeskTone;
}) {
  return <StatusBadge tone={tone}>{eventType}</StatusBadge>;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
