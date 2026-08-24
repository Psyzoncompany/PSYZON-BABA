export function progressiveDelayMs(failedAttempts: number): number {
  const attempts = Math.max(0, Math.trunc(failedAttempts));
  return attempts <= 4 ? 0 : Math.min(30_000, 500 * (2 ** (attempts - 5)));
}
