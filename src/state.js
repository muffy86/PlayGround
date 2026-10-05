// Persistent player state: XP, coins, streak, bests, achievements.
const KEY = 'stickstar-v1';
const RANKS = ['Rookie', 'Groover', 'Pocket Pro', 'Fill Master', 'Sight Reader', 'Stick Star', 'Drum Legend'];
function load() {
  try { return { xp: 0, coins: 0, level: 1, streak: 0, bestStreak: 0, bestAcc: 0, bestSimon: 0, bestLimb: 0, bestFill: 0, lastChest: 0, totalHits: 0, perfects: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { xp: 0, coins: 0, level: 1, streak: 0, bestStreak: 0, bestAcc: 0, bestSimon: 0, bestLimb: 0, bestFill: 0, lastChest: 0, totalHits: 0, perfects: 0 }; }
}
export const state = load();
export function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
export function xpForLevel(l) { return Math.round(120 * Math.pow(l, 1.45)); }
export function rankFor(level) { return RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 3))]; }
export function addXP(n) {
  state.xp += n;
  let need = xpForLevel(state.level);
  let ups = 0;
  while (state.xp >= need) { state.xp -= need; state.level++; ups++; need = xpForLevel(state.level); }
  save();
  return ups;
}
export function addCoins(n) { state.coins += n; save(); }
export function bumpStreak() { state.streak++; state.bestStreak = Math.max(state.bestStreak, state.streak); save(); }
export function resetStreak() { state.streak = 0; save(); }
