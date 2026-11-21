import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Camera,
  RefreshCw,
  Copy,
  Check,
  Image as ImageIcon,
  Sparkles,
  ShieldCheck,
  Target,
  AlertTriangle,
  CheckCircle2,
  Code2,
  FileCode,
  Bug,
  Plus,
  Trash2,
  Send,
  Zap,
  ArrowRight,
  Clock,
  Layers,
  Terminal,
} from 'lucide-react';
import {
  solveScreenProblem,
  solveMultiScreenCodingProblem,
  CodingTurn,
} from '../services/geminiLive';
import { getCachedInterviewContext } from '../services/resumeEngine';

export type SolverCategory = 'mcq' | 'coding';
export type McqSubMode = 'universal' | 'leetcode' | 'debug' | 'system';

export const SUPPORTED_LANGUAGES = [
  'Python 3',
  'TypeScript',
  'Java',
  'C++',
  'Go',
  'Rust',
  'SQL',
];

export interface ParsedVerdict {
  hasVerdict: boolean;
  correctOption?: string;
  primaryPick?: string;
  trapPick?: string;
  rawBlock?: string;
  bodyText: string;
}

export interface ParsedCodingVerdict {
  hasVerdict: boolean;
  approach?: string;
  timeComplexity?: string;
  spaceComplexity?: string;
  language?: string;
  codeBlock?: string;
  bodyText: string;
}

/**
 * Extracts the locked verdict tags (<VERIFIED_VERDICT>) from MCQ model output.
 */
function parseVerdict(text: string): ParsedVerdict {
  if (!text) {
    return { hasVerdict: false, bodyText: '' };
  }

  const match = text.match(/<VERIFIED_VERDICT>([\s\S]*?)(?:<\/VERIFIED_VERDICT>|$)/i);
  if (!match) {
    return { hasVerdict: false, bodyText: text };
  }

  const rawBlock = match[1].trim();
  let correctOption: string | undefined;
  let primaryPick: string | undefined;
  let trapPick: string | undefined;

  const lines = rawBlock.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(?:✅|✔)?\s*CORRECT OPTION\s*:/i.test(trimmed)) {
      correctOption = trimmed.replace(/^(?:✅|✔)?\s*CORRECT OPTION\s*:\s*/i, '').trim();
    } else if (/^(?:🎯)?\s*PRIMARY PICK TO CLICK\s*:/i.test(trimmed)) {
      primaryPick = trimmed.replace(/^(?:🎯)?\s*PRIMARY PICK TO CLICK\s*:\s*/i, '').trim();
    } else if (/^(?:⚠️)?\s*TRAP \/ SECOND PICK/i.test(trimmed)) {
      trapPick = trimmed.replace(/^(?:⚠️)?\s*TRAP \/ SECOND PICK.*?:\s*/i, '').trim();
    }
  }

  if (!primaryPick && correctOption) {
    primaryPick = correctOption;
  }

  let bodyText = text.replace(/###\s*STEP 4[:\s]+FINAL LOCKED VERDICT[\s\S]*?<VERIFIED_VERDICT>[\s\S]*?(?:<\/VERIFIED_VERDICT>|$)/i, '').trim();
  if (bodyText === text) {
    bodyText = text.replace(/<VERIFIED_VERDICT>[\s\S]*?(?:<\/VERIFIED_VERDICT>|$)/i, '').trim();
  }

  return {
    hasVerdict: Boolean(primaryPick || correctOption || rawBlock),
    correctOption,
    primaryPick,
    trapPick,
    rawBlock,
    bodyText,
  };
}

/**
 * Extracts structured coding verdict & clean code block from Coding model output.
 */
