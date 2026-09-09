import { useSyncExternalStore } from "react";

// One chart on phones, including touch landscape. Desktop layouts stay saved.
const mobileQuery = "(max-width: 899px), (max-width: 1180px) and (pointer: coarse)";
const subscribe = (notify: () => void) => {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
export function useWorkspaceViewport() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(mobileQuery).matches, () => true);
}
