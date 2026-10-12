/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in a demo build (npm run build:demo): the hosted demo's playback, lib/preview.ts. */
  readonly VITE_DEMO?: string;
  /** The recording a demo build opens (/replay.json). */
  readonly VITE_REPLAY_URL?: string;
}
