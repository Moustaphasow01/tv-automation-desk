-- Reversible operator decision window for PAPER / semi-manual Human Gate.
-- Expand-only: existing gates remain non-reversible until a new decision writes
-- an explicit undo deadline under the backend policy.

ALTER TABLE human_execution_gates
  ADD COLUMN IF NOT EXISTS undo_expires_at_utc timestamptz;

ALTER TABLE human_execution_gates
  ADD COLUMN IF NOT EXISTS undone_at_utc timestamptz;

ALTER TABLE human_execution_gate_events
  DROP CONSTRAINT IF EXISTS human_execution_gate_events_event_type_check;

ALTER TABLE human_execution_gate_events
  ADD CONSTRAINT human_execution_gate_events_event_type_check CHECK (event_type IN (
    'OPENED',
    'CONFIRM_REQUESTED',
    'CONFIRMED',
    'REJECTED',
    'EXPIRED',
    'INVALIDATED',
    'REFUSED',
    'REVERTED'
  ));

CREATE INDEX IF NOT EXISTS human_execution_gates_undo_window_idx
  ON human_execution_gates(status, undo_expires_at_utc)
  WHERE undo_expires_at_utc IS NOT NULL;

COMMENT ON COLUMN human_execution_gates.undo_expires_at_utc IS
  'Backend-authoritative deadline for reverting the latest CONFIRMED/REJECTED operator decision. NULL means Undo is unavailable.';

COMMENT ON COLUMN human_execution_gates.undone_at_utc IS
  'Timestamp of the latest accepted Human Gate REVERTED transition; audit events retain the complete history.';
