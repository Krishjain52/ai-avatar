# AI Avatar — Plan

## Goal
An animated 2D character **that looks like me** lives on the desktop, asleep. Tap him → he wakes up with a thought cloud: "What do you need me to find?" → a chat box appears below him → I describe the file → he moves to a corner with a loading spinner over his head while searching → he comes back and shows the results.

## Decisions
| Area | Choice |
|---|---|
| App shell | Electron + TypeScript (plain `tsc`, no bundler) |
| AI (free only) | Local LLM via Ollama (`qwen2.5:3b`) → Gemini free tier if a key is set → built-in keyword rules |
| File search | macOS Spotlight (`mdfind` / `mdls`) — no custom indexing needed for v1 |
| Avatar | Original retro pixel sprite (16×20, Game Boy-style 4-green palette), faces per state: sleeping / awake / searching / found / not-found |
| Image-content search | Phase 2 (not in v1) |

## Architecture
```
┌─────────────── Renderer (UI) ───────────────┐
│ Avatar window (transparent, always-on-top)   │
│   └─ click → Chat bubble (input + results)   │
└──────────────┬───────────────────────────────┘
               │ IPC (preload, contextIsolation)
┌──────────────▼──────── Main process ─────────┐
│ QueryParser  → Gemini API → SearchIntent JSON │
│ SearchEngine → builds mdfind query → results  │
│ ResultEnricher → mdls metadata + thumbnails   │
│ Actions → open file / reveal in Finder        │
└───────────────────────────────────────────────┘
```

### SearchIntent (what Gemini returns)
```json
{
  "keywords": ["invoice", "amazon"],
  "fileKinds": ["pdf"],            // image | video | audio | pdf | document | spreadsheet | presentation | code | folder | any
  "dateRange": { "from": "2025-06-01", "to": "2025-08-31", "field": "modified" },
  "locations": ["~/Downloads"],     // optional hints
  "nameOnly": false,
  "sizeHint": null
}
```
The main process converts this into a Spotlight query, for example:
`kMDItemContentTypeTree == "com.adobe.pdf" && kMDItemFSContentChangeDate >= $time.iso(2025-06-01) && (kMDItemDisplayName == "*invoice*"cd || kMDItemTextContent == "*invoice*"cd)`.
If there are no results, it relaxes the filters step by step: drop the date range, then the location, then search keywords only.

## Privacy
- With Ollama, nothing leaves the machine. With Gemini, only the typed sentence (plus today's date) is sent.
- Keys come from environment variables, never the repo.

## Milestones
1. **Scaffold**: Electron + TS + Vite, lint, and a GitHub Actions build check.
2. **Avatar window**: frameless, transparent, always on top, draggable, remembers its position, menu-bar/tray icon with Quit and Settings.
3. **Animation**: design the character and its 5 states; wire states to app events.
4. **Chat bubble**: opens on click, Esc closes it, shows a loading state and keeps a short history.
5. **Search engine**: wrapper around `mdfind` + `mdls`, query builder, result ranking, unit tests.
6. **Gemini integration**: prompt + JSON schema for SearchIntent, settings screen for the API key, error handling and offline fallback (plain keyword search).
7. **Results UI**: cards with Quick Look thumbnails, open, reveal in Finder, and keyboard navigation.
8. **Polish & package**: global hotkey to summon the avatar, launch at login, `electron-builder` .dmg.
9. **Phase 2**: image-content search (index photos with a Gemini vision/embedding model, stored locally), follow-up questions ("only the ones from WhatsApp").

## Open questions
- Should the avatar be visible on all Spaces or full-screen apps?
- Which folders, if any, should be excluded from search (e.g. `~/Library`, `node_modules`)?
