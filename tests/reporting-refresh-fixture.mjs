/** Retry only local D1 contention while replaying the fixture's observations. */
export async function runReportingFixtureRefresh(
  refresh,
  wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await refresh();
    } catch (error) {
      if (
        attempt === 3 ||
        !(error instanceof Error) ||
        error.message !== "D1_ERROR: database is locked: SQLITE_BUSY"
      )
        throw error;
      await wait(100 * 2 ** attempt);
    }
  }
}
