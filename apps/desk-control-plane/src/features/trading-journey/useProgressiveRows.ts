import { useState } from "react";

/** Presentation pagination only: never modifies the source rows or their order. */
export function useProgressiveRows<T>(rows: readonly T[], filterKey: string, pageSize = 12) {
  const [page, setPage] = useState({ key: filterKey, limit: pageSize });
  const limit = page.key === filterKey ? page.limit : pageSize;
  return {
    visible: rows.slice(0, limit),
    hasMore: rows.length > limit,
    showMore: () => setPage({ key: filterKey, limit: limit + pageSize }),
  };
}
