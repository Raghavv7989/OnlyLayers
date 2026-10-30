import React, { useState, useEffect } from 'react';
import { Key, Keyboard, Check, ShieldCheck, X, RefreshCw, AlertTriangle, Zap, Copy, Eye, EyeOff } from 'lucide-react';
import { getStoredApiKey, setStoredApiKey } from '../services/geminiLive';
import {
  getStoredGroqApiKey,
  setStoredGroqApiKey,
  testGroqKey,
} from '../services/groqEngine';
import { GoogleGenAI } from '@google/genai';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState(getStoredApiKey());
  const [groqKey, setGroqKey] = useState(getStoredGroqApiKey());
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isTestingGroq, setIsTestingGroq] = useState(false);
  const [testStatus, setTestStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [groqTestStatus, setGroqTestStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (typeof window.electronAPI?.setFocusable === 'function') {
      window.electronAPI.setFocusable(isOpen);
    }
    return () => {
      if (typeof window.electronAPI?.setFocusable === 'function') {
        window.electronAPI.setFocusable(false);
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePasteGroqKey = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        const clean = text.trim();
        setGroqKey(clean);
        setStoredGroqApiKey(clean);
        localStorage.setItem('groq_api_key', clean);
      }
    } catch (e) {
      console.warn('Clipboard read error:', e);
    }
  };

  const handleSave = () => {
    setStoredApiKey(apiKey);
    setStoredGroqApiKey(groqKey);
    if (typeof window.electronAPI?.setFocusable === 'function') {
      window.electronAPI.setFocusable(false);
    }
    onClose();
  };

  const handleTestGroqKey = async () => {
    if (!groqKey.trim()) {
      setGroqTestStatus({ ok: false, msg: 'Please enter a Groq API key first (starts with gsk_...).' });
      return;
    }

    setIsTestingGroq(true);
    setGroqTestStatus(null);

    try {
      const result = await testGroqKey(groqKey.trim());
      setGroqTestStatus({ ok: result.ok, msg: result.msg });
      if (result.ok) {
        setStoredGroqApiKey(groqKey);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setGroqTestStatus({ ok: false, msg: 'Connection failed: ' + msg });
    } finally {
      setIsTestingGroq(false);
    }
  };

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      setTestStatus({ ok: false, msg: 'Please enter a Gemini API key first.' });
      return;
    }

    setIsTesting(true);
    setTestStatus(null);

    // 1. Try Native Electron IPC (Bypasses CORS, connects via Node.js directly)
    if (window.electronAPI?.testGeminiKey) {
      try {
        const result = await window.electronAPI.testGeminiKey(apiKey.trim());
        if (result.ok) {
          setStoredApiKey(apiKey);
          setTestStatus({ ok: true, msg: `API Key is valid & connected! (${result.model || 'gemini-3.1-flash-lite'})` });
        } else {
          setTestStatus({ ok: false, msg: result.error || 'Connection failed' });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setTestStatus({ ok: false, msg: 'IPC connection failed: ' + msg });
      } finally {
        setIsTesting(false);
      }
      return;
    }

    // 2. Browser fallback
    try {
      const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
      const res = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: 'Ping',
      });
      if (res.text) {
        setStoredApiKey(apiKey);
        setTestStatus({ ok: true, msg: 'API Key is valid and active!' });
      } else {
        setTestStatus({ ok: false, msg: 'No response received from Gemini.' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestStatus({ ok: false, msg: 'Connection failed: ' + msg });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-white/15 rounded-xl shadow-2xl p-4 text-slate-200 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h3 className="font-semibold text-sm">Settings & Hotkeys</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* API Key Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5 text-indigo-400" />
            <span>Google Gemini API Key</span>
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="flex-1 bg-black/50 border border-white/15 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={handleTestKey}
              disabled={isTesting || !apiKey.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
            >
              {isTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Test'}
            </button>
          </div>
          {testStatus && (
            <div
              className={`text-[11px] p-2 rounded-lg flex items-start gap-1.5 ${
                testStatus.ok
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                  : 'bg-rose-500/15 text-rose-300 border border-rose-500/20'
              }`}
            >
              {testStatus.ok ? (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span className="leading-snug">{testStatus.msg}</span>
            </div>
          )}
          <p className="text-[10px] text-slate-400">
            Get your free Gemini API key from <span className="text-indigo-400 font-mono">aistudio.google.com</span>. Key is stored locally on this machine.
          </p>
        </div>

        {/* Groq Cloud API Key Input (Parakeet Turbo Engine) */}
        <div className="space-y-1.5 border-t border-white/10 pt-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Groq Cloud API Key (Parakeet Turbo)</span>
            </label>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono border border-amber-500/20">
              Whisper Turbo + Llama-3.3-70B
            </span>
          </div>
          <div className="flex gap-1.5 items-center">
            <div className="relative flex-1">
              <input
                type={showGroqKey ? 'text' : 'password'}
                value={groqKey}
                onChange={(e) => {
                  const val = e.target.value;
                  setGroqKey(val);
                  setStoredGroqApiKey(val);
                  localStorage.setItem('groq_api_key', val);
                }}
                placeholder="Enter Groq API Key (gsk_...)"
                className="w-full bg-black/50 border border-white/15 rounded-lg px-3 py-1.5 pr-8 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-amber-500 select-text"
              />
              <button
                type="button"
                onClick={() => setShowGroqKey(!showGroqKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                title={showGroqKey ? 'Hide key' : 'Show key'}
              >
                {showGroqKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button
              type="button"
              onClick={handlePasteGroqKey}
              className="bg-white/10 hover:bg-white/15 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1 transition-colors"
              title="Paste API Key from Clipboard"
            >
              <Copy className="w-3 h-3" />
              <span>Paste</span>
            </button>
            <button
              onClick={handleTestGroqKey}
              disabled={isTestingGroq || !groqKey.trim()}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors shrink-0"
            >
              {isTestingGroq ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Test'}
            </button>
          </div>
          {groqTestStatus && (
            <div
              className={`text-[11px] p-2 rounded-lg flex items-start gap-1.5 ${
                groqTestStatus.ok
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                  : 'bg-rose-500/15 text-rose-300 border border-rose-500/20'
              }`}
            >
              {groqTestStatus.ok ? (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span className="leading-snug">{groqTestStatus.msg}</span>
            </div>
          )}
          <p className="text-[10px] text-slate-400">
            Get your free Groq API key from <span className="text-amber-400 font-mono">console.groq.com/keys</span>. Enables ~0.7s total turnaround with Whisper Large-v3-Turbo + Llama-3.3-70B.
          </p>
        </div>

        {/* Hotkeys Cheat Sheet */}
        <div className="space-y-2 border-t border-white/10 pt-3">
          <div className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
            <Keyboard className="w-3.5 h-3.5 text-amber-400" />
            <span>Global Stealth Hotkeys</span>
          </div>
          <div className="space-y-1.5 text-[11px] font-mono">
            <div className="flex justify-between items-center bg-black/30 px-2.5 py-1.5 rounded border border-white/5">
              <span className="text-slate-400">Hide / Show HUD</span>
              <span className="bg-white/10 px-1.5 py-0.5 rounded text-white font-bold">Cmd / Ctrl + B</span>
            </div>
            <div className="flex justify-between items-center bg-black/30 px-2.5 py-1.5 rounded border border-white/5">
              <span className="text-slate-400">Toggle Click-Through</span>
              <span className="bg-white/10 px-1.5 py-0.5 rounded text-white font-bold">Cmd / Ctrl + M</span>
            </div>
            <div className="flex justify-between items-center bg-black/30 px-2.5 py-1.5 rounded border border-white/5">
              <span className="text-slate-400">Trigger Screen Solve</span>
              <span className="bg-white/10 px-1.5 py-0.5 rounded text-white font-bold">Cmd + Shift + S</span>
            </div>
            <div className="flex justify-between items-center bg-black/30 px-2.5 py-1.5 rounded border border-white/5">
              <span className="text-slate-400">Trigger Audio Answer</span>
              <span className="bg-white/10 px-1.5 py-0.5 rounded text-white font-bold">Cmd + Enter</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors shadow-sm shadow-indigo-500/30"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};
