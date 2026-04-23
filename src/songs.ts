// Per-song metadata needed to synchronize gameplay to audio.
//
// For milestone 6 (plan §7) this is hand-authored per song. Milestone 8's
// audio-analysis pipeline will derive bpm + gridOffsetSec (and eventually
// section boundaries, phrase markers, etc.) from the audio itself, but the
// shape stays compatible — added fields slot in alongside these.
export interface SongMetadata {
  // URL served to the page. For files dropped in `public/`, the path is the
  // filename prefixed with `/` (Vite serves the public dir at site root).
  readonly url: string;
  // Beats per minute. At 4/4 and one gate per beat, this also drives gate
  // spacing: FORWARD_SPEED * (60 / bpm) = world units between gates.
  readonly bpm: number;
  // Audio timeline second at which beat 1 (the first downbeat) lands.
  // Non-zero when the file has silence, a fade-in, or a pickup before the
  // first bar. All subsequent beats derive from bpm.
  readonly gridOffsetSec: number;
}

// Built-in track. The mp3 lives at `public/music/dev-song.mp3` (Vite
// serves it at `/music/dev-song.mp3`). A precomputed analysis sidecar
// at `public/music/dev-song.mp3.analysis.json` lets first-time
// visitors skip the ~15s analyze pass — see src/audio-analysis/
// sidecar.ts for the format and the dev-tab "export analysis" button
// for regenerating it.
export const devSong: SongMetadata = {
  url: "/music/dev-song.mp3",
  bpm: 120,
  gridOffsetSec: 0,
};
