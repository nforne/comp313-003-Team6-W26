// src/utils/slot.dto.js (conceptual)
function validateSlot(fromEpochMs, toEpochMs) {
  const MIN_MS = 5 * 60 * 1000;        // 5 minutes
  const MAX_MS = 8 * 60 * 60 * 1000;   // 8 hours
  const now = Date.now();

  if (!Number.isFinite(fromEpochMs) || !Number.isFinite(toEpochMs)) throw new Error('invalid timestamps');
  if (fromEpochMs >= toEpochMs) throw new Error('from must be < to');
  const dur = toEpochMs - fromEpochMs;
  if (dur < MIN_MS || dur > MAX_MS) throw new Error('duration out of bounds');
  if (fromEpochMs < now - 24*60*60*1000) throw new Error('slot too far in past');
  if (fromEpochMs > now + 2*365*24*60*60*1000) throw new Error('slot too far in future');

  return { fromUtc: new Date(fromEpochMs), toUtc: new Date(toEpochMs), durationMs: dur };
}
