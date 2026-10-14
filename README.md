# PlayGround

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Created using [OMGithub.com](https://omgithub.com).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://omgithub.com/muffy86/PlayGround)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/muffy86/PlayGround)

- 🎮 [Open the project](https://omgithub.com/muffy86/PlayGround).
- ✨ [Remix this project](https://omgithub.com/?remix=muffy86%2FPlayGround).
- 💻 [Explore the source](https://github.com/muffy86/PlayGround).
- 🛠️ [Check build runs](https://github.com/muffy86/PlayGround/actions).
- 🐛 [Report an issue](https://github.com/muffy86/PlayGround/issues).
- 👤 [Explore the creator's projects](https://omgithub.com/muffy86).
- 🌍 [Create with OMGithub](https://omgithub.com).
<!-- omgithub:readme:end -->

# 🥁 Neon Drum Studio — Electronic Drumming + Metronome Playground

Vibrant, neon-reactive electronic drumming studio with real-time dynamic notation,
Web MIDI e-kit support, hit-burst particles, and a **Metronome Playground** minigame
(gap clicks · push/pull micro-timing · displaced polyrhythms · subdivisions · accent shift)
with instant millisecond + velocity feedback.

**Stack (assembled from proven open-source tech):** React 18 + Vite 5 + TypeScript ·
Web Audio synth voices (zero-latency, offline, no samples needed) · Web MIDI API ·
Zustand state · Framer Motion pad physics · Canvas particles + scrolling notation ·
VexFlow-ready notation layer · Tone.js-compatible clock · Vitest (9 tests) ·
localStorage progress (+ optional Supabase sync key in Settings).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # → dist/ (tsc + vite)
npm test         # vitest: 9 exercise/timing tests
```

## Play

- **Drum Studio:** tap pads / keys `Q W E A S D F G + Space` / touch / MIDI e-kit.
  `⚡ Connect E-Kit` uses Web MIDI (Chrome/Edge, HTTPS or localhost).
  Default Roland V-Drums map: 36 kick · 38 snare · 39 clap · 42 hat · 46 open-hat ·
  47/43 toms · 49 crash · 51 ride. Filter by channel + reset map in Settings.
- **Metronome Playground:** pick a mode → Start → strike any drum on every target.
  Tolerance: **±12ms perfect**, **±35ms good** (early/late), else miss.
  Live panel shows `EARLY −xx.xms / LATE +xx.xms / PERFECT`, velocity `/127`,
  streak chips, ±100ms timeline, and end-of-run accuracy + avg |Δ| + best streak.
- **Lessons / Stats / Settings:** 6-step guided path, lifetime hits + best streak
  (localStorage), tempo/volume/kit/MIDI-channel, optional Supabase URL for sync.

## Structure

```
src/
  App.tsx  main.tsx  index.css
  lib/drums.ts                 # kit defs, keys, MIDI map, HitEvent
  audio/AudioEngine.ts         # synthesized kick/snare/hat/tom/cymbal/click
  midi/MidiService.ts          # Web MIDI enable/filter/learn/reset
  store/useStore.ts            # zustand: tab, hits, bpm, volume, kit, stats
  exercises/exercises.ts       # Base + Gap/PushPull/Poly/Subdiv/Accent classes
  components/
    DrumStudio.tsx  NotationStrip.tsx  ParticleCanvas.tsx
    MetronomePlayground.tsx  Lessons.tsx  Stats.tsx  Settings.tsx
tests/exercises.test.ts        # 9 tests, all passing
```

Phone/tablet ready: touch pads, responsive grid, `maximum-scale=1` viewport.
