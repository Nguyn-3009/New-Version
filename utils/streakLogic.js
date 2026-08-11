// Streak rules, as pure functions. No storage, no network, no React - so the
// logic can be tested directly and reused by the server later when it needs to
// validate a client's claim.
//
// TIMEZONE: streaks run on the user's LOCAL calendar date, not UTC. Using UTC
// would break the streak for anyone far from Greenwich: at UTC+7, playing
// before 7am local falls on the previous UTC day, so two consecutive local
// days could look like the same day, or a gap. Local dates are what a player
// actually experiences as "today".

/** Local calendar date as YYYY-MM-DD. */
export function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Whole days from `a` to `b`, both YYYY-MM-DD. Negative if b is before a. */
export function daysBetween(a, b) {
  // Parse as UTC midnight so DST transitions can't shift the difference by an
  // hour and round the wrong way.
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86400000);
}

export const EMPTY_PROGRESS = Object.freeze({
  currentStreak: 0,
  longestStreak: 0,
  lastPlayedDate: null, // YYYY-MM-DD
  totalPuzzles: 0,
  updatedAt: 0, // epoch ms, used to resolve sync conflicts
});

/**
 * The streak as it should be DISPLAYED today.
 *
 * The stored streak goes stale: if you last played three days ago it still
 * says 5, but the streak is broken. Display must reflect that even though
 * nothing has written to storage since. Kept separate from recordPlay so
 * merely opening the app never mutates progress.
 */
export function streakAsOf(progress, today = localDateString()) {
  if (!progress?.lastPlayedDate) return 0;
  const gap = daysBetween(progress.lastPlayedDate, today);
  if (gap < 0) return progress.currentStreak; // clock moved back; don't punish
  return gap <= 1 ? progress.currentStreak : 0;
}

/** True if the streak is still alive but today hasn't been counted yet. */
export function isAtRisk(progress, today = localDateString()) {
  if (!progress?.lastPlayedDate) return false;
  return daysBetween(progress.lastPlayedDate, today) === 1;
}

/**
 * Record a qualifying play for `today`.
 *
 * Idempotent within a day: playing five times counts once, so this is safe to
 * call from anywhere without guarding the call site.
 */
export function recordPlay(progress, today = localDateString(), now = Date.now()) {
  const p = progress ?? EMPTY_PROGRESS;

  if (p.lastPlayedDate === today) {
    // Already counted today - only the puzzle tally moves.
    return { ...p, totalPuzzles: p.totalPuzzles + 1, updatedAt: now };
  }

  const gap = p.lastPlayedDate ? daysBetween(p.lastPlayedDate, today) : null;

  let currentStreak;
  if (gap === null) currentStreak = 1; // first ever play
  else if (gap === 1) currentStreak = p.currentStreak + 1; // consecutive day
  else if (gap < 0) currentStreak = p.currentStreak; // clock moved back
  else currentStreak = 1; // gap >= 2: broken, restart at today

  return {
    currentStreak,
    longestStreak: Math.max(p.longestStreak, currentStreak),
    lastPlayedDate: gap !== null && gap < 0 ? p.lastPlayedDate : today,
    totalPuzzles: p.totalPuzzles + 1,
    updatedAt: now,
  };
}

/**
 * Merge local and remote progress after a sync.
 *
 * Not last-write-wins: a player who plays offline on their phone and then
 * opens an old tablet shouldn't lose the streak. Take the best of each field,
 * which can only ever be generous. That is the right bias for a streak; it
 * would be the wrong bias for a currency balance, so don't reuse this shape
 * for rewarded-ad rewards later.
 */
export function mergeProgress(local, remote) {
  if (!remote) return local;
  if (!local) return remote;

  const later =
    !local.lastPlayedDate ||
      (remote.lastPlayedDate && remote.lastPlayedDate > local.lastPlayedDate)
      ? remote.lastPlayedDate
      : local.lastPlayedDate;

  return {
    currentStreak: Math.max(local.currentStreak, remote.currentStreak),
    longestStreak: Math.max(local.longestStreak, remote.longestStreak),
    lastPlayedDate: later,
    totalPuzzles: Math.max(local.totalPuzzles, remote.totalPuzzles),
    updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0),
  };
}