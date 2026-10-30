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
} from 'lucide-react';
import { solveScreenProblem } from '../services/geminiLive';
import { getStoredResume } from '../services/resumeEngine';

export type SolverMode = 'universal' | 'leetcode' | 'debug' | 'system';

export interface ParsedVerdict {
  hasVerdict: boolean;
  correctOption?: string;
  primaryPick?: string;
  trapPick?: string;
  rawBlock?: string;
  bodyText: string;
}

/**
 * Extracts the locked verdict tags (<VERIFIED_VERDICT>) from the model output.
 * Pins the final verdict at the top of the HUD while separating the step-by-step derivation below.
 */
function parseVerdict(text: string): ParsedVerdict {
  if (!text) {
    return { hasVerdict: false, bodyText: '' };
  }

  // Look for <VERIFIED_VERDICT> ... </VERIFIED_VERDICT> or unclosed tag during streaming
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

  // Fallback if specific tags weren't isolated but text is in the block
  if (!primaryPick && correctOption) {
    primaryPick = correctOption;
  }

  // Cleanly remove the <VERIFIED_VERDICT> block and optional Step 4 header from derivation display
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

export const ScreenSolver: React.FC = () => {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [solution, setSolution] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<SolverMode>('universal');
  const [error, setError] = useState<string | null>(null);
  const [copiedFull, setCopiedFull] = useState(false);
  const [copiedPick, setCopiedPick] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const solutionContainerRef = useRef<HTMLDivElement>(null);

  // Parse the top-pinned verdict block from the streamed or finalized solution
  const parsedVerdict = useMemo(() => parseVerdict(solution), [solution]);

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

  const captureAndSolve = async (selectedMode = mode) => {
    setError(null);
    setIsLoading(true);
    setSolution('');
    const startTime = performance.now();

    try {
      let image = screenshot;
      if (typeof window.electronAPI?.captureScreen === 'function') {
        image = await window.electronAPI.captureScreen();
        setScreenshot(image);
      }

      if (!image) {
        throw new Error('Could not capture screen. Make sure screen recording permissions are granted in System Settings.');
      }

      let prompt = '';
      if (selectedMode === 'universal') {
        prompt = `You are an elite, zero-error Quantitative Aptitude, Logical Reasoning, Verbal, and Technical Assessment Solver.
Carefully read the screenshot. Extract the exact question text, every number, every constraint, and all options (A, B, C, D).

ABSOLUTE RULE — DO NOT VIOLATE:
NEVER state or guess the winning option at the beginning of your response! You MUST write out the complete algebraic equations, step-by-step arithmetic, or logical lineage tree FIRST before deciding which option is correct.

PERFORM THESE 4 STEPS IN EXACT ORDER:

### STEP 1: EXACT QUESTION & OPTIONS EXTRACTION
- State the exact question text and list options A, B, C, D verbatim from the image.

### STEP 2: FIRST-PRINCIPLES MATHEMATICAL / LOGICAL SOLVE
- **For Math / Quantitative Aptitude:** Define variables (e.g., Let x = ...), write out the exact algebraic equations, and compute the arithmetic step by step. Show every intermediate number clearly.
- **For Blood Relations / Kinship / Logical Puzzles:** Break the sentence down clause by clause from the speaker ("my...") outward:
  1. Identify every intermediate person in the chain.
  2. Check both the **Strict Literal Kinship** (e.g., "paternal grandfather" = father's father -> brother's son = Nephew) AND the **Common Aptitude Test-Key Shortcut** (many quizzes loosely write "paternal grandfather" when they simply mean "direct grandfather through the woman's father" -> Son).
- **For Series / Coding / Technical MCQs:** Trace the exact pattern differences, dry-run the code line-by-line, or verify the protocol specification.

### STEP 3: PLUG-IN AUDIT OF ALL OPTIONS (A, B, C, D)
- Test Option A against the question conditions: [Pass / Fail + exact numeric or logical reason]
- Test Option B against the question conditions: [Pass / Fail + exact numeric or logical reason]
- Test Option C against the question conditions: [Pass / Fail + exact numeric or logical reason]
- Test Option D against the question conditions: [Pass / Fail + exact numeric or logical reason]
- **Ambiguity / Flawed Quiz Check:** If a quiz question has a known wording flaw (like Maternal vs Paternal grandfather in AI quizzes, or a scaled number typo), explicitly identify BOTH the **Strict Answer** and the **Quiz-Key Expected Option**!

### STEP 4: FINAL LOCKED VERDICT (MUST USE EXACT TAGS BELOW)
<VERIFIED_VERDICT>
✅ CORRECT OPTION: [Option Letter + Full Option Text, e.g., "C. Son (Direct Lineage Key) / D. Nephew (Strict Literal)"]
🎯 PRIMARY PICK TO CLICK: [Single Best Option Letter + Value that the test grader expects]
⚠️ TRAP / SECOND PICK (IF QUIZ KEY IS FLAWED): [Only include if the question has a math/wording flaw, otherwise write "None — 100% Unambiguous"]
</VERIFIED_VERDICT>`;
      } else if (selectedMode === 'leetcode') {
        prompt = `Analyze this coding problem on screen. Follow Solve-First Chain-of-Thought:
1. Identify the problem statement, edge cases, and constraints.
2. Formulate the optimal algorithm approach, Time Complexity, and Space Complexity.
3. Dry-run the solution on example inputs.
4. Output the locked verdict:
<VERIFIED_VERDICT>
✅ CORRECT OPTION: [Optimal Approach & Time/Space Complexity]
🎯 PRIMARY PICK TO CLICK: [Core Algorithm Approach / Data Structure]
⚠️ TRAP / SECOND PICK (IF QUIZ KEY IS FLAWED): [Common Edge Case or Trap, or "None"]
</VERIFIED_VERDICT>
5. Output the complete, working, bug-free solution code with syntax highlighting in the language shown on the screen.`;
      } else if (selectedMode === 'debug') {
        prompt = `Analyze the code and error on screen. Follow Solve-First Chain-of-Thought:
1. Trace the execution flow and isolate the exact root cause of the error.
2. Formulate the fix and verify against side effects.
3. Output the locked verdict:
<VERIFIED_VERDICT>
✅ CORRECT OPTION: [1-sentence Root Cause Fix]
🎯 PRIMARY PICK TO CLICK: [Exact Line / Keyword to Modify]
⚠️ TRAP / SECOND PICK (IF QUIZ KEY IS FLAWED): [Potential Pitfall, or "None"]
</VERIFIED_VERDICT>
4. Provide the exact corrected code snippet and explanation.`;
      } else {
        prompt = `Analyze the diagram or architecture on screen. Follow Solve-First Chain-of-Thought:
1. Break down components, data flows, and bottlenecks.
2. Evaluate trade-offs and scaling strategies.
3. Output the locked verdict:
<VERIFIED_VERDICT>
✅ CORRECT OPTION: [Primary Architectural Pattern / Recommendation]
🎯 PRIMARY PICK TO CLICK: [Core Component / Scaling Action]
⚠️ TRAP / SECOND PICK (IF QUIZ KEY IS FLAWED): [Bottleneck / Single Point of Failure, or "None"]
</VERIFIED_VERDICT>
4. Detailed breakdown and trade-off analysis.`;
      }

      const resumeContext = getStoredResume();
      const result = await solveScreenProblem({
        base64Image: image,
        prompt,
        resumeContext,
        onChunk: (chunk) => setSolution(chunk),
        thinkingBudget: 4096,
        temperature: 0.0,
      });

      setSolution(result);
      setElapsedMs(Math.round(performance.now() - startTime));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window.electronAPI?.onTriggerScreenSolve === 'function') {
      window.electronAPI.onTriggerScreenSolve(() => {
        captureAndSolve();
      });
    }
  }, [mode]);

  const handleCopyFull = () => {
    if (!solution) return;
    navigator.clipboard.writeText(solution);
    setCopiedFull(true);
    setTimeout(() => setCopiedFull(false), 2000);
  };

  const handleCopyPick = (pickText: string) => {
    if (!pickText) return;
    navigator.clipboard.writeText(pickText);
    setCopiedPick(true);
    setTimeout(() => setCopiedPick(false), 2000);
  };

  return (
    <div className="flex flex-col h-full space-y-2.5">
      {/* Action Header & Mode Selectors */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap">
        <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-lg border border-white/10">
          <button
            onClick={() => setMode('universal')}
            className={`px-2 py-1 text-[11px] rounded-md transition-colors flex items-center gap-1 ${
              mode === 'universal' ? 'bg-indigo-600 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3 h-3 text-amber-300" />
            <span>Universal Auto</span>
          </button>
          <button
            onClick={() => setMode('leetcode')}
            className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
              mode === 'leetcode' ? 'bg-indigo-600 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            LeetCode / DSA
          </button>
          <button
            onClick={() => setMode('debug')}
            className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
              mode === 'debug' ? 'bg-indigo-600 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Bug Fix
          </button>
          <button
            onClick={() => setMode('system')}
            className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
              mode === 'system' ? 'bg-indigo-600 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Architecture
          </button>
        </div>

        <button
          onClick={() => captureAndSolve()}
          disabled={isLoading}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm shadow-emerald-500/30"
          title="Hotkey: Cmd+Shift+S (Non-Focusing Stealth Capture)"
        >
          {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
          <span>Capture &amp; Solve</span>
        </button>
      </div>

      {/* Screen Preview & Proctoring Stealth Status */}
      <div className="flex items-center justify-between p-1.5 bg-black/40 rounded-lg border border-white/10 text-[11px] text-slate-300">
        <div className="flex items-center gap-1.5 truncate">
          <ImageIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="font-mono text-[10px] text-slate-400">
            {screenshot ? '2560x1440 High-DPI' : 'Ready (Cmd+Shift+S)'}
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
          {elapsedMs !== null && (
            <span className="text-[10px] text-indigo-300 font-mono">
              {(elapsedMs / 1000).toFixed(2)}s
            </span>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-2 bg-rose-500/15 border border-rose-500/25 text-rose-300 rounded-lg text-xs leading-snug">
          {error}
        </div>
      )}

      {/* TOP-PINNED LOCKED VERDICT CARD (Extracted from <VERIFIED_VERDICT>) */}
      {parsedVerdict.hasVerdict && (
        <div className="bg-gradient-to-r from-emerald-950/70 via-slate-900/90 to-emerald-950/70 border-2 border-emerald-500/60 rounded-xl p-3 shadow-xl shadow-emerald-950/50 backdrop-blur-md relative overflow-hidden">
          {/* Header Row */}
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
                onClick={handleCopyFull}
                className="p-1 bg-white/10 hover:bg-white/20 text-slate-300 rounded transition-colors"
                title="Copy full solution"
              >
                {copiedFull ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
              </button>
            </div>
          </div>

          {/* Primary Pick Banner — Scannable in 0.5s */}
          <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-lg p-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[9px] text-emerald-400 font-semibold uppercase tracking-wider">
                🎯 Primary Pick to Click
              </div>
              <div className="text-base font-extrabold text-white tracking-wide font-mono truncate text-emerald-200 mt-0.5">
                {parsedVerdict.primaryPick || parsedVerdict.correctOption}
              </div>
            </div>
            <button
              onClick={() => handleCopyPick(parsedVerdict.primaryPick || parsedVerdict.correctOption || '')}
              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-[10px] font-mono font-semibold shrink-0 transition-colors shadow-sm shadow-emerald-600/30 flex items-center gap-1"
            >
              {copiedPick ? <Check className="w-3 h-3 text-white" /> : <Copy className="w-3 h-3" />}
              <span>{copiedPick ? 'Copied' : 'Copy Pick'}</span>
            </button>
          </div>

          {/* Secondary Details: Correct Option & Flawed Quiz Trap Alert */}
          <div className="mt-2 space-y-1.5 text-[11px] font-mono">
            {parsedVerdict.correctOption && parsedVerdict.correctOption !== parsedVerdict.primaryPick && (
              <div className="flex items-start gap-1.5 text-slate-300">
                <span className="text-emerald-400 font-semibold shrink-0">✅ Option:</span>
                <span className="truncate text-slate-200">{parsedVerdict.correctOption}</span>
              </div>
            )}
            {parsedVerdict.trapPick && !parsedVerdict.trapPick.toLowerCase().includes('none') && (
              <div className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-200 text-[10px] leading-tight">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-amber-300">⚠️ Trap / Second Pick Alert: </span>
                  <span>{parsedVerdict.trapPick}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Real-time Solving Progress Banner (While Steps 1-3 are actively streaming before verdict) */}
      {isLoading && !parsedVerdict.hasVerdict && (
        <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-xl p-2.5 flex items-center gap-2.5 text-indigo-300 text-[11px] font-mono">
          <Sparkles className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
          <div>
            <div className="font-semibold text-indigo-200">
              {solution ? 'Deriving First-Principles Solution...' : 'Capturing High-DPI screen & solving...'}
            </div>
            <div className="text-[10px] text-slate-400">
              Auditing options A, B, C, D — locked verdict will pin here
            </div>
          </div>
        </div>
      )}

      {/* Solution Display Container with Hands-Free Stealth Scrolling */}
      <div
        ref={solutionContainerRef}
        className="flex-1 overflow-y-auto bg-black/35 rounded-lg p-3 border border-white/10 font-mono text-xs text-slate-200 leading-relaxed min-h-[180px] max-h-[380px] relative select-text"
      >
        {isLoading && !solution && (
          <div className="flex flex-col items-center justify-center h-full py-12 space-y-2 text-indigo-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span className="text-xs font-semibold">Capturing 2560x1440 screen &amp; solving...</span>
            <span className="text-[10px] text-slate-500">Universal Multimodal Reasoning via Gemini</span>
          </div>
        )}

        {solution && (
          <div>
            <div className="whitespace-pre-wrap">
              {parsedVerdict.hasVerdict ? (parsedVerdict.bodyText || solution) : solution}
            </div>
            {!parsedVerdict.hasVerdict && (
              <button
                onClick={handleCopyFull}
                className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 text-slate-300 rounded-md transition-colors"
                title="Copy solution"
              >
                {copiedFull ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        )}

        {!isLoading && !solution && (
          <div className="text-slate-500 text-center py-14 text-xs flex flex-col items-center gap-2">
            <Camera className="w-6 h-6 text-slate-600" />
            <span>Click &ldquo;Capture &amp; Solve&rdquo; or press <strong>Cmd+Shift+S</strong></span>
            <span className="text-[10px] text-slate-600 max-w-[340px]">
              Captures your assessment window silently with zero focus loss, never triggering exam blur monitors.
            </span>
          </div>
        )}
      </div>

      {/* Stealth Navigation Footer */}
      <div className="flex items-center justify-between text-[10px] text-slate-500 px-1 font-mono">
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