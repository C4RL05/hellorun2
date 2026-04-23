# `public/` — built-in music + bundled fonts

Vite serves every file in this directory at the URL root.

## Music (`music/`)

Built-in tracks live in `public/music/`. Each `.mp3` may have a sibling `.mp3.analysis.json` sidecar — when present, first-time visitors skip the ~15s Essentia analysis pass on load. Generate sidecars via the dev tab → "export analysis sidecar" button.

`*.mp3` / `*.wav` / `*.flac` / `*.ogg` / `*.m4a` / `*.aac` are in the project `.gitignore` — local-only audio doesn't get committed. Use `git add -f public/music/foo.mp3` if you want to ship a built-in track with the repo.

## Fonts

`fonts/testpattern.woff2` and `.woff` — bespoke pixel font drawn by Carlos in Photoshop, converted to TTF via [YAL Pixel Font Converter](https://yal.cc/r/20/pixelfont/), then to web formats via [FontSquirrel's webfont generator](https://www.fontsquirrel.com/tools/webfont-generator). No third-party license obligations.
