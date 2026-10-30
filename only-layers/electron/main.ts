import { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, screen, session, systemPreferences } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
let isClickThrough = false;

// Enable native speech dispatcher on Linux only
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-speech-dispatcher');
}

// Ensure single instance lock so restarts never create orphaned zombie processes
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('Another instance is already running. Quitting secondary process.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      enforceFullScreenLayer(mainWindow);
      mainWindow.showInactive();
      mainWindow.moveTop();
    } else {
      createWindow();
    }
  });
}

const FLASH_CASCADE = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

const MODELS_CASCADE = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
];

/**
 * Ensures the overlay window floats on top of any dedicated macOS/Windows Full-Screen Spaces
 * and Kiosk browser windows without stealing focus or triggering window blur events.
 */
function enforceFullScreenLayer(win: BrowserWindow) {
  try {
    win.setContentProtection(true);
  } catch (err) {
    console.warn('setContentProtection failed:', err);
  }
  try {
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  } catch (err) {
    console.warn('setVisibleOnAllWorkspaces failed:', err);
  }
  try {
    win.setAlwaysOnTop(true, 'screen-saver', 2);
  } catch (err) {
    console.warn('setAlwaysOnTop failed:', err);
  }
}

function createWindow() {
  const currentDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay();
  const { x: dispX, y: dispY, width, height } = currentDisplay.workArea;

  const winWidth = 460;
  const winHeight = Math.min(680, height - 60);
  const winX = dispX + width - winWidth - 25;
  const winY = dispY + 35;

  mainWindow = new BrowserWindow({
    type: process.platform === 'darwin' ? 'panel' : 'toolbar',
    width: winWidth,
    height: winHeight,
    x: winX,
    y: winY,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    fullscreenable: false,
    minimizable: false,
    skipTaskbar: true,
    focusable: true, // Allows user interaction and typing into input fields while maintaining stealth panel mode
    resizable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  // Automatically grant media, microphone, speech and clipboard permissions
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audio-capture', 'speech', 'display-capture', 'clipboard-read', 'clipboard-sanitized-write'];
    if (allowed.includes(permission)) {
      return callback(true);
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    const allowed = ['media', 'microphone', 'audio-capture', 'speech', 'display-capture', 'clipboard-read', 'clipboard-sanitized-write'];
    return allowed.includes(permission);
  });

  enforceFullScreenLayer(mainWindow);

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    enforceFullScreenLayer(mainWindow);
    // Zero-focus-loss: Show window without stealing active browser/editor focus
    mainWindow.showInactive();
    mainWindow.moveTop();
  });

  // Renderer error & load logging
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer L${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Renderer Load Failed] ${errorCode}: ${errorDescription} (${validatedURL})`);
  });

  // Load Vite dev server with fallback to pre-built dist
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.VITE_PORT || '5174';
    mainWindow.loadURL(`http://localhost:${port}`).catch((err) => {
      console.warn('Vite dev server load failed, loading compiled dist:', err);
      mainWindow?.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('set-ignore-mouse-events', (_event, ignore: boolean) => {
  if (!mainWindow) return;
  isClickThrough = ignore;
  mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.handle('set-opacity', (_event, opacity: number) => {
  if (!mainWindow) return;
  mainWindow.setOpacity(opacity);
});

ipcMain.handle('set-stealth-protection', (_event, enabled: boolean) => {
  if (!mainWindow) return;
  mainWindow.setContentProtection(enabled);
});

ipcMain.handle('set-focusable', (_event, focusable: boolean) => {
  if (!mainWindow) return;
  mainWindow.setFocusable(focusable);
  if (focusable) {
    mainWindow.focus();
  } else {
    enforceFullScreenLayer(mainWindow);
  }
});

function toggleWindowVisibility(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log('[toggleWindowVisibility] mainWindow is null or destroyed, recreating...');
    createWindow();
    return true;
  }
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
    console.log('HUD hidden via Cmd+B');
    return false;
  } else {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    mainWindow.showInactive();
    mainWindow.moveTop();
    console.log('HUD shown & restored via Cmd+B');
    return true;
  }
}

