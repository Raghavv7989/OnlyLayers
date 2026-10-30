import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Sparkles, RefreshCw, Copy, Check, BookOpen, Zap, Eye, EyeOff } from 'lucide-react';
import {
  getStoredResume,
  setStoredResume,
  getStoredJD,
  setStoredJD,
  getStoredNotes,
  setStoredNotes,
  parseResumeFile,
  extractKeywordMatch,
  generateInterviewTalkingPoints,
  SkillMatchResult,
} from '../services/resumeEngine';
import {
  getStoredGroqApiKey,
  setStoredGroqApiKey,
  testGroqKey,
  hasGroqApiKey,
} from '../services/groqEngine';

export const ResumeMatcher: React.FC = () => {
  const [resumeText, setResumeText] = useState('');
  const [jdText, setJdText] = useState('');
  const [notesText, setNotesText] = useState('');
  const [matchResult, setMatchResult] = useState<SkillMatchResult | null>(null);
  const [talkingPoints, setTalkingPoints] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Groq Turbo Key State
  const [groqKey, setGroqKey] = useState(getStoredGroqApiKey());
  const [hasGroqKey, setHasGroqKey] = useState(hasGroqApiKey());
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [isTestingGroq, setIsTestingGroq] = useState(false);
  const [groqStatus, setGroqStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    // Ensure window is focusable so inputs accept keyboard events and paste
    if (typeof window.electronAPI?.setFocusable === 'function') {
      window.electronAPI.setFocusable(true);
    }

    const savedResume = getStoredResume();
    const savedJD = getStoredJD();
    const savedNotes = getStoredNotes();
    setResumeText(savedResume);
    setJdText(savedJD);
    setNotesText(savedNotes);
    setHasGroqKey(hasGroqApiKey());
    if (savedResume && savedJD) {
      setMatchResult(extractKeywordMatch(savedResume, savedJD));
    }
  }, []);

  const handlePasteGroqKey = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        const clean = text.trim();
        setGroqKey(clean);
        setStoredGroqApiKey(clean);
        localStorage.setItem('groq_api_key', clean);
        setHasGroqKey(hasGroqApiKey());
      }
    } catch (e) {
      console.warn('Clipboard read error:', e);
    }
  };

  const handleTestGroq = async () => {
    if (!groqKey.trim()) {
      setGroqStatus({ ok: false, msg: 'Enter Groq key starting with gsk_...' });
      return;
    }
    setIsTestingGroq(true);
    setGroqStatus(null);
    try {
      const res = await testGroqKey(groqKey.trim());
      setGroqStatus({ ok: res.ok, msg: res.msg });
      if (res.ok) {
        setHasGroqKey(true);
        setStoredGroqApiKey(groqKey.trim());
      }
    } catch (err: unknown) {
      setGroqStatus({ ok: false, msg: String(err) });
    } finally {
      setIsTestingGroq(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    try {
      const parsed = await parseResumeFile(file);
      setResumeText(parsed);
      setStoredResume(parsed);
      if (jdText) {
        setMatchResult(extractKeywordMatch(parsed, jdText));
      }
    } catch (err: unknown) {
      setError('Failed to parse file: ' + String(err));
    }
  };

  const handleJdChange = (val: string) => {
    setJdText(val);
    setStoredJD(val);
    if (resumeText) {
      setMatchResult(extractKeywordMatch(resumeText, val));
    }
  };

  const handleNotesChange = (val: string) => {
    setNotesText(val);
    setStoredNotes(val);
  };

  const handleGeneratePoints = async () => {
    if (!resumeText.trim() || !jdText.trim() || isLoading) return;
    setError(null);
    setIsLoading(true);
    setTalkingPoints('');

    try {
      const points = await generateInterviewTalkingPoints(resumeText, jdText);
      setTalkingPoints(points);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!talkingPoints) return;
    navigator.clipboard.writeText(talkingPoints);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full space-y-2.5 overflow-y-auto pr-0.5">
      {/* Upload & JD Input */}
      <div className="grid grid-cols-2 gap-2 shrink-0">
        {/* Resume Box */}
        <div className="bg-black/30 p-2 rounded-lg border border-white/10 flex flex-col justify-between">
          <div>
            <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <FileText className="w-3 h-3 text-indigo-400" /> Resume Profile
              </span>
              <label className="cursor-pointer text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-0.5">
                <Upload className="w-2.5 h-2.5" />
                <span>Upload</span>
                <input
                  type="file"
                  accept=".pdf,.txt,.md"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
            <textarea
              value={resumeText}
              onChange={(e) => {
                setResumeText(e.target.value);
                setStoredResume(e.target.value);
                if (jdText) setMatchResult(extractKeywordMatch(e.target.value, jdText));
              }}
              placeholder="Paste or upload candidate resume (PDF/MD/TXT)..."
              rows={2}
              className="w-full bg-transparent text-[11px] text-slate-200 resize-none focus:outline-none placeholder-slate-600 font-mono"
            />
          </div>
          {resumeText && (
            <div className="text-[9px] text-emerald-400 font-mono flex items-center gap-1 mt-0.5">
              <CheckCircle2 className="w-2.5 h-2.5" />
              <span>Resume cached ({resumeText.length} chars)</span>
            </div>
          )}
        </div>

        {/* Job Description Box */}
        <div className="bg-black/30 p-2 rounded-lg border border-white/10 flex flex-col justify-between">
          <div>
            <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400 mb-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 text-amber-400" /> Target Job (JD)
            </div>
            <textarea
              value={jdText}
              onChange={(e) => handleJdChange(e.target.value)}
              placeholder="Paste target job description & requirements..."
              rows={2}
              className="w-full bg-transparent text-[11px] text-slate-200 resize-none focus:outline-none placeholder-slate-600 font-mono"
            />
          </div>
          {jdText && (
            <div className="text-[9px] text-indigo-300 font-mono flex items-center gap-1 mt-0.5">
              <CheckCircle2 className="w-2.5 h-2.5" />
              <span>JD cached ({jdText.length} chars)</span>
            </div>
          )}
        </div>
      </div>

      {/* Custom Cheat Sheet & Key Facts Box */}
      <div className="bg-black/30 p-2 rounded-lg border border-white/10 shrink-0">
        <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400 mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <BookOpen className="w-3 h-3 text-emerald-400" /> Custom Cheat-Sheet & System Notes
          </span>
          <span className="text-[9px] text-slate-500 font-mono">Instant RAM Grounding</span>
        </div>
        <textarea
          value={notesText}
          onChange={(e) => handleNotesChange(e.target.value)}
          placeholder="Add custom talking points, system design metrics, or personal achievements to auto-inject into every live answer..."
          rows={2}
          className="w-full bg-transparent text-[11px] text-slate-200 resize-none focus:outline-none placeholder-slate-600 font-mono"
        />
        {notesText && (
          <div className="text-[9px] text-emerald-400 font-mono flex items-center gap-1 mt-0.5">
            <CheckCircle2 className="w-2.5 h-2.5" />
            <span>Notes cached ({notesText.length} chars)</span>
          </div>
        )}
      </div>

      {/* Groq Cloud & Gemini Engine Configuration */}
      <div className="bg-white/5 p-2 rounded-lg border border-white/10 space-y-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400" /> Groq Cloud API Key (Sub-Second Parakeet)
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono border border-amber-500/20">
            {hasGroqKey ? '⚡ Turbo Active' : 'Fallback: Gemini Flash'}
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
                setHasGroqKey(Boolean(val && val.startsWith('gsk_') && val.length > 20));
              }}
              onFocus={() => {
                if (typeof window.electronAPI?.setFocusable === 'function') {
                  window.electronAPI.setFocusable(true);
                }
              }}
              onClick={() => {
                if (typeof window.electronAPI?.setFocusable === 'function') {
                  window.electronAPI.setFocusable(true);
                }
              }}
              placeholder="Enter Groq API Key (gsk_...)"
              className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 pr-8 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-amber-500 select-text"
            />
            <button
              type="button"
              onClick={() => setShowGroqKey(!showGroqKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              title={showGroqKey ? 'Hide key' : 'Show key'}
            >
              {showGroqKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button
            type="button"
            onClick={handlePasteGroqKey}
            className="bg-white/10 hover:bg-white/15 text-slate-200 px-2.5 py-1.5 rounded text-xs font-mono flex items-center gap-1 transition-colors"
            title="Paste key from clipboard"
          >
            <Copy className="w-3 h-3" />
            <span>Paste</span>
          </button>
          <button
            onClick={handleTestGroq}
            disabled={isTestingGroq || !groqKey.trim()}
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1 transition-colors shrink-0"
          >
            {isTestingGroq ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Test'}
          </button>
        </div>
        {groqStatus && (
          <div className={`text-[10px] p-1.5 rounded flex items-center gap-1 ${groqStatus.ok ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-rose-500/15 text-rose-300 border border-rose-500/20'}`}>
            {groqStatus.ok ? <Check className="w-3 h-3 text-emerald-400" /> : <AlertCircle className="w-3 h-3 text-rose-400" />}
            <span>{groqStatus.msg}</span>
          </div>
        )}
      </div>

      {/* Match Score & Badges */}
      {matchResult && (
        <div className="bg-white/5 p-2 rounded-lg border border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="text-base font-bold font-mono text-emerald-400">
              {matchResult.matchScore}%
            </div>
            <div className="text-[10px] text-slate-400 leading-tight">
              Skill Alignment
              <div className="text-[9px] text-slate-500 font-mono">
                {matchResult.matchedSkills.length} matched / {matchResult.missingSkills.length} missing
              </div>
            </div>
          </div>

          <button
            onClick={handleGeneratePoints}
            disabled={isLoading || !resumeText || !jdText}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors shadow-sm shadow-indigo-500/20"
          >
            {isLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            <span>Generate STAR Points</span>
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-2 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded text-xs shrink-0">
          {error}
        </div>
      )}

      {/* STAR Points Output */}
      <div className="flex-1 overflow-y-auto bg-black/30 rounded-lg p-3 border border-white/5 font-mono text-xs text-slate-200 leading-relaxed min-h-[120px] relative select-text">
        {isLoading && (
          <div className="flex items-center gap-2 text-indigo-400 animate-pulse text-xs py-4 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Formulating tailored STAR talking points...</span>
          </div>
        )}

        {talkingPoints ? (
          <div>
            <div className="whitespace-pre-wrap font-sans text-xs">{talkingPoints}</div>
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 text-slate-300 rounded-md transition-colors"
              title="Copy talking points"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        ) : (
          !isLoading && (
            <div className="text-slate-500 text-center py-5 text-xs select-none">
              Upload resume and paste JD to generate custom STAR stories and speaking points.
            </div>
          )
        )}
      </div>
    </div>
  );
};
