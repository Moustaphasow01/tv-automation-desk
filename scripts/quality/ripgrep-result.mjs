export function validateSearchResult(result) {
  if (result?.error) throw new Error(`rg spawn failed: ${result.error.message || result.error}`);
  if (result?.signal) throw new Error(`rg terminated by signal: ${result.signal}`);
  if (typeof result?.stderr === "string" && result.stderr.trim()) throw new Error(`rg stderr: ${result.stderr.trim()}`);
  if (![0, 1].includes(result?.status)) throw new Error("rg failed");
  return result;
}
