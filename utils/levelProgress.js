// Level progress, persisted to the device.
//
// Local-first and dependency-light: one AsyncStorage key holding a small
// object. No account needed, works offline, and it is the same shape a server
// would later sync, so adding accounts does not mean rewriting this.
//
//   npx expo install @react-native-async-storage/async-storage
//
// Works in Expo Go - no dev build required.

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "linedash:levels:v1";

const EMPTY = { highestCleared: 0, cleared: {} };

let cache = null;
const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  if (cache) fn(cache);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(cache);
}

export function getProgress() {
  return cache ?? EMPTY;
}

/** Highest level the player may enter: one past what they've cleared. */
export function highestUnlocked() {
  return (cache?.highestCleared ?? 0) + 1;
}

export function isCleared(level) {
  return Boolean(cache?.cleared?.[level]);
}

export function isUnlocked(level) {
  return level <= highestUnlocked();
}

export async function loadLevelProgress() {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  } catch (e) {
    console.warn("[levels] load failed:", e?.message);
    cache = { ...EMPTY };
  }
  emit();
  return cache;
}

export async function markCleared(level) {
  const prev = cache ?? EMPTY;
  if (prev.cleared?.[level]) return prev; // already done, nothing to write

  const next = {
    highestCleared: Math.max(prev.highestCleared ?? 0, level),
    cleared: { ...prev.cleared, [level]: true },
  };

  cache = next;
  emit();

  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    // A failed write must not block the player from continuing - the value is
    // still correct in memory for this session.
    console.warn("[levels] save failed:", e?.message);
  }
  return next;
}

/**
 * Mark every level up to `upTo` as cleared. DEV ONLY.
 *
 * Progress lives in AsyncStorage, which is per-app: Expo Go and a development
 * build are different apps with different sandboxes, so switching between them
 * starts you back at level 1. Replaying twenty levels to reach a feature you
 * are testing is not a good use of an afternoon.
 */
export async function unlockUpTo(upTo) {
  const cleared = {};
  for (let i = 1; i <= upTo; i++) cleared[i] = true;

  const next = { highestCleared: upTo, cleared };
  cache = next;
  emit();

  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    console.warn("[levels] unlock save failed:", e?.message);
  }
  return next;
}

export async function resetLevelProgress() {
  cache = { ...EMPTY };
  emit();
  try {
    await AsyncStorage.removeItem(KEY);
  } catch { }
}