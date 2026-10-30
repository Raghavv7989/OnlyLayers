# Only Layers — Standalone Stealth AI Interview & Meeting Copilot

[![Electron](https://img.shields.io/badge/Electron-33+-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Groq](https://img.shields.io/badge/Groq-Llama%203.3%20%7C%20Whisper%20Turbo-F55036)](https://groq.com/)
[![Google Gemini](https://img.shields.io/badge/Google-Gemini%203.8%20Flash-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)

**Only Layers** is a high-speed, invisible desktop HUD and meeting copilot designed for real-time interview coding, aptitude solving, and meeting intelligence. It runs as a hardware-protected overlay that remains completely undetected during OS screen sharing.

---

## ⚡ Core Features

- **🎧 Parakeet AI 2.0 Real-Time Audio Copilot:**
  - Captures meeting audio directly via system loopback (`desktopCapturer`).
  - Sub-200ms speech-to-text using Groq Whisper Large-v3-Turbo (8kHz 16-bit PCM downsampling).
  - Sub-second turnaround response generation using Groq Llama-3.3-70B (300+ tok/s) and Gemini 3.8 / 3.5 Flash cascade.
  - Intelligent 2.5s rolling merge buffer for natural mid-sentence breathing pauses and clause continuity.
  - Zero-mic question trigger invariant: physical microphone input is completely isolated from question triggers.

- **📸 3-Stage Screen & Aptitude Solver (`Cmd/Ctrl + Shift + S`):**
  - Instant High-DPI screen capture (2560x1440) for LeetCode, HackerRank, CoderPad, and aptitude problems.
  - 3-stage solve-first chain-of-thought engine (Immediate Answer Key -> Step-by-Step Proof -> Python/Java/JS Solution).

- **🛡️ 5-Layer OS Stealth & Undetectability Engine:**
  - `win.setContentProtection(true)` excludes the HUD window from Zoom, Teams, Google Meet, and OS screen capture (`NSWindowSharingNone` on macOS, `WDA_EXCLUDEFROMCAPTURE` on Windows).
  - Floating non-activating accessory panel mode (`app.setActivationPolicy('accessory')`) prevents window focus blur detection on test platforms.
  - Dock and taskbar hidden (`skipTaskbar: true`, `app.dock.hide()`).
  - Click-through mode (`Cmd/Ctrl + M`) passes mouse events directly to background applications.

- **⚡ Instant Re-Answer Execution:**
  - Sub-millisecond abort cancellation via `AbortController` on speech resumption or manual re-answer.
  - Dedicated **⚡ Re-Answer** button on each interviewer transcript item.

---

## ⌨️ Global Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Cmd/Ctrl + B` | **Toggle HUD Visibility** | Shows / hides the stealth overlay window with robust restoration |
| `Cmd/Ctrl + M` | **Toggle Click-Through** | Switches between interactive HUD and transparent click-through mode |
| `Cmd/Ctrl + Shift + S` | **Screen Solver** | Captures screen and executes 3-Stage Aptitude/Code Solver |
| `Cmd/Ctrl + Enter` | **Answer Now** | Immediately triggers answer generation on captured question or input |

---

## 📁 Repository Structure

```text
OnlyLayers/
├── only-layers/                    # Main Desktop Application Source
│   ├── electron/
│   │   ├── main.ts                 # Electron Main Process, stealth flags, global shortcuts, IPC
│   │   └── preload.ts              # Strict contextBridge IPC interface
│   ├── src/
│   │   ├── components/             # React 19 HUD Overlay Components
│   │   │   ├── WorkspaceTabs.tsx   # Central Workspace & Tab Switcher
│   │   │   ├── TranscriptTicker.tsx# Real-time ASR transcript ticker & Re-Answer buttons
│   │   │   ├── ScreenSolver.tsx    # Multimodal Screen & Aptitude Solver
│   │   │   ├── AudioLoopback.tsx   # Audio diagnostics & system loopback visualizer
│   │   │   ├── SettingsModal.tsx   # API Key & model configuration modal
│   │   │   ├── ResumeMatcher.tsx   # Resume grounding context viewer
│   │   │   └── MockDebrief.tsx     # Session feedback & transcript debrief
│   │   ├── services/
│   │   │   ├── audioPipeline.ts    # Web Audio VAD graph, 8kHz downsampling, pause merger
│   │   │   ├── groqEngine.ts       # Groq Whisper Turbo & Llama 3.3/3.1 streaming cascade
│   │   │   ├── geminiLive.ts       # Gemini Flash Lite / Flash Cascade with thinkingBudget: 0
│   │   │   ├── semanticGuard.ts    # 4-Layer candidate-echo suppression state machine
│   │   │   └── resumeEngine.ts     # Resume parsing and interview context grounding
│   │   ├── App.tsx                 # Root HUD Application shell
│   │   ├── main.tsx                # React entry point
│   │   └── index.css               # Tailwind CSS & custom HUD styling
│   ├── package.json                # App dependencies & electron scripts
│   ├── tsconfig.json               # TypeScript configuration
│   └── vite.config.mts             # Vite 6 bundler configuration
├── package.json                    # Root workspace runner scripts
└── README.md                       # Project documentation
```

---

## 🚀 Quickstart & Development

### 1. Prerequisites
- Node.js `20.x` or `22.x`
- npm `10.x` or higher
- macOS (Universal/Apple Silicon/Intel) or Windows 10/11

### 2. Install Dependencies
```bash
# Clone the repository
git clone https://github.com/Raghavv7989/OnlyLayers.git
cd OnlyLayers

# Install dependencies
npm --prefix only-layers install
```

### 3. Run Development Mode
```bash
# Launches Vite HMR + Electron desktop overlay
npm run dev
# or from inside only-layers directory:
cd only-layers && npm run dev
```

### 4. Build & Typecheck
```bash
# Verify TypeScript types
npm run typecheck

# Build production bundle
npm run build
```

### 5. Package Standalone Desktop Installers
```bash
# Package for macOS (.dmg / .zip) or Windows (.exe NSIS)
npm run dist
```

---

## 🔑 Configuration & API Keys

Only Layers supports dual AI backends:
1. **Groq Cloud (Recommended for Sub-Second Speed):**
   - Provide a Groq API Key (`gsk_...`) in the HUD Settings tab.
   - Automatically uses `whisper-large-v3-turbo` for ASR and `llama-3.3-70b-versatile` (or `llama-3.1-70b` cascade) for text generation.
2. **Google Gemini (Universal Fallback):**
   - Provide a Google Gemini API Key in the HUD Settings tab.
   - Automatically uses `gemini-3.5-flash-lite` and `gemini-3.8-flash` with zero thinking budget for sub-300ms Time-to-First-Token.

*Note: API keys are securely persisted locally via browser `localStorage` and never hardcoded in source files.*

---

## 📄 License
MIT License. Created by [Raghav](https://github.com/Raghavv7989).
