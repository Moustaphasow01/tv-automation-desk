// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { PreparationForm, PreparationProgress } from "./PreparationPanel";
import { isPreparation, isPreparationDay, type OosPreparation } from "@/domains/front-api/oosPreparationContract";
import { createOosClient } from "@/domains/front-api/oosBatchRepository";

const day = { date: "2026-07-29", state: "PREMARKET_READY", checkpoint: "PREMARKET_READY", capture_count: 8,
  manifest_sha256: "a".repeat(64), plan_sha256: null, replay_status: "NOT_REQUESTED", queue_status: "NOT_QUEUED", error: null, updated_at: "2026-10-01T00:00:00Z" };
const data: OosPreparation = { archive_batch_id: "SYNTHETIC", batch_id: null, start_date: "2026-07-27", end_date: "2026-07-29", status: "SNAPSHOT",
  total_days: 3, ready: 1, queued: 2, failed: 0, completed: 0, premarket_ready: 1, next_waiting_scenario: day.date,
  concurrency: 1, current_queue: ["2026-07-27", "2026-07-28"], skipped_dates: [], batches: [], days: [day] };
describe("neutral premarket orchestration UI", () => {
  it("validates hashes/capture completeness and never manufactures a successful result", () => {
    expect(isPreparation(data)).toBe(true); expect(isPreparationDay(day)).toBe(true);
    expect(isPreparationDay({ ...day, capture_count: 9 })).toBe(false);
    expect(isPreparationDay({ ...day, manifest_sha256: "bad" })).toBe(false);
    expect(isPreparation({ ...data, failed: undefined })).toBe(false);
  });
  it("shows authoritative counts, current queue and next scenario date", () => {
    const html = renderToStaticMarkup(<PreparationProgress data={data} />);
    expect(html).toContain("1 / 3"); expect(html).toContain("PREMARKET_READY");
    expect(html).toContain("29 juil."); expect(html).toContain("concurrence effective");
    expect(html).not.toContain("net R"); expect(html).not.toContain("LONG");
    expect(renderToStaticMarkup(<PreparationProgress data={{ ...data, days: [{ ...day, error: { code: "TECHNICAL_TIMEOUT" } }] }} />)).toContain("TECHNICAL_TIMEOUT");
  });
  it("day/range controls post real minimal contracts, with persistent labels and explicit period", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"), root = createRoot(host), submit = vi.fn(); document.body.append(host);
    try {
      await act(async () => root.render(<PreparationForm disabled={false} submit={submit} />));
      const input = host.querySelector<HTMLInputElement>('[name="date"]')!; input.value = "2026-07-29";
      await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(submit).toHaveBeenLastCalledWith({ date: "2026-07-29" });
      const mode = host.querySelector("select")!;
      await act(async () => { mode.value = "range"; mode.dispatchEvent(new Event("change", { bubbles: true })); });
      host.querySelector<HTMLInputElement>('[name="start_date"]')!.value = "2026-07-27";
      host.querySelector<HTMLInputElement>('[name="end_date"]')!.value = "2026-07-29";
      await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(submit).toHaveBeenLastCalledWith({ start_date: "2026-07-27", end_date: "2026-07-29" });
      expect(host.querySelector('button[type="submit"]')!.textContent).toBe("Préparer plage");
      await act(async () => root.render(<PreparationForm disabled={true} submit={submit} />));
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("BFF request retries retain identical minimal preparation payload and authenticated transport", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => day }); vi.stubGlobal("fetch", fetcher);
    try {
      const client = createOosClient("/oos/front-api/v1");
      await client.prepare({ date: day.date }); await client.prepare({ date: day.date });
      expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
      expect(fetcher.mock.calls[0][1].credentials).toBe("include");
      expect(fetcher.mock.calls[0][0]).toContain("prepare-premarket");
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ date: day.date });
    } finally { vi.unstubAllGlobals(); }
  });
});
