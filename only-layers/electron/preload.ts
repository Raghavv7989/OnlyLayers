import { contextBridge, ipcRenderer } from 'electron';

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

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.invoke('set-ignore-mouse-events', ignore),
  setOpacity: (opacity: number) => ipcRenderer.invoke('set-opacity', opacity),
  setStealthProtection: (enabled: boolean) => ipcRenderer.invoke('set-stealth-protection', enabled),
  setFocusable: (focusable: boolean) => {
    ipcRenderer.send('set-window-focusable', focusable);
    return ipcRenderer.invoke('set-focusable', focusable);
  },
  toggleWindowVisibility: () => ipcRenderer.invoke('toggle-window-visibility'),
  toggleHud: () => ipcRenderer.invoke('toggle-window-visibility'),
  hideHud: () => ipcRenderer.invoke('hide-window'),
  showHud: () => ipcRenderer.invoke('show-window'),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  getDesktopSources: (options?: { types?: string[] }) => ipcRenderer.invoke('get-desktop-sources', options),
  getAudioSources: () => ipcRenderer.invoke('get-audio-sources'),
  parsePdf: (data: number[]) => ipcRenderer.invoke('parse-pdf', data),
  testGeminiKey: (apiKey: string) => ipcRenderer.invoke('gemini-test-key', apiKey),
  geminiGenerate: (params: GenerateParams) => ipcRenderer.invoke('gemini-generate', params),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  onClickThroughToggled: (callback: (isLocked: boolean) => void) => {
    ipcRenderer.on('click-through-toggled', (_event, isLocked) => callback(isLocked));
  },
  onTriggerScreenSolve: (callback: () => void) => {
    ipcRenderer.on('trigger-screen-solve', () => callback());
  },
  onTriggerAudioAnswer: (callback: () => void) => {
    ipcRenderer.on('trigger-audio-answer', () => callback());
  },
  onScrollHud: (callback: (direction: 'up' | 'down') => void) => {
    ipcRenderer.on('scroll-hud', (_event, direction) => callback(direction));
  },
});
