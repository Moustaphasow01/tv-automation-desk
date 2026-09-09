import { useEffect, useRef, useState } from "react";
import type { FocusQueueItem } from "../focusJournalModel";
import { advanceTicketPriority, canNavigateToPriority, consumePriorityTicket, emptyTicketPriority, isCurrentPriorityTicket } from "./ticketPriority";

type Input = {
  tickets: readonly FocusQueueItem[]; now: number; available: boolean; suspended: boolean;
  automatic: boolean; supported: readonly string[]; instrument: string;
  onFocus(item: FocusQueueItem): void;
};

export function useTicketPriority(input: Input) {
  const state = useRef(emptyTicketPriority());
  const current = useRef(input);
  current.current = input;
  const [pending, setPending] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<{ key: string; instrument: string; previous: string } | null>(null);
  useEffect(() => {
    if (!input.available) return;
    state.current = advanceTicketPriority(state.current, input.tickets, input.now);
    const candidate = input.tickets.find((item) => item.key === state.current.pending[0]);
    const holding = notice && input.tickets.some((item) => item.key === notice.key && isCurrentPriorityTicket(item, input.now));
    if (candidate && !holding && input.automatic && canNavigateToPriority({ ...input, instrument: candidate.instrument }) && !attentionOccupied()) {
      state.current = consumePriorityTicket(state.current, candidate.key);
      setNotice({ key: candidate.key, instrument: candidate.instrument, previous: input.instrument });
      input.onFocus(candidate);
    }
    setPending((before) => before.join("|") === state.current.pending.join("|") ? before : state.current.pending);
  }, [input, notice]);
  const showNext = () => {
    const value = current.current;
    const next = value.tickets.find((item) => item.key === pending[0]);
    if (!next || !isCurrentPriorityTicket(next, value.now) || !canNavigateToPriority({ ...value, instrument: next.instrument })) return;
    state.current = consumePriorityTicket(state.current, next.key);
    setPending(state.current.pending);
    setNotice({ key: next.key, instrument: next.instrument, previous: value.instrument });
    value.onFocus(next);
  };
  const next = input.tickets.find((item) => item.key === pending[0] && isCurrentPriorityTicket(item, input.now)) ?? null;
  return { pending, next, supported: next ? input.supported.includes(next.instrument) : false, notice, showNext, dismiss: () => setNotice(null) };
}

function attentionOccupied() {
  return document.visibilityState === "hidden" || Boolean(document.querySelector("dialog[open]"))
    || Boolean(document.activeElement?.matches("input, textarea, select, [contenteditable='true']"));
}
