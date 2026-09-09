import { useCallback, useEffect, useState } from "react";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import { defaultWorkspacePreferences, parseWorkspacePreferences, workspacePreferenceKey, type WorkspacePreferences } from "./workspacePreferences";

function readStored(key: string | null) {
  try { return { value: parseWorkspacePreferences(key ? localStorage.getItem(key) : null), failed: false }; }
  catch { return { value: { ...defaultWorkspacePreferences }, failed: true }; }
}

export function useWorkspacePreferences() {
  const { session } = useOperatorSession();
  const key = workspacePreferenceKey(session);
  const [stored, setStored] = useState(() => ({ key, ...readStored(key) }));
  const current = stored.key === key ? stored : { key, ...readStored(key) };
  useEffect(() => { setStored({ key, ...readStored(key) }); }, [key]);
  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (event.key === key && key) setStored({ key, value: parseWorkspacePreferences(event.newValue), failed: false });
    };
    window.addEventListener("storage", receive);
    return () => window.removeEventListener("storage", receive);
  }, [key]);
  const update = useCallback((patch: Partial<WorkspacePreferences>) => {
    setStored((previous) => {
      const base = previous.key === key ? previous.value : readStored(key).value;
      const value = parseWorkspacePreferences(JSON.stringify({ ...base, ...patch, version: 1 }));
      let failed = false;
      try { if (key) localStorage.setItem(key, JSON.stringify(value)); }
      catch { failed = true; }
      return { key, value, failed };
    });
  }, [key]);
  const reset = useCallback(() => update(defaultWorkspacePreferences), [update]);
  return { preferences: current.value, update, reset, persistence: !key ? "Session non identifiée : réglages temporaires." : current.failed ? "Enregistrement local indisponible : réglages temporaires." : "Enregistré dans ce navigateur pour votre compte et cet environnement. Aucun transfert entre appareils." };
}

export type WorkspacePreferencesController = ReturnType<typeof useWorkspacePreferences>;
