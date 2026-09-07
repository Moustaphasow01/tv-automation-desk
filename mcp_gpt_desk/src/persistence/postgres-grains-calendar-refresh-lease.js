// A session advisory lock spans the bounded fetch, without opening a transaction.
// The canonical append itself keeps its separate, short transaction.
export async function withGrainsCalendarRefreshLease(pool, refresh) {
  const client = await pool.connect();
  let acquired = false;
  let releaseError;
  try {
    const result = await client.query("SELECT pg_try_advisory_lock(741912, 1) AS acquired");
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) return { status: "ALREADY_RUNNING" };
    return await refresh();
  } finally {
    try {
      if (acquired) await client.query("SELECT pg_advisory_unlock(741912, 1)");
    } catch (error) {
      // Never return a session with an unconfirmed advisory unlock to the pool.
      releaseError = error;
      throw error;
    } finally { client.release(releaseError); }
  }
}
