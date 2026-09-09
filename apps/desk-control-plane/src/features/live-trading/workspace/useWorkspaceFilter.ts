import { useSearchParams } from "react-router-dom";

/** Shareable presentation state only. Never contains command authority or credentials. */
export function useWorkspaceFilter(key: string, fallback: string, allowed?: readonly string[]) {
  const [search, setSearch] = useSearchParams();
  const raw = search.get(key) ?? fallback;
  const value = (allowed && !allowed.includes(raw) ? fallback : raw).slice(0, 160);
  const update = (nextValue: string) => setSearch((current) => {
    const next = new URLSearchParams(current);
    if (nextValue === fallback || !nextValue) next.delete(key);
    else next.set(key, nextValue.slice(0, 160));
    return next;
  }, { replace: true });
  return [value, update] as const;
}
