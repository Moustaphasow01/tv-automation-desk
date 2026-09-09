import type { FocusQueueItem } from "../focusJournalModel";

export type TicketPriorityState = { seen: ReadonlyMap<string, boolean>; pending: readonly string[] };
export const emptyTicketPriority = (): TicketPriorityState => ({ seen: new Map(), pending: [] });

/** Navigation eligibility only. This never grants a trading permission. */
export function isCurrentPriorityTicket(item: FocusQueueItem, now: number): boolean {
  return item.actionable && !item.terminal && Boolean(item.card?.orderIntentId)
    && item.card?.expiredByTime !== true && Date.parse(item.expiresAt ?? "") > now
    && Number.isFinite(Date.parse(item.createdAt ?? "")) && Date.parse(item.createdAt!) <= now + 30_000;
}

export function advanceTicketPriority(state: TicketPriorityState, items: readonly FocusQueueItem[], now: number): TicketPriorityState {
  const seen = new Map(state.seen);
  const current = new Set<string>();
  const incoming: string[] = [];
  for (const item of items) {
    const eligible = isCurrentPriorityTicket(item, now);
    if (eligible) {
      current.add(item.key);
      if (seen.get(item.key) !== true) incoming.push(item.key);
    }
    seen.set(item.key, eligible);
  }
  // A refresh or revision alone cannot steal focus again.
  const pending = [...new Set([...state.pending, ...incoming])].filter((key) => current.has(key));
  return { seen, pending };
}

export function consumePriorityTicket(state: TicketPriorityState, key: string): TicketPriorityState {
  return { ...state, pending: state.pending.filter((id) => id !== key) };
}

export function canNavigateToPriority(input: { suspended: boolean; available: boolean; instrument: string; supported: readonly string[] }) {
  return !input.suspended && input.available && input.supported.includes(input.instrument);
}