ipcMain.handle('toggle-window-visibility', () => {
  return toggleWindowVisibility();
});

ipcMain.handle('hide-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  return false;
});

ipcMain.handle('show-window', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return true;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  mainWindow.showInactive();
  mainWindow.moveTop();
  return true;
});

ipcMain.handle('capture-screen', async () => {
  try {
    // 2560x1440 High-DPI capture for razor-sharp small text, math symbols, and logic diagrams
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 2560, height: 1440 },
    });
    const primarySource = sources[0];
    if (!primarySource) return null;
    
    // Convert to compressed JPEG (85% quality) to halve payload size and cut upload latency
    const jpegBuffer = primarySource.thumbnail.toJPEG(85);
    return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
  } catch (err) {
    console.error('Screenshot capture error:', err);
    return null;
  }
});

ipcMain.handle('get-desktop-sources', async (_event, options?: { types?: string[] }) => {
  try {
    const types = (options?.types as ('screen' | 'window')[]) || ['screen', 'window'];
    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width: 150, height: 150 },
    });
    return sources.map((s) => ({ id: s.id, name: s.name }));
  } catch (err) {
    console.error('get-desktop-sources error:', err);
    return [];
  }
});

ipcMain.handle('get-audio-sources', async () => {
  try {
    const screens = await desktopCapturer.getSources({ types: ['screen'] });
    const windows = await desktopCapturer.getSources({ types: ['window'] });
    return [...screens, ...windows].map((s) => ({ id: s.id, name: s.name }));
  } catch (err) {
    console.error('get-audio-sources error:', err);
    return [];
  }
});

ipcMain.handle('parse-pdf', async (_event, data: number[]) => {
  try {
    const { PDFParse } = require('pdf-parse');
    const buffer = Buffer.from(data);
    const parser = new PDFParse(buffer);
    await parser.load();
    const text = await parser.getText();
    return text || '';
  } catch (err) {
    console.error('PDF parsing error:', err);
    return '';
  }
});

// Native Gemini API IPC Execution (Eliminates CORS & Browser Network Failures)
ipcMain.handle('gemini-test-key', async (_event, apiKey: string) => {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: 'Please enter a valid Gemini API key.' };
  }

  try {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
    
    let lastError: unknown = null;
    for (const m of MODELS_CASCADE) {
      try {
        const res = await ai.models.generateContent({
          model: m,
          contents: 'Ping',
        });
        if (res && res.text) {
          console.log(`[Gemini Test] Key verified successfully using model: ${m}`);
          return { ok: true, model: m };
        }
      } catch (err) {
        lastError = err;
        console.warn(`[Gemini Test] Model ${m} ping failed:`, (err as Error)?.message?.slice(0, 80));
      }
    }

    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    if (msg.includes('API key not valid') || msg.includes('INVALID_ARGUMENT') || msg.includes('API_KEY_INVALID')) {
      return { ok: false, error: 'Invalid API key. Please check your Gemini key in Google AI Studio.' };
    }
    return { ok: false, error: msg };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('API key not valid') || msg.includes('INVALID_ARGUMENT') || msg.includes('API_KEY_INVALID')) {
      return { ok: false, error: 'Invalid API key. Please check your Gemini key in Google AI Studio.' };
    }
    return { ok: false, error: msg };
  }
});

interface GenerateParams {
  apiKey: string;
  model?: string;
  prompt: string;
  systemInstruction?: string;
  imageBase64?: string;
  audioBase64?: string;
  audioMimeType?: string;
  thinkingBudget?: number;
  temperature?: number;
  tools?: any[];
  modelsCascade?: string[];
}

