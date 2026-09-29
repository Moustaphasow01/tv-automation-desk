// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { BatchTable, BatchStats } from "./BatchTable";
import { BatchForm } from "./BatchForm";
import { dayRequest, valueLabel } from "./model";
import { isOosDay, type OosDay } from "@/domains/front-api/oosBatchContract";
import { createOosClient } from "@/domains/front-api/oosBatchRepository";
const day: OosDay = { batch_id: "SYNTHETIC", day: "2026-07-01", state: "FROZEN", checkpoint: "FROZEN", capture_count: 8, candidate_attempt: 1,
  definition: { symbol: "TEST_ONLY", cutoff: "2026-07-01T09:00:00+02:00", date: "2026-07-01" }, updated_at: "2026-09-29T12:00:00Z",
  plan_sha256: "a".repeat(64), manifest_sha256: "b".repeat(64), allowed_actions: ["replay"], metrics: { net_r: null }, error: null, audit: null };
describe("OOS technical monitoring", () => {
  it("guards response data and preserves missing vs zero", () => {
    expect(isOosDay(day)).toBe(true); expect(isOosDay({ ...day, state: "APPROVED_TRADE" })).toBe(false);
    expect(isOosDay({ ...day, metrics: { net_r: NaN } })).toBe(false);
    expect(valueLabel(null)).toBe("Non fourni"); expect(valueLabel(0)).toBe("0");
    expect(dayRequest(day, "replay").cutoff_time).toBe("09:00");
  });
  it("shows an empty state, missing data and no write button to read-only users", () => {
    const props = { select: vi.fn(), submit: vi.fn(), disabled: false, canWrite: false };
    expect(renderToStaticMarkup(<BatchTable {...props} rows={[]} />)).toContain("Aucune journée");
    const html = renderToStaticMarkup(<BatchTable {...props} rows={[day]} />);
    expect(html).toContain("Non fourni"); expect(html).not.toContain(">Rejouer<"); expect(html).toContain("8 / 8");
    const stats = { days: 1, completed: 0, metrics: { net_r: { observed_days: 0, total_days: 0, sum: null, mean: null, median: null } } };
    expect(renderToStaticMarkup(<BatchStats stats={stats} />)).toContain("Non fourni");
  });
  it("requires an explicit cutoff and switches period fields without inventing defaults", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
    try {
      await act(async () => root.render(<BatchForm disabled={false} submit={vi.fn()} />));
      expect(host.querySelector<HTMLInputElement>('[name="cutoff_time"]')?.value).toBe("");
      const select = host.querySelector("select")!;
      await act(async () => { select.value = "range"; select.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(host.querySelector('[name="from"]')).not.toBeNull(); expect(host.querySelector('[name="date"]')).toBeNull();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("uses authenticated BFF transport and identical command ID on network retry", async () => {
    const receipt = { command_id: "same-id", status: "QUEUED", completed_days: 0, total_days: 1, receipts: [] };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => receipt }); vi.stubGlobal("fetch", fetcher);
    try {
      const client = createOosClient("/front-api/v1"), input = dayRequest(day, "replay");
      await client.submit(input, "same-id"); await client.submit(input, "same-id");
      expect(fetcher.mock.calls[0][1].credentials).toBe("include");
      expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    } finally { vi.unstubAllGlobals(); }
  });
});
