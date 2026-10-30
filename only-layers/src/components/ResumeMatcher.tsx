import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  BookOpen,
  Zap,
  Eye,
  EyeOff,
  Trash2,
  FileUp,
  Sliders,
  Briefcase,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  getStoredResume,
  setStoredResume,
  getStoredJD,
  setStoredJD,
  getStoredCustomInstructions,
  setStoredCustomInstructions,
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

const PRESET_INSTRUCTIONS = [
  '⚡ Under 3 sentences',
  '🎯 Staff Engineer framing',
  '⭐ First-person STAR format',
  '📊 Emphasize Metrics & Scale',
  '🛠️ React & TypeScript focus',
  '🐍 Python & FastAPI focus',
  '🏗️ Deep System Design',
  '🚫 No textbook definitions',
];

export const ResumeMatcher: React.FC = () => {
  const [resumeText, setResumeText] = useState('');
  const [jdText, setJdText] = useState('');
  const [customInstructions, setCustomInstructionsState] = useState('');
  const [matchResult, setMatchResult] = useState<SkillMatchResult | null>(null);
  const [talkingPoints, setTalkingPoints] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // File drag & upload state
  const [isDragging, setIsDragging] = useState(false);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [showRawResume, setShowRawResume] = useState(true);

  // Groq Turbo Key State
  const [groqKey, setGroqKey] = useState(getStoredGroqApiKey());
  const [hasGroqKey, setHasGroqKey] = useState(hasGroqApiKey());
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [isTestingGroq, setIsTestingGroq] = useState(false);
  const [groqStatus, setGroqStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Ensure window is focusable so textareas and inputs accept keyboard events and paste
    if (typeof window.electronAPI?.setFocusable === 'function') {
      window.electronAPI.setFocusable(true);
    }

    const savedResume = getStoredResume();
    const savedJD = getStoredJD();
    const savedInstructions = getStoredCustomInstructions();

    setResumeText(savedResume);
    setJdText(savedJD);
    setCustomInstructionsState(savedInstructions);
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

  const processFile = async (file: File) => {
    setError(null);
    setIsParsingFile(true);
    setUploadedFileName(file.name);
    try {
      const parsed = await parseResumeFile(file);
      setResumeText(parsed);
      setStoredResume(parsed);
      if (jdText) {
        setMatchResult(extractKeywordMatch(parsed, jdText));
      }
    } catch (err: unknown) {
      setError('Failed to parse file: ' + String(err));
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleResumeTextChange = (val: string) => {
    setResumeText(val);
    setStoredResume(val);
    if (jdText) {
      setMatchResult(extractKeywordMatch(val, jdText));
    }
  };

  const handleClearResume = () => {
    setResumeText('');
    setStoredResume('');
    setUploadedFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (jdText) {
      setMatchResult(extractKeywordMatch('', jdText));
    }
  };

  const handleJdChange = (val: string) => {
    setJdText(val);
    setStoredJD(val);
    if (resumeText) {
      setMatchResult(extractKeywordMatch(resumeText, val));
    }
  };

  const handleClearJd = () => {
    setJdText('');
    setStoredJD('');
    setMatchResult(null);
  };

  const handleInstructionsChange = (val: string) => {
    setCustomInstructionsState(val);
    setStoredCustomInstructions(val);
  };

  const handleTogglePresetInstruction = (preset: string) => {
    let nextInstructions = customInstructions.trim();
    if (nextInstructions.includes(preset)) {
      nextInstructions = nextInstructions
        .replace(preset, '')
        .replace(/\n\n+/g, '\n')
        .trim();
    } else {
      nextInstructions = nextInstructions ? `${nextInstructions}\n• ${preset}` : `• ${preset}`;
    }
    handleInstructionsChange(nextInstructions);
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

  const totalGroundedChars = resumeText.length + jdText.length + customInstructions.length;

  return (
    <div className="flex flex-col h-full space-y-2.5 overflow-y-auto pr-1 select-text">
      {/* Top Grounding Status Strip */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-black/40 rounded-xl border border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-indigo-500/20 text-indigo-400">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-200">Parakeet 2.0 Context Engine</div>
            <div className="text-[10px] text-slate-400">
              Grounds live answers in your resume projects, target JD, & custom preferences
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-300">
            🧠 RAM Grounded: <strong className="text-emerald-400">{totalGroundedChars}</strong> chars
          </span>
        </div>
      </div>

      {/* Resume Dropzone & Text Input Card */}
      <div className="bg-black/30 p-2.5 rounded-xl border border-white/10 shrink-0 space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
            <span>Candidate Resume (PDF, TXT, MD)</span>
          </div>

          <div className="flex items-center gap-2">
            {resumeText && (
              <button
                type="button"
                onClick={handleClearResume}
                className="text-[10px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors"
                title="Clear resume"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowRawResume(!showRawResume)}
              className="text-[10px] text-indigo-300 hover:text-indigo-200 flex items-center gap-0.5 transition-colors"
            >
              <span>{showRawResume ? 'Collapse Editor' : 'Edit Raw Text'}</span>
              {showRawResume ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Drag & Drop File Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-indigo-400 bg-indigo-950/30'
              : 'border-white/10 hover:border-indigo-500/50 bg-black/20 hover:bg-black/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md"
            onChange={handleFileUpload}
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center gap-1">
            {isParsingFile ? (
              <div className="flex items-center gap-2 text-indigo-400 text-xs py-1">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Parsing resume text via native extractor...</span>
              </div>
            ) : (
              <>
                <FileUp className="w-5 h-5 text-indigo-400" />
                <div className="text-xs text-slate-300">
                  <span className="font-semibold text-indigo-300">Drop your Resume (.PDF, .TXT)</span> or click to browse
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  Extracted locally into RAM cache • Never sent to any third party
                </div>
              </>
            )}
          </div>
        </div>

        {/* Status Pill & Raw Textarea */}
        {showRawResume && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono px-0.5">
              <span>
                {uploadedFileName ? `Source: ${uploadedFileName}` : 'Raw Resume Text / Direct Paste'}
              </span>
              <span>{resumeText.length} characters</span>
            </div>
            <textarea
              value={resumeText}
              onChange={(e) => handleResumeTextChange(e.target.value)}
              onFocus={() => window.electronAPI?.setFocusable?.(true)}
              onClick={() => window.electronAPI?.setFocusable?.(true)}
              placeholder="Paste or edit extracted resume text here (projects, achievements, skills, work history)..."
              rows={3}
              className="w-full bg-black/50 text-[11px] text-slate-200 p-2 rounded-lg border border-white/10 resize-y focus:outline-none focus:border-indigo-500 placeholder-slate-600 font-mono leading-relaxed"
            />
          </div>
        )}
      </div>

      {/* Target Job Description & Custom Instructions Grid */}
      <div className="grid grid-cols-2 gap-2 shrink-0">
        {/* Target Job Description Box */}
        <div className="bg-black/30 p-2.5 rounded-xl border border-white/10 flex flex-col justify-between space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
            <div className="flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-amber-400" />
              <span>Target Role & Job Spec (JD)</span>
            </div>
            {jdText && (
              <button
                type="button"
                onClick={handleClearJd}
                className="text-[10px] text-slate-400 hover:text-rose-400 flex items-center gap-0.5 transition-colors"
                title="Clear JD"
              >
                <Trash2 className="w-2.5 h-2.5" />
                <span>Clear</span>
              </button>
            )}
          </div>

          <textarea
            value={jdText}
            onChange={(e) => handleJdChange(e.target.value)}
            onFocus={() => window.electronAPI?.setFocusable?.(true)}
            onClick={() => window.electronAPI?.setFocusable?.(true)}
            placeholder="Paste target job description, required tech stack, responsibilities, & role seniority..."
            rows={3}
            className="w-full bg-black/50 text-[11px] text-slate-200 p-2 rounded-lg border border-white/10 resize-y focus:outline-none focus:border-amber-500 placeholder-slate-600 font-mono leading-relaxed"
          />

          <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono">
            <span>Aligns terminology with role</span>
            <span className="text-amber-400/90">{jdText.length} chars</span>
          </div>
        </div>

        {/* Custom Instructions & Behavioral Rules Box */}
        <div className="bg-black/30 p-2.5 rounded-xl border border-white/10 flex flex-col justify-between space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
            <div className="flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-emerald-400" />
              <span>Custom Behavioral Rules</span>
            </div>
            {customInstructions && (
              <button
                type="button"
                onClick={() => handleInstructionsChange('')}
                className="text-[10px] text-slate-400 hover:text-rose-400 flex items-center gap-0.5 transition-colors"
                title="Clear instructions"
              >
                <Trash2 className="w-2.5 h-2.5" />
                <span>Clear</span>
              </button>
            )}
          </div>

          <textarea
            value={customInstructions}
            onChange={(e) => handleInstructionsChange(e.target.value)}
            onFocus={() => window.electronAPI?.setFocusable?.(true)}
            onClick={() => window.electronAPI?.setFocusable?.(true)}
            placeholder="e.g. Keep spoken hook under 2 sentences. Always emphasize latency and cost reduction metrics. Sound confident..."
            rows={3}
            className="w-full bg-black/50 text-[11px] text-slate-200 p-2 rounded-lg border border-white/10 resize-y focus:outline-none focus:border-emerald-500 placeholder-slate-600 font-mono leading-relaxed"
          />

          <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono">
            <span>Direct LLM system prompt rule</span>
            <span className="text-emerald-400/90">{customInstructions.length} chars</span>
          </div>
        </div>
      </div>

      {/* Preset Custom Instruction Chips */}
      <div className="bg-black/20 p-2 rounded-xl border border-white/5 shrink-0 space-y-1.5">
        <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-indigo-400" />
          <span>Quick Instruction Presets (Click to append / toggle):</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_INSTRUCTIONS.map((preset) => {
            const isActive = customInstructions.includes(preset);
            return (
              <button
                key={preset}
                type="button"
                onClick={() => handleTogglePresetInstruction(preset)}
                className={`text-[10px] px-2 py-0.5 rounded-md font-mono transition-all border ${
                  isActive
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                    : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                }`}
              >
                {preset}
              </button>
            );
          })}
        </div>
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
              onFocus={() => window.electronAPI?.setFocusable?.(true)}
              onClick={() => window.electronAPI?.setFocusable?.(true)}
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
          <div
            className={`text-[10px] p-1.5 rounded flex items-center gap-1 ${
              groqStatus.ok
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                : 'bg-rose-500/15 text-rose-300 border border-rose-500/20'
            }`}
          >
            {groqStatus.ok ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3 h-3 text-rose-400" />
            )}
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