ipcMain.handle('gemini-generate', async (_event, params: GenerateParams) => {
  const { apiKey, prompt, systemInstruction, imageBase64, audioBase64, audioMimeType, thinkingBudget, temperature, tools, modelsCascade } = params;
  if (!apiKey) {
    return { ok: false, error: 'Missing Gemini API key. Please configure in Settings.' };
  }

  try {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

    const parts: any[] = [];
    if (systemInstruction) {
      parts.push({ text: `[System]: ${systemInstruction}` });
    }
    parts.push({ text: prompt });

    if (imageBase64) {
      const isPng = imageBase64.startsWith('data:image/png');
      const data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      if (data && data.trim().length > 0) {
        parts.push({
          inlineData: {
            mimeType: isPng ? 'image/png' : 'image/jpeg',
            data: data.trim(),
          },
        });
      }
    }

    let hasAudio = false;
    if (audioBase64) {
      const data = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
      // Only attach audio if it has sufficient payload (> 500 chars) to prevent INVALID_ARGUMENT on empty chunks
      if (data && data.trim().length > 500) {
        parts.push({
          inlineData: {
            mimeType: audioMimeType || 'audio/webm',
            data: data.trim(),
          },
        });
        hasAudio = true;
      }
    }

    const defaultCascade = params.model?.includes('flash') ? FLASH_CASCADE : MODELS_CASCADE;
    const effectiveCascade = modelsCascade && modelsCascade.length > 0 ? modelsCascade : defaultCascade;
    const rawCascade = params.model ? [params.model, ...effectiveCascade] : effectiveCascade;
    const modelsToTry = rawCascade.filter((m, i) => rawCascade.indexOf(m) === i);
    let lastError: unknown = null;

    for (const m of modelsToTry) {
      const config: Record<string, any> = {
        temperature: temperature !== undefined ? temperature : 0.1,
      };
      if (thinkingBudget !== undefined && !m.includes('lite')) {
        config.thinkingConfig = { thinkingBudget };
      }
      if (tools && tools.length > 0) {
        config.tools = tools;
      }

      try {
        const response = await ai.models.generateContent({
          model: m,
          contents: [{ role: 'user', parts }],
          config,
        });
        if (response && response.text) {
          console.log(`[Gemini Main] Successfully generated response with model: ${m} (thinking: ${thinkingBudget ?? 'none'}, tools: ${tools ? 'yes' : 'none'})`);
          return { ok: true, text: response.text, model: m };
        }
      } catch (e: unknown) {
        lastError = e;
        const msg = (e as Error)?.message || String(e);
        console.warn(`[Gemini Main] Model ${m} attempt failed: ${msg.slice(0, 100)}...`);

        // If tools (e.g. googleSearch) caused an error (like unsupported with vision or INVALID_ARGUMENT), retry immediately without tools
        if (tools && tools.length > 0) {
          try {
            console.log(`[Gemini Main] Retrying model ${m} without tools...`);
            const noToolsConfig: Record<string, any> = {
              temperature: temperature !== undefined ? temperature : 0.1,
            };
            if (thinkingBudget !== undefined) {
              noToolsConfig.thinkingConfig = { thinkingBudget };
            }
            const fallbackNoTools = await ai.models.generateContent({
              model: m,
              contents: [{ role: 'user', parts }],
              config: noToolsConfig,
            });
            if (fallbackNoTools && fallbackNoTools.text) {
              return { ok: true, text: fallbackNoTools.text, model: m };
            }
          } catch (toolsRetryErr) {
            console.warn(`[Gemini Main] Retry without tools on ${m} failed:`, (toolsRetryErr as Error)?.message?.slice(0, 80));
          }
        }

        // If thinkingConfig caused INVALID_ARGUMENT or unsupported, retry immediately without thinkingConfig
        if (thinkingBudget !== undefined && (msg.includes('INVALID_ARGUMENT') || msg.includes('thinking') || msg.includes('400'))) {
          try {
            console.log(`[Gemini Main] Retrying model ${m} without thinkingConfig...`);
            const fallbackResponse = await ai.models.generateContent({
              model: m,
              contents: [{ role: 'user', parts }],
              config: { temperature: temperature !== undefined ? temperature : 0.1 },
            });
            if (fallbackResponse && fallbackResponse.text) {
              return { ok: true, text: fallbackResponse.text, model: m };
            }
          } catch (retryErr) {
            console.warn(`[Gemini Main] Non-thinking retry on ${m} failed:`, retryErr);
          }
        }
      }
    }

    const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
    return { ok: false, error: errorMsg };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('quit-app', () => {
  app.quit();
});

// App Lifecycle
app.whenReady().then(() => {
  // Step 1A: Set macOS activation policy to 'accessory' BEFORE window creation so macOS WindowServer
  // treats Only Layers as a system-wide floating overlay agent that draws directly inside full-screen spaces & kiosk tabs
  if (process.platform === 'darwin') {
    app.setActivationPolicy('accessory');
    systemPreferences.askForMediaAccess('microphone').catch(() => {});

    // Check/request accessibility permissions on macOS if needed for global shortcuts
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    console.log('Accessibility client trusted state:', trusted);
    if (!trusted) {
      console.warn('⚠️ macOS Accessibility permission not granted. Prompting user to enable Accessibility in macOS Settings...');
      // Calling with prompt: true opens native macOS prompt to grant Accessibility permissions
      systemPreferences.isTrustedAccessibilityClient(true);
    }
  }

  // Ensure Electron never blocks microphone or desktop audio streams
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  createWindow();

  // Hide dock icon after window creation so macOS window server renders properly
  if (app.dock) {
    app.dock.hide();
  }

  // Register Cmd/Ctrl + B to toggle HUD visibility safely on full-screen tabs
  if (globalShortcut.isRegistered('CommandOrControl+B')) {
    globalShortcut.unregister('CommandOrControl+B');
  }
  const retB = globalShortcut.register('CommandOrControl+B', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
        mainWindow.hide();
        console.log('HUD hidden via Cmd+B');
      } else {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        mainWindow.showInactive();
        mainWindow.moveTop();
        console.log('HUD shown & restored via Cmd+B');
      }
    } else {
      console.log('mainWindow is null or destroyed during CommandOrControl+B, recreating...');
      createWindow();
    }
  });

  if (!retB) {
    console.error('Registration failed for CommandOrControl+B');
  } else {
    console.log('Successfully registered global shortcut: CommandOrControl+B');
  }

  // Register Cmd/Ctrl + M = Minimize/Hide quick safety hotkey
  if (globalShortcut.isRegistered('CommandOrControl+M')) {
    globalShortcut.unregister('CommandOrControl+M');
  }
  const retM = globalShortcut.register('CommandOrControl+M', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
      console.log('HUD hidden via Cmd+M');
    }
  });

  if (!retM) {
    console.error('Registration failed for CommandOrControl+M');
  } else {
    console.log('Successfully registered global shortcut: CommandOrControl+M');
  }

  // Support Cmd/Ctrl + Shift + M for click-through toggle
  if (globalShortcut.isRegistered('CommandOrControl+Shift+M')) {
    globalShortcut.unregister('CommandOrControl+Shift+M');
  }
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    isClickThrough = !isClickThrough;
    mainWindow.setIgnoreMouseEvents(isClickThrough, { forward: true });
    mainWindow.webContents.send('click-through-toggled', isClickThrough);
  });

  // Register Cmd/Ctrl + Shift + S for screen solver (Zero focus loss proctoring stealth on full-screen tabs)
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    if (!mainWindow.isVisible()) {
      enforceFullScreenLayer(mainWindow);
      mainWindow.showInactive();
      mainWindow.moveTop();
    } else {
      enforceFullScreenLayer(mainWindow);
      mainWindow.moveTop();
    }
    mainWindow.webContents.send('trigger-screen-solve');
  });

  // Register Cmd/Ctrl + Down for hands-free stealth scrolling (Zero mouse needed)
  globalShortcut.register('CommandOrControl+Down', () => {
    if (mainWindow) {
      mainWindow.webContents.send('scroll-hud', 'down');
    }
  });

  // Register Cmd/Ctrl + Up for hands-free stealth scrolling (Zero mouse needed)
  globalShortcut.register('CommandOrControl+Up', () => {
    if (mainWindow) {
      mainWindow.webContents.send('scroll-hud', 'up');
    }
  });

  // Register Cmd/Ctrl + Enter for forced audio answer
  globalShortcut.register('CommandOrControl+Enter', () => {
    if (mainWindow) {
      enforceFullScreenLayer(mainWindow);
      mainWindow.webContents.send('trigger-audio-answer');
    }
  });
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else if (!mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit();
});
