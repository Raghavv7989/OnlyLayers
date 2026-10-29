# AGENTS.md — Only Layers Standalone Desktop Application

## Stack & Versions
- **Runtime & Shell:** Electron 33+, Node 22.x, TypeScript 5.6+
- **Frontend UI:** Vite 6, React 19, Tailwind CSS 3.4+, Framer Motion 11+, Lucide React
- **AI & Audio SDK:** `@google/genai` (Gemini 2.5 Flash Live WebSockets & Gemini 2.5 Pro), `pdf-parse` for local resume extraction
- **Packaging:** `electron-builder` (targets: macOS `.dmg` universal/arm64, Windows `.exe` NSIS)

## Setup, Build & Packaging Commands
- Install dependencies: `npm install`
- Run development mode (Electron + Vite HMR): `npm run dev`
- Typecheck: `npm run typecheck`
- Build production bundle: `npm run build`
- Package standalone desktop installer: `npm run dist` (or `npx electron-builder --mac --win`)

## Project Directory Structure
- `electron/main.ts` — Electron Main process, native OS stealth window flags, global hotkeys, `desktopCapturer`, system audio loopback
- `electron/preload.ts` — Strict `contextBridge` IPC API exposing stealth controls, screenshot capture, and audio streams to React
- `src/services/geminiLive.ts` — Hyper-speed WebSocket & streaming client using `@google/genai` (`gemini-2.5-flash` for sub-300ms answers, `gemini-2.5-pro` for screenshot code solving)
- `src/services/resumeEngine.ts` — Local PDF/Markdown/Text resume parser, JD matcher, and custom knowledge base card injector
- `src/components/` — Translucent HUD overlay components with Framer Motion animations

## Non-Negotiable Stealth & Architectural Boundaries
### Always Do:
1. Enforce `win.setContentProtection(true)` on the Electron `BrowserWindow` so the overlay is excluded from OS screen capture (`WDA_EXCLUDEFROMCAPTURE` on Windows, `NSWindowSharingNone` on macOS).
2. Configure the window with `transparent: true`, `frame: false`, `hasShadow: false`, `alwaysOnTop: true` (level: `'screen-saver'`), and `focusable: false` (or non-activating panel mode) so clicking or typing never triggers browser tab-switch (`blur`) detection on LeetCode, HackerRank, or CoderPad.
3. Hide the Dock and taskbar icon using `app.dock?.hide()` and `skipTaskbar: true`.
4. Support cursor undetectability via `win.setIgnoreMouseEvents(true, { forward: true })` toggled by hotkey.

### Never Do:
1. Never build this as a browser-only web app; it must always compile and package as a standalone Electron desktop application.
2. Never hardcode API keys in source files; store user keys locally via `electron-store` or encrypted local config.