function parseCodingVerdict(text: string): ParsedCodingVerdict {
  if (!text) {
    return { hasVerdict: false, bodyText: '' };
  }

  const match = text.match(/<CODING_VERDICT>([\s\S]*?)(?:<\/CODING_VERDICT>|$)/i);
  let approach: string | undefined;
  let timeComplexity: string | undefined;
  let spaceComplexity: string | undefined;
  let language: string | undefined;

  if (match) {
    const rawBlock = match[1].trim();
    for (const line of rawBlock.split('\n')) {
      const trimmed = line.trim();
      if (/OPTIMAL APPROACH\s*:/i.test(trimmed)) {
        approach = trimmed.replace(/.*?OPTIMAL APPROACH\s*:\s*/i, '').trim();
      } else if (/TIME COMPLEXITY\s*:/i.test(trimmed)) {
        timeComplexity = trimmed.replace(/.*?TIME COMPLEXITY\s*:\s*/i, '').trim();
      } else if (/SPACE COMPLEXITY\s*:/i.test(trimmed)) {
        spaceComplexity = trimmed.replace(/.*?SPACE COMPLEXITY\s*:\s*/i, '').trim();
      } else if (/LANGUAGE\s*:/i.test(trimmed)) {
        language = trimmed.replace(/.*?LANGUAGE\s*:\s*/i, '').trim();
      }
    }
  }

  // Extract primary code block
  let codeBlock: string | undefined;
  const codeMatch = text.match(/```(?:[a-zA-Z0-9_-]*)\n([\s\S]*?)```/);
  if (codeMatch) {
    codeBlock = codeMatch[1].trim();
  }

  let bodyText = text.replace(/<CODING_VERDICT>[\s\S]*?(?:<\/CODING_VERDICT>|$)/i, '').trim();

  return {
    hasVerdict: Boolean(approach || timeComplexity || spaceComplexity || codeBlock),
    approach,
    timeComplexity,
    spaceComplexity,
    language,
    codeBlock,
    bodyText,
  };
}

