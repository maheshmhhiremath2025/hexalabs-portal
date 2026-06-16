/**
 * Batch expiry helper.
 *
 * `batchExpiresAt` is a hard cutoff on the whole training engagement / batch.
 * After this date, the user record + cloud identity should be fully destroyed,
 * not just session-cleaned. This is separate from the per-session `expiresAt`
 * which only triggers resource cleanup but keeps the IAM/identity warm for
 * re-launch.
 *
 * Returns true iff the record has a batchExpiresAt and that date is in the past.
 */
function isBatchExpired(record) {
  const t = record && record.batchExpiresAt;
  if (!t) return false;
  return new Date(t).getTime() <= Date.now();
}

module.exports = { isBatchExpired };
