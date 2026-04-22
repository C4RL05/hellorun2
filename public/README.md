# `public/` — dev-time audio drop + bundled fonts

Vite serves every file in this directory at the URL root. Drop a local audio file here (e.g. `public/dev-song.mp3`) and it's reachable at `http://localhost:5173/dev-song.mp3`.

`*.mp3` / `*.wav` / `*.flac` / `*.ogg` / `*.m4a` / `*.aac` are in the project `.gitignore`, so your personal audio never gets committed.

When milestone 8 lands (drag-drop BYOM), this folder becomes optional — everyone supplies their own track through the file picker at runtime.

## Fonts

`fonts/undefined-medium.woff2` and `.woff` — "**undefined medium**" by [Andi Rueckel](https://undefined-medium.com) ([github.com/andirueckel/undefined-medium](https://github.com/andirueckel/undefined-medium)), bundled under the [SIL Open Font License 1.1](fonts/OFL.txt). The font is distinct from this project's MIT-style source license; it remains OFL in perpetuity. Do not rename if modifying — "undefined medium" is a Reserved Font Name.