export const ScreenSolver: React.FC = () => {
  // Top-Level Solver Category Switcher
  const [solverCategory, setSolverCategory] = useState<SolverCategory>('mcq');

  // MCQ Mode State
  const [mcqScreenshot, setMcqScreenshot] = useState<string | null>(null);
  const [mcqSolution, setMcqSolution] = useState<string>('');
  const [mcqSubMode, setMcqSubMode] = useState<McqSubMode>('universal');
  const [isMcqLoading, setIsMcqLoading] = useState(false);
  const [mcqElapsedMs, setMcqElapsedMs] = useState<number | null>(null);

  // Coding Mode State (Multi-Screenshot & Stateful Debugger)
  const [codingImages, setCodingImages] = useState<Array<{ id: string; base64: string; label: string }>>([]);
  const [codingLanguage, setCodingLanguage] = useState<string>('Python 3');
  const [codingSolution, setCodingSolution] = useState<string>('');
  const [isCodingLoading, setIsCodingLoading] = useState(false);
  const [codingElapsedMs, setCodingElapsedMs] = useState<number | null>(null);
  const [errorInput, setErrorInput] = useState<string>('');
  const [codingHistory, setCodingHistory] = useState<CodingTurn[]>([]);

  // Shared UI State
  const [error, setError] = useState<string | null>(null);
  const [copiedFull, setCopiedFull] = useState(false);
  const [copiedPick, setCopiedPick] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const solutionContainerRef = useRef<HTMLDivElement>(null);

  // Parsed Verdicts
  const parsedMcqVerdict = useMemo(() => parseVerdict(mcqSolution), [mcqSolution]);
  const parsedCodingVerdict = useMemo(() => parseCodingVerdict(codingSolution), [codingSolution]);

  // Stealth Hands-Free Scrolling Hotkeys (Cmd+Down / Cmd+Up)
  useEffect(() => {
    if (typeof window.electronAPI?.onScrollHud === 'function') {
      window.electronAPI.onScrollHud((direction) => {
        if (!solutionContainerRef.current) return;
        const delta = direction === 'down' ? 140 : -140;
        solutionContainerRef.current.scrollBy({ top: delta, behavior: 'smooth' });
      });
    }
  }, []);

  // Hotkey trigger (Cmd+Shift+S)
  useEffect(() => {
    if (typeof window.electronAPI?.onTriggerScreenSolve === 'function') {
      window.electronAPI.onTriggerScreenSolve(() => {
        if (solverCategory === 'mcq') {
          captureAndSolveMCQ();
        } else {
          captureAndSolveCoding();
        }
      });
    }
  }, [solverCategory, codingImages, codingLanguage, codingHistory, mcqSubMode]);

  // -------------------------------------------------------------
  // MCQ Mode: Solve-First Chain of Thought
  // -------------------------------------------------------------
  const captureAndSolveMCQ = async (selectedSubMode = mcqSubMode) => {
    setError(null);
    setIsMcqLoading(true);
    setMcqSolution('');
    const startTime = performance.now();

    try {
      let image = mcqScreenshot;
      if (typeof window.electronAPI?.captureScreen === 'function') {
        image = await window.electronAPI.captureScreen();
        setMcqScreenshot(image);
      }

      if (!image) {
        throw new Error('Could not capture screen. Make sure screen recording permissions are granted in System Settings.');
      }

      let prompt = '';
      if (selectedSubMode === 'universal') {
        prompt = `You are an elite, zero-error Quantitative Aptitude, Logical Reasoning, Verbal, and Technical Assessment Solver.
Carefully read the screenshot. Extract the exact question text, every number, every constraint, and all options (A, B, C, D).

ABSOLUTE RULE — DO NOT VIOLATE:
NEVER state or guess the winning option at the beginning of your response! You MUST write out the complete algebraic equations, step-by-step arithmetic, or logical lineage tree FIRST before deciding which option is correct.

PERFORM THESE 4 STEPS IN EXACT ORDER:

### STEP 1: EXACT QUESTION & OPTIONS EXTRACTION
- State the exact question text and list options A, B, C, D verbatim from the image.

### STEP 2: FIRST-PRINCIPLES MATHEMATICAL / LOGICAL SOLVE
- **For Math / Quantitative Aptitude:** Define variables, write algebraic equations, and compute step by step.
- **For Kinship / Logical Puzzles:** Break down clause by clause from the speaker outward.
- **For Series / Coding MCQs:** Trace exact pattern differences, dry-run code line-by-line.

### STEP 3: PLUG-IN AUDIT OF ALL OPTIONS (A, B, C, D)
- Test Option A, B, C, D against the question conditions with exact numeric/logical proof.

### STEP 4: FINAL LOCKED VERDICT (MUST USE EXACT TAGS BELOW)
<VERIFIED_VERDICT>
✅ CORRECT OPTION: [Option Letter + Full Option Text]
🎯 PRIMARY PICK TO CLICK: [Single Best Option Letter + Value]
⚠️ TRAP / SECOND PICK (IF QUIZ KEY IS FLAWED): [Only if wording flaw exists, else "None — 100% Unambiguous"]
</VERIFIED_VERDICT>`;
      } else if (selectedSubMode === 'leetcode') {
        prompt = `Analyze this problem on screen following Solve-First Chain-of-Thought:
1. Identify problem statement, edge cases, and constraints.
2. Formulate optimal algorithm approach, Time Complexity, and Space Complexity.
3. Dry-run solution on example inputs.
4. Output locked verdict:
<VERIFIED_VERDICT>
✅ CORRECT OPTION: [Optimal Approach & Time/Space Complexity]
🎯 PRIMARY PICK TO CLICK: [Core Algorithm Approach / Data Structure]
⚠️ TRAP / SECOND PICK (IF QUIZ KEY IS FLAWED): [Common Edge Case or Trap, or "None"]
</VERIFIED_VERDICT>
5. Complete working solution code.`;
      } else if (selectedSubMode === 'debug') {
        prompt = `Analyze the code and error on screen following Solve-First Chain-of-Thought:
1. Trace execution flow and isolate root cause.
2. Formulate fix and verify against side effects.
3. Output locked verdict:
<VERIFIED_VERDICT>
✅ CORRECT OPTION: [1-sentence Root Cause Fix]
🎯 PRIMARY PICK TO CLICK: [Exact Line / Keyword to Modify]
⚠️ TRAP / SECOND PICK (IF QUIZ KEY IS FLAWED): [Potential Pitfall, or "None"]
</VERIFIED_VERDICT>
4. Exact corrected code snippet and explanation.`;
      } else {
        prompt = `Analyze diagram or architecture on screen following Solve-First Chain-of-Thought:
1. Break down components, data flows, and bottlenecks.
2. Evaluate trade-offs and scaling strategies.
3. Output locked verdict:
<VERIFIED_VERDICT>
✅ CORRECT OPTION: [Primary Architectural Pattern / Recommendation]
🎯 PRIMARY PICK TO CLICK: [Core Component / Scaling Action]
⚠️ TRAP / SECOND PICK (IF QUIZ KEY IS FLAWED): [Bottleneck / Single Point of Failure, or "None"]
</VERIFIED_VERDICT>
4. Detailed breakdown and trade-off analysis.`;
      }

      const resumeContext = getCachedInterviewContext();
      const result = await solveScreenProblem({
        base64Image: image,
        prompt,
        resumeContext,
        onChunk: (chunk) => setMcqSolution(chunk),
        thinkingBudget: 4096,
        temperature: 0.0,
      });

      setMcqSolution(result);
      setMcqElapsedMs(Math.round(performance.now() - startTime));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsMcqLoading(false);
    }
  };

  // -------------------------------------------------------------
  // Coding Mode: Multi-Screenshot & Stateful Debugger
  // -------------------------------------------------------------
  const handleAddCodingScreenshot = async (customLabel?: string) => {
    setError(null);
    try {
      if (typeof window.electronAPI?.captureScreen === 'function') {
        const image = await window.electronAPI.captureScreen();
        if (image) {
          const nextIndex = codingImages.length + 1;
          const label = customLabel || (nextIndex === 1 ? '1. Problem Statement' : nextIndex === 2 ? '2. Code / Constraints' : `${nextIndex}. Error / Test Trace`);
          setCodingImages((prev) => [...prev, { id: Math.random().toString(36).substring(2, 9), base64: image, label }]);
        }
      }
    } catch (err) {
      console.warn('Screenshot capture failed:', err);
    }
  };

  const handleRemoveCodingImage = (id: string) => {
    setCodingImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleClearCodingSession = () => {
    setCodingImages([]);
    setCodingSolution('');
    setCodingHistory([]);
    setErrorInput('');
    setError(null);
    setCodingElapsedMs(null);
  };

  const captureAndSolveCoding = async (explicitErrorTrace?: string) => {
    setError(null);
    setIsCodingLoading(true);
    setCodingSolution('');
    const startTime = performance.now();

    try {
      let currentImages = [...codingImages];

      // If no screenshots taken yet, automatically capture the primary problem screen
      if (currentImages.length === 0 && typeof window.electronAPI?.captureScreen === 'function') {
        const image = await window.electronAPI.captureScreen();
        if (image) {
          const newImg = { id: Math.random().toString(36).substring(2, 9), base64: image, label: '1. Problem Statement' };
          currentImages = [newImg];
          setCodingImages(currentImages);
        }
      }

      if (currentImages.length === 0) {
        throw new Error('Please capture at least one screenshot of the coding problem or code editor.');
      }

      const imagesBase64 = currentImages.map((img) => img.base64);
      const resumeContext = getCachedInterviewContext();
      const activeError = explicitErrorTrace !== undefined ? explicitErrorTrace : errorInput;

      const result = await solveMultiScreenCodingProblem({
        imagesBase64,
        language: codingLanguage,
        errorTrace: activeError.trim() || undefined,
        history: codingHistory,
        resumeContext,
        onChunk: (chunk) => setCodingSolution(chunk),
        thinkingBudget: 4096,
        temperature: 0.0,
      });

      setCodingSolution(result);
      setCodingElapsedMs(Math.round(performance.now() - startTime));

      // Append to stateful debugging turn history
      setCodingHistory((prev) => [
        ...prev,
        {
          role: 'user',
          content: activeError.trim()
            ? `Fixed for error / test failure: ${activeError.trim()}`
            : `Solve in ${codingLanguage} based on attached screenshots.`,
          images: imagesBase64,
          timestamp: new Date().toLocaleTimeString(),
        },
        {
          role: 'assistant',
          content: result,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);

      // Clear the error input after successful debug
      if (activeError.trim()) {
        setErrorInput('');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsCodingLoading(false);
    }
  };

  const handleQuickErrorAction = async (preset: string) => {
    setErrorInput(preset);
    await captureAndSolveCoding(preset);
  };

  const handleCaptureErrorScreenAndFix = async () => {
    if (typeof window.electronAPI?.captureScreen === 'function') {
      const image = await window.electronAPI.captureScreen();
      if (image) {
        const nextIndex = codingImages.length + 1;
        const newImg = { id: Math.random().toString(36).substring(2, 9), base64: image, label: `${nextIndex}. Error / Test Trace` };
        setCodingImages((prev) => [...prev, newImg]);
        await captureAndSolveCoding('Debug and fix the error / failed test case shown in the newly captured error screenshot.');
      }
    }
  };

  const handleCopyFull = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedFull(true);
    setTimeout(() => setCopiedFull(false), 2000);
  };

  const handleCopyPick = (pickText: string) => {
    if (!pickText) return;
    navigator.clipboard.writeText(pickText);
    setCopiedPick(true);
    setTimeout(() => setCopiedPick(false), 2000);
  };

  const handleCopyCodeSnippet = (codeText: string) => {
    if (!codeText) return;
    navigator.clipboard.writeText(codeText);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="flex flex-col h-full space-y-2.5 overflow-hidden">
      {/* Top Level Category Switcher: MCQ vs Coding Mode */}
      <div className="flex items-center justify-between p-1 bg-black/50 rounded-xl border border-white/10 shrink-0">
        <div className="flex items-center gap-1 w-full">
          <button
            onClick={() => {
              setSolverCategory('mcq');
              setError(null);
            }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              solverCategory === 'mcq'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <Target className="w-3.5 h-3.5 text-amber-300" />
            <span>MCQ &amp; Aptitude Solver</span>
          </button>

          <button
            onClick={() => {
              setSolverCategory('coding');
              setError(null);
            }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              solverCategory === 'coding'
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <Code2 className="w-3.5 h-3.5 text-emerald-300" />
            <span>Coding &amp; LeetCode Solver</span>
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* CATEGORY 1: MCQ / APTITUDE MODE                              */}
      {/* ------------------------------------------------------------- */}
      {solverCategory === 'mcq' && (
        <div className="flex flex-col space-y-2 shrink-0">
          <div className="flex items-center justify-between gap-1.5 flex-wrap">
            <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-lg border border-white/10">
              <button
                onClick={() => setMcqSubMode('universal')}
                className={`px-2 py-1 text-[11px] rounded-md transition-colors flex items-center gap-1 ${
                  mcqSubMode === 'universal' ? 'bg-indigo-600 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sparkles className="w-3 h-3 text-amber-300" />
                <span>Universal Auto</span>
              </button>
              <button
                onClick={() => setMcqSubMode('leetcode')}
                className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
                  mcqSubMode === 'leetcode' ? 'bg-indigo-600 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Series / Math
              </button>
              <button
                onClick={() => setMcqSubMode('debug')}
                className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
                  mcqSubMode === 'debug' ? 'bg-indigo-600 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Kinship / Logic
              </button>
              <button
                onClick={() => setMcqSubMode('system')}
                className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
                  mcqSubMode === 'system' ? 'bg-indigo-600 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Architecture
              </button>
            </div>

            <button
              onClick={() => captureAndSolveMCQ()}
              disabled={isMcqLoading}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm shadow-emerald-500/30"
              title="Hotkey: Cmd+Shift+S (Non-Focusing Stealth Capture)"
            >
              {isMcqLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              <span>Capture &amp; Solve</span>
            </button>
          </div>

          {/* Screen Status Strip */}
          <div className="flex items-center justify-between p-1.5 bg-black/40 rounded-lg border border-white/10 text-[11px] text-slate-300">
            <div className="flex items-center gap-1.5 truncate">
              <ImageIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="font-mono text-[10px] text-slate-400">
                {mcqScreenshot ? '2560x1440 High-DPI' : 'Ready (Cmd+Shift+S)'}
              </span>
              <span className="text-[10px] text-emerald-400/90 flex items-center gap-0.5">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>Kiosk Layer</span>
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                Solve-First CoT
              </span>
              {mcqElapsedMs !== null && (
                <span className="text-[10px] text-indigo-300 font-mono">
                  {(mcqElapsedMs / 1000).toFixed(2)}s
                </span>
              )}
            </div>
          </div>

          {/* MCQ Verdict Card */}
          {parsedMcqVerdict.hasVerdict && (
            <div className="bg-gradient-to-r from-emerald-950/70 via-slate-900/90 to-emerald-950/70 border-2 border-emerald-500/60 rounded-xl p-3 shadow-xl shadow-emerald-950/50 backdrop-blur-md relative overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <div className="p-1 rounded-md bg-emerald-500/20 text-emerald-400">
                    <Target className="w-4 h-4 text-emerald-400 animate-pulse" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">
                      Locked Assessment Verdict
                    </div>
                    <div className="text-[9px] text-slate-400 font-mono">
                      First-Principles Chain-of-Thought
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-semibold border border-emerald-500/30 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>SOLVED FIRST</span>
                  </span>
                  <button
                    onClick={() => handleCopyFull(mcqSolution)}
                    className="p-1 bg-white/10 hover:bg-white/20 text-slate-300 rounded transition-colors"
                    title="Copy full solution"
                  >
                    {copiedFull ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
                  </button>
                </div>
              </div>

              <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-lg p-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[9px] text-emerald-400 font-semibold uppercase tracking-wider">
                    🎯 Primary Pick to Click
                  </div>
                  <div className="text-base font-extrabold text-white tracking-wide font-mono truncate text-emerald-200 mt-0.5">
                    {parsedMcqVerdict.primaryPick || parsedMcqVerdict.correctOption}
                  </div>
                </div>
                <button
                  onClick={() => handleCopyPick(parsedMcqVerdict.primaryPick || parsedMcqVerdict.correctOption || '')}
                  className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-[10px] font-mono font-semibold shrink-0 transition-colors shadow-sm shadow-emerald-600/30 flex items-center gap-1"
                >
                  {copiedPick ? <Check className="w-3 h-3 text-white" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedPick ? 'Copied' : 'Copy Pick'}</span>
                </button>
              </div>

              <div className="mt-2 space-y-1.5 text-[11px] font-mono">
                {parsedMcqVerdict.correctOption && parsedMcqVerdict.correctOption !== parsedMcqVerdict.primaryPick && (
                  <div className="flex items-start gap-1.5 text-slate-300">
                    <span className="text-emerald-400 font-semibold shrink-0">✅ Option:</span>
                    <span className="truncate text-slate-200">{parsedMcqVerdict.correctOption}</span>
                  </div>
                )}
                {parsedMcqVerdict.trapPick && !parsedMcqVerdict.trapPick.toLowerCase().includes('none') && (
                  <div className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-200 text-[10px] leading-tight">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-amber-300">⚠️ Trap / Second Pick Alert: </span>
                      <span>{parsedMcqVerdict.trapPick}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {isMcqLoading && !parsedMcqVerdict.hasVerdict && (
            <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-xl p-2.5 flex items-center gap-2.5 text-indigo-300 text-[11px] font-mono">
              <Sparkles className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
              <div>
                <div className="font-semibold text-indigo-200">
                  {mcqSolution ? 'Deriving First-Principles Solution...' : 'Capturing High-DPI screen & solving...'}
                </div>
                <div className="text-[10px] text-slate-400">
                  Auditing options A, B, C, D — locked verdict will pin here
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* CATEGORY 2: CODING & LEETCODE MODE (MULTI-SCREEN & DEBUGGER) */}
      {/* ------------------------------------------------------------- */}
      {solverCategory === 'coding' && (
        <div className="flex flex-col space-y-2 shrink-0">
          {/* Controls Strip: Language Selector + Multi-Screenshot Actions */}
          <div className="flex items-center justify-between gap-1.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                <FileCode className="w-3.5 h-3.5 text-emerald-400" />
                <span>Lang:</span>
              </label>
              <select
                value={codingLanguage}
                onChange={(e) => setCodingLanguage(e.target.value)}
                className="bg-black/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang} className="bg-slate-900 text-white">
                    {lang}
                  </option>
                ))}
              </select>

              <button
                onClick={() => handleAddCodingScreenshot()}
                className="px-2 py-1 bg-white/10 hover:bg-white/15 text-slate-200 rounded-lg text-xs font-mono flex items-center gap-1 transition-colors"
                title="Add an additional screenshot (e.g. constraints, test cases, or editor)"
              >
                <Plus className="w-3 h-3 text-emerald-400" />
                <span>+ Screen</span>
              </button>

              {codingImages.length > 0 && (
                <button
                  onClick={handleClearCodingSession}
                  className="px-2 py-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 rounded-lg text-xs font-mono flex items-center gap-0.5 transition-colors"
                  title="Clear all screenshots and reset session"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              )}
            </div>

            <button
              onClick={() => captureAndSolveCoding()}
              disabled={isCodingLoading}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm shadow-emerald-500/30"
              title="Capture & Solve in selected language (Cmd+Shift+S)"
            >
              {isCodingLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-300" />}
              <span>{codingImages.length > 0 ? 'Solve Code' : 'Capture & Solve'}</span>
            </button>
          </div>

          {/* Multi-Screenshot Thumbnail Ribbon */}
          {codingImages.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-1.5 bg-black/40 rounded-lg border border-white/10">
              <span className="text-[9px] font-mono text-slate-400 shrink-0">
                Screens ({codingImages.length}):
              </span>
              {codingImages.map((img, idx) => (
                <div
                  key={img.id}
                  className="flex items-center gap-1 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 shrink-0 text-[10px] font-mono text-slate-300"
                >
                  <ImageIcon className="w-2.5 h-2.5 text-emerald-400" />
                  <span className="max-w-[110px] truncate">{img.label}</span>
                  <button
                    onClick={() => handleRemoveCodingImage(img.id)}
                    className="text-slate-500 hover:text-rose-400 ml-0.5"
                    title="Remove this screenshot"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Quick Debug Action Chips */}
          <div className="flex items-center gap-1 overflow-x-auto py-0.5 font-mono text-[9px]">
            <button
              onClick={handleCaptureErrorScreenAndFix}
              disabled={isCodingLoading}
              className="px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 shrink-0 flex items-center gap-1 transition-colors"
            >
              <Bug className="w-2.5 h-2.5 text-rose-400" />
              <span>Capture Error Screen &amp; Fix</span>
            </button>
            <button
              onClick={() => handleQuickErrorAction('Time Limit Exceeded (TLE) on large inputs. Optimize algorithm to lower Big-O time complexity.')}
              disabled={isCodingLoading}
              className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 shrink-0 flex items-center gap-1 transition-colors"
            >
              <Clock className="w-2.5 h-2.5 text-amber-400" />
              <span>Fix TLE</span>
            </button>
            <button
              onClick={() => handleQuickErrorAction('Output was Wrong Answer for edge case (e.g. empty array, duplicates, or negative values). Check edge conditions.')}
              disabled={isCodingLoading}
              className="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 shrink-0 flex items-center gap-1 transition-colors"
            >
              <AlertTriangle className="w-2.5 h-2.5 text-indigo-400" />
              <span>Fix Wrong Answer</span>
            </button>
            <button
              onClick={() => handleQuickErrorAction('Refactor this code to O(1) auxiliary space / in-place modification while preserving time complexity.')}
              disabled={isCodingLoading}
              className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 shrink-0 flex items-center gap-1 transition-colors"
            >
              <Layers className="w-2.5 h-2.5 text-emerald-400" />
              <span>O(1) Space</span>
            </button>
          </div>

          {/* Interactive Error / Trace Input Box */}
          <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-lg border border-white/10">
            <Terminal className="w-3 h-3 text-slate-500 shrink-0 ml-1" />
            <input
              type="text"
              value={errorInput}
              onChange={(e) => setErrorInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  captureAndSolveCoding();
                }
              }}
              placeholder="Paste failed test case or error trace (e.g. Expected [1,2], Got [2,1])..."
              className="flex-1 bg-transparent text-[11px] text-slate-200 placeholder-slate-600 font-mono focus:outline-none select-text"
            />
            {errorInput && (
              <button
                onClick={() => setErrorInput('')}
                className="text-slate-500 hover:text-slate-300 text-xs px-1"
              >
                ✕
              </button>
            )}
            <button
              onClick={() => captureAndSolveCoding()}
              disabled={isCodingLoading || !errorInput.trim()}
              className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded text-[10px] font-mono flex items-center gap-0.5 transition-colors shrink-0"
              title="Debug and fix code"
            >
              <Send className="w-2.5 h-2.5" />
              <span>Fix</span>
            </button>
          </div>

          {/* Top-Pinned Coding Verdict Card */}
          {parsedCodingVerdict.hasVerdict && (
            <div className="bg-gradient-to-r from-emerald-950/70 via-slate-900/90 to-emerald-950/70 border-2 border-emerald-500/60 rounded-xl p-2.5 shadow-xl shadow-emerald-950/50 backdrop-blur-md relative overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="p-1 rounded bg-emerald-500/20 text-emerald-400">
                    <Code2 className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">
                      Optimal Code Verdict ({codingLanguage})
                    </div>
                    <div className="text-[9px] text-slate-400 font-mono truncate max-w-[260px]">
                      {parsedCodingVerdict.approach || 'Competitive-Grade Solution'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {parsedCodingVerdict.codeBlock && (
                    <button
                      onClick={() => handleCopyCodeSnippet(parsedCodingVerdict.codeBlock || '')}
                      className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-mono font-semibold flex items-center gap-1 transition-colors shadow-sm shadow-emerald-600/30"
                      title="Copy complete solution code to clipboard"
                    >
                      {copiedCode ? <Check className="w-3 h-3 text-white" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleCopyFull(codingSolution)}
                    className="p-1 bg-white/10 hover:bg-white/20 text-slate-300 rounded transition-colors"
                    title="Copy full explanation"
                  >
                    {copiedFull ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
                  </button>
                </div>
              </div>

              {/* Complexity Metrics Strip */}
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="bg-black/40 p-1.5 rounded border border-white/10">
                  <span className="text-slate-400 font-semibold">⏱️ Time: </span>
                  <span className="text-emerald-300 font-bold truncate">
                    {parsedCodingVerdict.timeComplexity || 'O(N)'}
                  </span>
                </div>
                <div className="bg-black/40 p-1.5 rounded border border-white/10">
                  <span className="text-slate-400 font-semibold">💾 Space: </span>
                  <span className="text-cyan-300 font-bold truncate">
                    {parsedCodingVerdict.spaceComplexity || 'O(1)'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {isCodingLoading && !parsedCodingVerdict.hasVerdict && (
            <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-2.5 flex items-center gap-2.5 text-emerald-300 text-[11px] font-mono">
              <Sparkles className="w-4 h-4 text-emerald-400 animate-spin shrink-0" />
              <div>
                <div className="font-semibold text-emerald-200">
                  {codingSolution ? 'Formulating Optimal Code Solution...' : 'Synthesizing multi-screenshots & reasoning...'}
                </div>
                <div className="text-[10px] text-slate-400">
                  Solving in {codingLanguage} with optimal Big-O complexity
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-2 bg-rose-500/15 border border-rose-500/25 text-rose-300 rounded-lg text-xs leading-snug shrink-0">
          {error}
        </div>
      )}

      {/* Solution Display Container with Hands-Free Stealth Scrolling */}
      <div
        ref={solutionContainerRef}
        className="flex-1 overflow-y-auto bg-black/35 rounded-lg p-3 border border-white/10 font-mono text-xs text-slate-200 leading-relaxed min-h-[160px] relative select-text"
      >
        {/* Loading state when no text yet */}
        {((solverCategory === 'mcq' && isMcqLoading && !mcqSolution) ||
          (solverCategory === 'coding' && isCodingLoading && !codingSolution)) && (
          <div className="flex flex-col items-center justify-center h-full py-12 space-y-2 text-indigo-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span className="text-xs font-semibold">
              {solverCategory === 'mcq' ? 'Capturing High-DPI screen & solving...' : 'Analyzing screenshots & generating optimal code...'}
            </span>
            <span className="text-[10px] text-slate-500">Universal Multimodal Reasoning via Gemini</span>
          </div>
        )}

        {/* Content Display: MCQ Mode */}
        {solverCategory === 'mcq' && mcqSolution && (
          <div>
            <div className="whitespace-pre-wrap">
              {parsedMcqVerdict.hasVerdict ? (parsedMcqVerdict.bodyText || mcqSolution) : mcqSolution}
            </div>
            {!parsedMcqVerdict.hasVerdict && (
              <button
                onClick={() => handleCopyFull(mcqSolution)}
                className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 text-slate-300 rounded-md transition-colors"
                title="Copy solution"
              >
                {copiedFull ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              </button>
            )}
          </div>
        )}

        {/* Content Display: Coding Mode */}
        {solverCategory === 'coding' && codingSolution && (
          <div>
            <div className="whitespace-pre-wrap">
              {parsedCodingVerdict.hasVerdict ? (parsedCodingVerdict.bodyText || codingSolution) : codingSolution}
            </div>
            {!parsedCodingVerdict.hasVerdict && (
              <button
                onClick={() => handleCopyFull(codingSolution)}
                className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 text-slate-300 rounded-md transition-colors"
                title="Copy solution"
              >
                {copiedFull ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              </button>
            )}
          </div>
        )}

        {/* Empty state */}
        {!isMcqLoading && !isCodingLoading && !mcqSolution && !codingSolution && (
          <div className="text-slate-500 text-center py-12 text-xs flex flex-col items-center gap-2">
            <Camera className="w-6 h-6 text-slate-600" />
            <span>
              Click &ldquo;Capture &amp; Solve&rdquo; or press <strong>Cmd+Shift+S</strong>
            </span>
            <span className="text-[10px] text-slate-600 max-w-[340px]">
              {solverCategory === 'mcq'
                ? 'MCQ Mode audits options A, B, C, D with first-principles proof without focus loss.'
                : 'Coding Mode supports multi-screenshots, custom languages, and stateful debugging memory.'}
            </span>
          </div>
        )}
      </div>

      {/* Stealth Navigation Footer */}
      <div className="flex items-center justify-between text-[10px] text-slate-500 px-1 font-mono shrink-0">
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 rounded bg-white/10 text-slate-300">Cmd+Down</kbd>
          <kbd className="px-1 py-0.5 rounded bg-white/10 text-slate-300">Cmd+Up</kbd>
          <span>Hands-free scroll</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 rounded bg-white/10 text-slate-300">Cmd+B</kbd>
          <span>Toggle HUD</span>
        </span>
      </div>
    </div>
  );
};
