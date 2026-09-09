import { useEffect, useState } from "react";

/** Freeze a display snapshot only. The caller keeps the workspace decision guard informed. */
export function useFrozenReading<T>({ value, id, resumeGeneration = 0, onPauseChange }: {
  value: T; id: string; resumeGeneration?: number; onPauseChange(id: string, paused: boolean): void;
}) {
  const [frozen, setFrozen] = useState<{ value: T } | null>(null);
  useEffect(() => () => onPauseChange(id, false), [id, onPauseChange]);
  useEffect(() => { if (resumeGeneration > 0) { setFrozen(null); onPauseChange(id, false); } }, [resumeGeneration, id, onPauseChange]);
  return { value: frozen?.value ?? value, paused: frozen !== null,
    toggle() { setFrozen(frozen ? null : { value }); onPauseChange(id, !frozen); },
  };
}
