// Songs, lessons, patterns — all in-app, no downloads.
export const SONGS = [
  { id: 'rock101', title: '🥁 Rock 101 — 90 BPM', bpm: 90, lanes: ['kick', 'snare', 'hihat', 'crash'],
    notes: 'K H H S H H K H | H H S H H K H S'.split(' '),
    map: { K: 'kick', S: 'snare', H: 'hihat', C: 'crash', T1: 'tom1', T2: 'tom2', F: 'tom3', R: 'ride', O: 'openhat' } },
  { id: 'popgroove', title: '✨ Pop Groove — 100 BPM', bpm: 100, lanes: ['kick', 'snare', 'hihat', 'openhat', 'tom1'],
    notes: 'K H T1 H S H O H | K H S H K H S H'.split(' '),
    map: { K: 'kick', S: 'snare', H: 'hihat', C: 'crash', T1: 'tom1', T2: 'tom2', F: 'tom3', R: 'ride', O: 'openhat' } },
  { id: 'fillup', title: '🌊 Fill Builder — 110 BPM', bpm: 110, lanes: ['snare', 'tom1', 'tom2', 'tom3', 'crash'],
    notes: 'S T1 T2 F S T1 T2 F | S S T1 T2 F F C C'.split(' '),
    map: { K: 'kick', S: 'snare', H: 'hihat', C: 'crash', T1: 'tom1', T2: 'tom2', F: 'tom3', R: 'ride', O: 'openhat' } },
  { id: 'jungle', title: '🔥 Funk Blast — 120 BPM', bpm: 120, lanes: ['kick', 'snare', 'hihat', 'ride', 'tom2'],
    notes: 'K H S K H H S H | K K S H R H S T2'.split(' '),
    map: { K: 'kick', S: 'snare', H: 'hihat', C: 'crash', T1: 'tom1', T2: 'tom2', F: 'tom3', R: 'ride', O: 'openhat' } },
];

// Drum staff positions: y index on 5-line staff (0 = top line). x = cymbal notehead.
export const DRUM_STAFF = {
  crash: { y: -2.2, x: true, label: 'Crash (top, X)' },
  ride: { y: -1.2, x: true, label: 'Ride (upper, X)' },
  openhat: { y: -0.4, x: true, label: 'Open hat (X)' },
  hihat: { y: 0, x: true, label: 'Hi-hat (top line, X)' },
  tom1: { y: 0.8, x: false, label: 'High tom (space 1)' },
  snare: { y: 2, x: false, label: 'Snare (middle C space)' },
  tom2: { y: 3, x: false, label: 'Mid tom' },
  tom3: { y: 7, x: false, label: 'Floor tom' },
  kick: { y: 10, x: false, label: 'Kick (below staff)' },
};

export const LESSONS = [
  { id: 1, title: '1 · Meet the kit', text: 'Kick = bottom dot. Snare = middle. Hats = X on top. Demo, then repeat: K S H H.', seq: ['kick', 'snare', 'hihat', 'hihat'], bpm: 80 },
  { id: 2, title: '2 · Quarter notes', text: 'Each beat gets one hit: ♩ ♩ ♩ ♩. Play kick on all 4 beats.', seq: ['kick', 'kick', 'kick', 'kick'], bpm: 80 },
  { id: 3, title: '3 · Backbeat', text: 'Rock lives on 2 & 4: kick on 1, snare on 2, kick on 3, snare on 4.', seq: ['kick', 'snare', 'kick', 'snare'], bpm: 85 },
  { id: 4, title: '4 · Add the hats', text: 'Hats tick every 8th note between kick & snare: K H S H K H S H.', seq: ['kick', 'hihat', 'snare', 'hihat', 'kick', 'hihat', 'snare', 'hihat'], bpm: 85 },
  { id: 5, title: '5 · First full groove', text: 'Your first real beat. Loop it 4x without stopping — that is drumming!', seq: ['kick', 'hihat', 'snare', 'hihat', 'kick', 'hihat', 'snare', 'hihat'], bpm: 90 },
  { id: 6, title: '6 · Open hats & crash', text: 'X with a circle = open hat (long). Big X with accent = crash on beat 1.', seq: ['crash', 'hihat', 'snare', 'openhat', 'kick', 'hihat', 'snare', 'hihat'], bpm: 90 },
  { id: 7, title: '7 · Toms & fills', text: 'Toms walk down: high → mid → floor. Classic fill: S T1 T2 F.', seq: ['snare', 'tom1', 'tom2', 'tom3'], bpm: 100 },
  { id: 8, title: '8 · Rests matter', text: '𝄾 = silence. Groove with a hole: K _ S _ K _ S H. Feel the gap!', seq: ['kick', 'snare', 'kick', 'snare', 'hihat'], bpm: 95 },
  { id: 9, title: '9 · 16th notes', text: 'Four hits per beat: 1 e & a. Try hats: H H H H over K S K S.', seq: ['kick', 'hihat', 'hihat', 'snare', 'hihat', 'hihat', 'kick', 'hihat', 'hihat', 'snare'], bpm: 80 },
  { id: 10, title: '10 · Ride pattern', text: 'Jazz/rock ride: ping-ping-ping with kick feathering underneath.', seq: ['ride', 'kick', 'ride', 'ride', 'snare', 'ride', 'ride', 'kick'], bpm: 100 },
  { id: 11, title: '11 · Funk blast', text: 'Syncopation: kick doubles before the snare. Count "1 e & a" out loud!', seq: ['kick', 'kick', 'snare', 'hihat', 'kick', 'snare', 'hihat', 'hihat'], bpm: 105 },
  { id: 12, title: '12 · Graduation groove', text: 'Everything combined. Play it clean 3x = you can read drum sheets! 🎓', seq: ['crash', 'hihat', 'snare', 'hihat', 'kick', 'tom1', 'snare', 'tom2', 'kick', 'hihat', 'snare', 'tom3'], bpm: 110 },
];

export const BADGES = [
  { id: 'first', icon: '👶', name: 'First Hit', desc: 'Hit any drum' },
  { id: 'combo10', icon: '⚡', name: 'Combo x10', desc: '10 perfect in a row' },
  { id: 'combo50', icon: '🌋', name: 'Combo x50', desc: '50 combo in Timing Fall' },
  { id: 'reader1', icon: '📖', name: 'Reader', desc: 'Finish lesson 5' },
  { id: 'grad', icon: '🎓', name: 'Graduate', desc: 'Finish all 12 lessons' },
  { id: 'steady', icon: '🎯', name: 'Metronome Pro', desc: 'Score 85+ in Steady Hands' },
  { id: 'ear5', icon: '👂', name: 'Big Ears', desc: 'Round 5 in Ear Copy' },
  { id: 'burst', icon: '💥', name: 'Speed Demon', desc: '40+ hits in Speed Burst' },
  { id: 'rich', icon: '💰', name: 'Groove Tycoon', desc: 'Hold 500 coins' },
];

export const SHOP = [
  { id: 'trail', icon: '☄️', name: 'Stick Trails', cost: 150, desc: 'Bigger 3D particle bursts' },
  { id: 'goldkit', icon: '👑', name: 'Gold Kit', cost: 300, desc: 'Golden stage ring + lights' },
  { id: 'confetti', icon: '🎉', name: 'Confetti Rain', cost: 100, desc: 'Confetti on every combo x10' },
  { id: 'electric', icon: '⚡', name: 'Neon FX', cost: 200, desc: 'Electric-kit glow always on hits' },
];
