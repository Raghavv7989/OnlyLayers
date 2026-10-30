export interface GenerateParams {
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

export interface ElectronAPI {
  setIgnoreMouseEvents: (ignore: boolean) => Promise<void>;
  setOpacity: (opacity: number) => Promise<void>;
  setStealthProtection: (enabled: boolean) => Promise<void>;
  setFocusable: (focusable: boolean) => Promise<void>;
  toggleWindowVisibility: () => Promise<boolean>;
  toggleHud?: () => Promise<boolean>;
  hideHud?: () => Promise<boolean>;
  showHud?: () => Promise<boolean>;
  captureScreen: () => Promise<string | null>;
  getDesktopSources: (options?: { types?: string[] }) => Promise<Array<{ id: string; name: string }>>;
  getAudioSources: () => Promise<Array<{ id: string; name: string }>>;
  parsePdf: (data: number[]) => Promise<string>;
  testGeminiKey: (apiKey: string) => Promise<{ ok: boolean; model?: string; error?: string }>;
  geminiGenerate: (params: GenerateParams) => Promise<{ ok: boolean; text?: string; error?: string }>;
  quitApp: () => Promise<void>;
  onClickThroughToggled: (callback: (isLocked: boolean) => void) => void;
  onTriggerScreenSolve: (callback: () => void) => void;
  onTriggerAudioAnswer: (callback: () => void) => void;
  onScrollHud: (callback: (direction: 'up' | 'down') => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
