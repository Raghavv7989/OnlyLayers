import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  Camera,
  Mic,
  FileText,
  Radio,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  Send,
  AlertCircle,
  Award,
  RotateCcw,
  Shield,
  Unlock,
} from 'lucide-react';
import { TranscriptTicker } from './TranscriptTicker';
import { ScreenSolver } from './ScreenSolver';
import { AudioLoopback } from './AudioLoopback';
import { ResumeMatcher } from './ResumeMatcher';
import { MockDebrief } from './MockDebrief';
import {
  audioPipeline,
  TranscriptSegment,
  SpeakerType,
  VADStatus,
  VADDiagnostics,
} from '../services/audioPipeline';
import {
  streamQuickAnswer,
  solveAudioQuestion,
  PRIMARY_MODEL,
  ConversationTurn,
} from '../services/geminiLive';
import {
  hasGroqApiKey,
  streamGroqAnswer,
  streamParakeetAnswerFromText,
} from '../services/groqEngine';
import { getCachedInterviewContext } from '../services/resumeEngine';
import { semanticGuard, ConversationState, ListeningGuardMode } from '../services/semanticGuard';

export type WorkspaceTabType = 'copilot' | 'screen' | 'resume' | 'debrief' | 'audio';

interface WorkspaceTabsProps {
  initialTab?: WorkspaceTabType;
}

/**
 * TeleprompterAnswerView — Scannable Parakeet 2.0 Layout
 * - Highlights 🗣️ SAY THIS FIRST in a Cyan-bordered Teleprompter Card with high-contrast text
 * - Renders ⚡ CORE TECHNICAL BREAKDOWN with crisp bullets
 * - Renders 💻 CODE / COMPLEXITY in a dark monospace code box with 1-click Copy
 * - Renders 🎯 LIKELY FOLLOW-UP in an accented counter-answer container
 */
const TeleprompterAnswerView: React.FC<{ rawText: string }> = ({ rawText }) => {
  const [copiedCode, setCopiedCode] = useState(false);

  // Check if text contains Parakeet 2.0 section markers
  const hasSayFirst = /🗣️\s*SAY THIS FIRST/i.test(rawText);
  const hasCoreBreakdown = /⚡\s*CORE TECHNICAL/i.test(rawText);

  if (!hasSayFirst && !hasCoreBreakdown) {
    return (
      <div className="whitespace-pre-wrap font-sans text-xs text-slate-100 leading-relaxed">
        {rawText}
      </div>
    );
  }

  // Parse sections
  const sayMatch = rawText.match(/🗣️\s*SAY THIS FIRST[^\n]*\n([\s\S]*?)(?=(?:⚡\s*CORE TECHNICAL|💻\s*CODE|🎯\s*LIKELY|$))/i);
  const coreMatch = rawText.match(/⚡\s*CORE TECHNICAL BREAKDOWN[^\n]*\n([\s\S]*?)(?=(?:💻\s*CODE|🎯\s*LIKELY|$))/i);
  const codeMatch = rawText.match(/💻\s*CODE\s*\/\s*COMPLEXITY[^\n]*\n([\s\S]*?)(?=(?:🎯\s*LIKELY|$))/i);
  const followMatch = rawText.match(/🎯\s*LIKELY FOLLOW-UP[^\n]*\n([\s\S]*)$/i);

  const sayFirst = sayMatch ? sayMatch[1].trim() : '';
  const coreBreakdown = coreMatch ? coreMatch[1].trim() : '';
  const codeSection = codeMatch ? codeMatch[1].trim() : '';
  const followUp = followMatch ? followMatch[1].trim() : '';

  let codeSnippet = '';
  let complexityLine = '';
  if (codeSection) {
    const codeBlockMatch = codeSection.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      codeSnippet = codeBlockMatch[1].trim();
      complexityLine = codeSection.replace(/```[a-zA-Z]*\n[\s\S]*?```/, '').trim();
    } else {
      codeSnippet = codeSection;
    }
  }

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="space-y-3 font-sans pb-2">
      {/* 🗣️ SAY THIS FIRST — Highlighted Teleprompter Card */}
      {sayFirst && (
        <div className="p-3.5 rounded-xl border-2 border-cyan-400/60 bg-gradient-to-br from-cyan-950/70 via-slate-900/90 to-black/70 shadow-lg shadow-cyan-950/50">
          <div className="flex items-center justify-between text-[11px] font-mono font-bold uppercase text-cyan-300 mb-2 tracking-wider">
            <span className="flex items-center gap-1.5">
              <span className="text-sm">🗣️</span>
              <span>Say This First (Verbatim Spoken Hook)</span>
            </span>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-cyan-500/25 text-cyan-200 border border-cyan-400/40 font-mono font-semibold">
              Read Aloud Directly
            </span>
          </div>
          <p className="text-sm font-semibold text-white leading-relaxed select-text font-sans pl-0.5">
            {sayFirst.replace(/^"|"$/g, '')}
          </p>
        </div>
      )}

      {/* ⚡ CORE TECHNICAL BREAKDOWN & TALKING POINTS */}
      {coreBreakdown && (
        <div className="p-3 rounded-xl border border-white/10 bg-black/45 space-y-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
            <span>⚡</span>
            <span>Core Technical Breakdown & Talking Points</span>
          </div>
          <div className="text-xs text-slate-200 leading-relaxed space-y-1.5 whitespace-pre-wrap font-sans">
            {coreBreakdown}
          </div>
        </div>
      )}

      {/* 💻 CODE / COMPLEXITY / ARCHITECTURE SNIPPET */}
      {codeSnippet && (
        <div className="rounded-xl border border-white/15 bg-slate-950/95 overflow-hidden shadow-inner">
          <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.04] border-b border-white/10 text-[10px] font-mono text-slate-400">
            <span className="flex items-center gap-1 text-slate-300 font-semibold">
              <span>💻</span>
              <span>Code / Architecture Snippet</span>
            </span>
            <button
              onClick={() => handleCopyCode(codeSnippet)}
              className="hover:text-white px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-[10px] transition-colors flex items-center gap-1"
            >
              {copiedCode ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
              <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
            </button>
          </div>
          <pre className="p-3 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed select-text">
            <code>{codeSnippet}</code>
          </pre>
          {complexityLine && (
            <div className="px-3 py-1.5 bg-black/50 border-t border-white/5 text-[10px] font-mono text-amber-300/90">
              {complexityLine}
            </div>
          )}
        </div>
      )}

      {/* 🎯 LIKELY FOLLOW-UP & 1-LINE COUNTER */}
      {followUp && (
        <div className="p-2.5 rounded-xl border border-indigo-500/30 bg-indigo-950/20 text-xs space-y-1">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
            <span>🎯</span>
            <span>Likely Follow-Up & 1-Line Counter</span>
          </div>
          <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
            {followUp}
          </div>
        </div>
      )}
    </div>
  );
};

export const WorkspaceTabs: React.FC<WorkspaceTabsProps> = ({ initialTab = 'copilot' }) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTabType>(initialTab);

  // Audio Pipeline State
  const [isListening, setIsListening] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<SpeakerType | null>(null);
  const [speakerMode, setSpeakerMode] = useState<SpeakerType | 'auto'>('auto');
  const [vadStatus, setVadStatus] = useState<VADStatus>('idle');
  const [vadStatusText, setVadStatusText] = useState<string>('Listening paused');
  const [vadDiagnostics, setVadDiagnostics] = useState<VADDiagnostics | null>(null);
  const [volumeLevels, setVolumeLevels] = useState<{ interviewer: number; mic: number; waveform: number[] }>({
    interviewer: 0,
    mic: 0,
    waveform: [0, 0, 0, 0, 0, 0, 0, 0],
  });
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Multi-Turn Conversation Memory
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);

  // AI Copilot Output State
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationTimeMs, setGenerationTimeMs] = useState<number | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [autoTriggerOnSilence, setAutoTriggerOnSilence] = useState(true);
  const [conversationState, setConversationState] = useState<ConversationState>(semanticGuard.getState());
  const [guardMode, setGuardMode] = useState<ListeningGuardMode>(semanticGuard.getListeningMode());

  // Timing & debouncing tracking
  const startTimeRef = useRef<number>(0);
  const copilotScrollRef = useRef<HTMLDivElement>(null);
  const autoTriggerTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);

  // Subscribe to 4-Layer Semantic Guard Conversation State Machine & Guard Mode
  useEffect(() => {
    const unsubscribeState = semanticGuard.subscribe((newState) => {
      setConversationState(newState);
    });
    const unsubscribeMode = semanticGuard.subscribeMode((newMode) => {
      setGuardMode(newMode);
    });
    return () => {
      unsubscribeState();
      unsubscribeMode();
    };
  }, []);

  const handleGuardModeChange = (mode: ListeningGuardMode) => {
    setGuardMode(mode);
    semanticGuard.setListeningMode(mode);
    audioPipeline.setListeningGuardMode(mode);
  };

  // Ensure window is focusable when visiting Context / Resume tab
  useEffect(() => {
    if (activeTab === 'resume') {
      window.electronAPI?.setFocusable?.(true);
    }
  }, [activeTab]);

  // Auto-clear dangling interim text after 1.5s so it never gets stuck in "Listening..."
  useEffect(() => {
    if (!interimText) return;
    const timer = setTimeout(() => {
      setInterimText('');
    }, 1500);
    return () => clearTimeout(timer);
  }, [interimText]);

  // Lightning-fast 500ms Auto-Trigger on Silence / Pause for Question Input
  useEffect(() => {
    if (autoTriggerTimerRef.current) {
      clearTimeout(autoTriggerTimerRef.current);
      autoTriggerTimerRef.current = null;
    }

    if (!autoTriggerOnSilence) return;
    if (isGenerating || vadStatus === 'cooldown' || vadStatus === 'processing') return;
    if (!manualInput || manualInput.trim().length < 4) return;

    autoTriggerTimerRef.current = setTimeout(() => {
      if (manualInput.trim().length >= 4 && !isGenerating) {
        const textToTrigger = manualInput.trim();
        setManualInput('');
        triggerInterviewerQuestion(textToTrigger);
      }
    }, 500);

    return () => {
      if (autoTriggerTimerRef.current) {
        clearTimeout(autoTriggerTimerRef.current);
      }
    };
  }, [manualInput, autoTriggerOnSilence, isGenerating, vadStatus]);

  // Bind screen solver trigger to auto-switch tab
  useEffect(() => {
    if (typeof window.electronAPI?.onTriggerScreenSolve === 'function') {
      window.electronAPI.onTriggerScreenSolve(() => {
        setActiveTab('screen');
      });
    }

    if (typeof window.electronAPI?.onScrollHud === 'function') {
      window.electronAPI.onScrollHud((direction) => {
        if (copilotScrollRef.current) {
          const delta = direction === 'down' ? 140 : -140;
          copilotScrollRef.current.scrollBy({ top: delta, behavior: 'smooth' });
        }
      });
    }
  }, []);

  // Bind global shortcuts from Electron (Cmd+Enter to force trigger)
  useEffect(() => {
    if (typeof window.electronAPI?.onTriggerAudioAnswer === 'function') {
      window.electronAPI.onTriggerAudioAnswer(() => {
        handleManualForceTrigger();
      });
    }

    // Keyboard event listener for Cmd/Ctrl + Enter in renderer, Escape / Cmd+R, and Space for Next Question
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleManualForceTrigger();
      } else if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        semanticGuard.unlockAwaitingQuestion();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        window.electronAPI?.toggleHud?.();
      } else if (
        e.code === 'Space' &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        if (conversationState === 'CANDIDATE_ANSWERING') {
          e.preventDefault();
          semanticGuard.unlockAwaitingQuestion();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [manualInput, isListening, conversationHistory]);

  // Toggle Continuous Dual-Audio Listening (Stage 1 ASR)
  const handleToggleListening = async () => {
    if (isListening) {
      audioPipeline.stop();
      setIsListening(false);
      setActiveSpeaker(null);
      setInterimText('');
      setVadStatus('idle');
      setVadStatusText('Listening paused');
    } else {
      setPipelineError(null);
      try {
        await audioPipeline.start({
          onTranscriptChunk: (seg) => {
            if (seg.isFinal) {
              if (seg.text && seg.text.trim()) {
                setTranscriptSegments((prev) => {
                  const exists = prev.some((s) => s.id === seg.id);
                  if (exists) {
                    return prev.map((s) => (s.id === seg.id ? seg : s));
                  }
                  return [...prev, seg];
                });

                // If candidate [You] spoke, append to multi-turn conversation memory
                if (seg.speaker === 'You') {
                  setConversationHistory((prev) => [
                    ...prev,
                    { role: 'user', text: seg.text.trim() },
                  ]);
                }
              }
              setInterimText('');
            } else {
              setInterimText(seg.text);
            }
          },
          onAnswerChunk: (answerText, isDone, latencyMs) => {
            if (answerText) {
              setIsGenerating(true);
              setStreamingAnswer(answerText);
            }
            if (isDone) {
              setIsGenerating(false);
              if (latencyMs) {
                setGenerationTimeMs(latencyMs);
              }
            }
          },
          onVolumeChange: (levels) => {
            setVolumeLevels(levels);
          },
          onStatusChange: (status) => {
            setIsListening(status.isListening);
            setVadStatus(status.vadStatus);
            setVadStatusText(status.statusText);
            setActiveSpeaker(status.activeSpeaker);
          },
          onDiagnostics: (diag) => {
            setVadDiagnostics(diag);
          },
          onError: (err) => {
            setPipelineError(err);
          },
        });
        setIsListening(true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setPipelineError(msg);
        setIsListening(false);
      }
    }
  };

  const handleSpeakerModeChange = (mode: SpeakerType | 'auto') => {
    setSpeakerMode(mode);
    audioPipeline.setSpeakerOverride(mode);
  };

  // Instant Re-Answer Execution with Clean Abort Cancellation (Sub-Second Turnaround)
  const handleReAnswer = async (questionText: string) => {
    if (!questionText.trim()) return;
    const cleanQ = questionText.trim();

    // 1. Immediately abort any active stream in flight
    if (streamAbortControllerRef.current) {
      try {
        streamAbortControllerRef.current.abort();
      } catch {}
      streamAbortControllerRef.current = null;
    }

    // Also tell audioPipeline to cancel any ongoing generation
    audioPipeline.abortActiveGeneration();

    const abortController = new AbortController();
    streamAbortControllerRef.current = abortController;

    setIsGenerating(true);
    setStreamingAnswer('');
    startTimeRef.current = Date.now();
    setGenerationTimeMs(null);
    semanticGuard.setGeneratingAnswer();

    try {
      const resumeContext = getCachedInterviewContext();
      const groqHistory = conversationHistory.map((t) => ({
        role: (t.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: t.text,
      }));

      const completedAnswer = await streamParakeetAnswerFromText({
        question: cleanQ,
        resumeContext,
        conversationHistory: groqHistory,
        onChunk: (chunk) => {
          if (!abortController.signal.aborted) {
            setStreamingAnswer(chunk);
          }
        },
        signal: abortController.signal,
      });

      if (!abortController.signal.aborted) {
        setGenerationTimeMs(Date.now() - startTimeRef.current);
        if (completedAnswer.trim()) {
          semanticGuard.setCandidateAnswering(completedAnswer, cleanQ);
          setConversationHistory((prev) => [
            ...prev,
            { role: 'user', text: cleanQ },
            { role: 'model', text: completedAnswer },
          ]);
        }
      }
    } catch (err: unknown) {
      if (abortController.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setStreamingAnswer(`⚠️ Error formulating answer: ${msg}`);
    } finally {
      if (streamAbortControllerRef.current === abortController) {
        setIsGenerating(false);
        streamAbortControllerRef.current = null;
      }
    }
  };

  // Immediate Interviewer Question Trigger (for text input, paste, and hotkeys)
  const triggerInterviewerQuestion = async (questionText: string) => {
    if (!questionText.trim()) return;
    const cleanQ = questionText.trim();

    // 1. Add to rolling transcript feed as Interviewer (avoid duplicate if identical to latest)
    setTranscriptSegments((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.text.trim() === cleanQ && last.speaker === 'Interviewer') {
        return prev;
      }
      return [
        ...prev,
        {
          id: Math.random().toString(36).substring(2, 9),
          speaker: 'Interviewer',
          text: cleanQ,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          isFinal: true,
        },
      ];
    });

    setInterimText('');

    // 2. Trigger Instant Zero-Latency LLM Streaming
    await handleReAnswer(cleanQ);
  };

  // Instant Paste from Clipboard & Auto-Solve
  const handlePasteAndSolve = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText && clipText.trim()) {
        setManualInput('');
        await triggerInterviewerQuestion(clipText.trim());
      }
    } catch (err) {
      console.warn('Clipboard paste failed:', err);
    }
  };

  // Manual Force Trigger (Hotkey or Manual Click)
  const handleManualForceTrigger = async () => {
    if (manualInput.trim()) {
      const questionText = manualInput.trim();
      setManualInput('');
      await triggerInterviewerQuestion(questionText);
      return;
    }

    if (isListening) {
      await audioPipeline.forceTrigger();
    }
  };

  const handleCopyAnswer = () => {
    if (!streamingAnswer) return;
    navigator.clipboard.writeText(streamingAnswer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClearTranscript = () => {
    setTranscriptSegments([]);
    setInterimText('');
  };

  const handleResetConversationMemory = () => {
    setConversationHistory([]);
    setStreamingAnswer('');
    setGenerationTimeMs(null);
    semanticGuard.unlockAwaitingQuestion();
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden space-y-2">
      {/* Tab Navigation Header */}
      <div className="flex bg-black/40 p-1 rounded-xl border border-white/10 shrink-0">
        <button
          onClick={() => setActiveTab('copilot')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'copilot'
              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Zap className="w-3.5 h-3.5 text-indigo-300" />
          <span>Live Copilot</span>
          {isListening && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('screen')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'screen'
              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Camera className="w-3.5 h-3.5" />
          <span>Screen (3.1 Pro)</span>
        </button>

        <button
          onClick={() => setActiveTab('resume')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'resume'
              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Context</span>
        </button>

        <button
          onClick={() => setActiveTab('debrief')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'debrief'
              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          <span>Mock/Debrief</span>
        </button>

        <button
          onClick={() => setActiveTab('audio')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'audio'
              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Mic className="w-3.5 h-3.5" />
          <span>Audio</span>
        </button>
      </div>

      {/* Main Tab Panels */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'copilot' && (
            <motion.div
              key="copilot"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="h-full flex flex-col space-y-2 overflow-hidden"
            >
              {/* Continuous Dual-Audio Master Control Strip */}
              <div className="flex items-center justify-between p-2 bg-black/40 rounded-xl border border-white/10 shadow-sm shrink-0">
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={handleToggleListening}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
                      isListening
                        ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/40 animate-pulse'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30'
                    }`}
                  >
                    <Radio className={`w-3.5 h-3.5 ${isListening ? 'animate-spin' : ''}`} />
                    <span>{isListening ? 'Listening (Dual Audio Active)' : 'Start / Listen (Dual Audio)'}</span>
                  </button>

                  {/* Dual-Audio Volume Waveform Indicators */}
                  <div className="flex items-center gap-2.5 text-[10px] font-mono">
                    {/* Interviewer system loopback audio */}
                    <div className="flex items-center gap-1">
                      <span className="text-cyan-400 font-semibold">Sys</span>
                      <div className="flex items-center gap-0.5 h-3">
                        {[...Array(4)].map((_, i) => (
                          <div
                            key={i}
                            className="w-1 bg-cyan-400 rounded-full transition-all duration-75"
                            style={{
                              height: `${Math.max(3, (volumeLevels.interviewer / 100) * 12)}px`,
                              opacity: volumeLevels.interviewer > i * 22 ? 1 : 0.3,
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Microphone candidate audio with dynamic 8-bar waveform */}
                    <div className="flex items-center gap-1">
                      <span className="text-violet-400 font-semibold">Mic</span>
                      <div className="flex items-center gap-0.5 h-3">
                        {(volumeLevels.waveform && volumeLevels.waveform.length > 0
                          ? volumeLevels.waveform
                          : [...Array(8)].map(() => 0)
                        ).map((lvl, i) => (
                          <div
                            key={i}
                            className="w-1 bg-violet-400 rounded-full transition-all duration-75"
                            style={{
                              height: `${Math.max(3, (lvl / 100) * 12)}px`,
                              opacity: lvl > 8 ? 1 : 0.3,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Speaker mode toggle pills */}
                  <div className="hidden sm:flex items-center bg-black/40 p-0.5 rounded-lg border border-white/5 text-[9px] font-mono">
                    <button
                      onClick={() => handleSpeakerModeChange('auto')}
                      className={`px-1.5 py-0.5 rounded transition-colors ${
                        speakerMode === 'auto' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400'
                      }`}
                    >
                      Auto
                    </button>
                    <button
                      onClick={() => handleSpeakerModeChange('Interviewer')}
                      className={`px-1.5 py-0.5 rounded transition-colors ${
                        speakerMode === 'Interviewer' ? 'bg-cyan-600 text-white font-semibold' : 'text-slate-400'
                      }`}
                    >
                      Sys
                    </button>
                    <button
                      onClick={() => handleSpeakerModeChange('You')}
                      className={`px-1.5 py-0.5 rounded transition-colors ${
                        speakerMode === 'You' ? 'bg-violet-600 text-white font-semibold' : 'text-slate-400'
                      }`}
                    >
                      You
                    </button>
                  </div>

                  {/* Real-time VAD State Pill & Live Diagnostics */}
                  {isListening && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded font-mono border flex items-center gap-1 transition-all ${
                          vadStatus === 'speech_detected'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse font-semibold'
                            : vadStatus === 'processing'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse font-semibold'
                            : vadStatus === 'cooldown'
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 font-medium'
                            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            vadStatus === 'speech_detected'
                              ? 'bg-rose-400 animate-ping'
                              : vadStatus === 'processing'
                              ? 'bg-amber-400 animate-spin'
                              : vadStatus === 'cooldown'
                              ? 'bg-purple-400'
                              : 'bg-emerald-400'
                          }`}
                        />
                        <span>{vadStatusText}</span>
                      </span>

                      {/* Live Diagnostics: Real-time RMS + 420ms Pause Timer */}
                      {vadDiagnostics && (
                        <span className="hidden sm:inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-black/60 text-slate-300 font-mono border border-white/10">
                          <span>🎙️ RMS: {vadDiagnostics.rms.toFixed(3)}</span>
                          <span className="text-slate-600">|</span>
                          <span className={vadDiagnostics.silenceMs > 0 ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
                            Pause: {vadDiagnostics.silenceMs}ms/420ms
                          </span>
                        </span>
                      )}

                      <button
                        onClick={() => audioPipeline.forceTrigger()}
                        className="px-2 py-0.5 bg-indigo-600/80 hover:bg-indigo-500 text-white rounded text-[9px] font-mono flex items-center gap-1 transition-colors shadow-sm"
                        title="Flush audio buffer immediately and generate answer now (Cmd+Enter)"
                      >
                        <Zap className="w-2.5 h-2.5 text-amber-300" />
                        <span>⚡ Force Answer Now</span>
                      </button>
                    </div>
                  )}

                  {/* ⚡ Auto-Trigger on Silence (500ms) Toggle Pill */}
                  <button
                    onClick={() => setAutoTriggerOnSilence((prev) => !prev)}
                    className={`hidden md:inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                      autoTriggerOnSilence
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold'
                        : 'bg-white/5 text-slate-400 border border-white/5 hover:text-slate-200'
                    }`}
                    title="Automatically triggers answer generation 500ms after you finish typing or paste a question"
                  >
                    <Zap className="w-2.5 h-2.5 text-amber-400" />
                    <span>Auto-Trigger (500ms): {autoTriggerOnSilence ? 'ON' : 'OFF'}</span>
                  </button>
                </div>

                {/* Status / Force Answer */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400 font-mono hidden md:inline">
                    VAD: <strong>500ms</strong> | <strong>Cmd+Enter</strong>
                  </span>
                  <button
                    onClick={handleManualForceTrigger}
                    disabled={isGenerating}
                    className="p-1.5 hover:bg-white/10 text-slate-300 hover:text-white rounded-md transition-colors"
                    title="Force Answer Now (Cmd/Ctrl + Enter)"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  </button>
                </div>
              </div>

              {/* Streamlined System-Only Audio Listening Banner */}
              <div
                className={`flex items-center justify-between px-3 py-2 rounded-xl border text-[11px] font-mono transition-all shrink-0 flex-wrap gap-2 ${
                  isGenerating
                    ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                    : isListening
                    ? 'bg-cyan-950/25 border-cyan-500/35 text-cyan-200 shadow-sm shadow-cyan-950/40'
                    : 'bg-black/40 border-white/10 text-slate-400'
                }`}
              >
                {/* Left: System Audio Listening Status Pill */}
                <div className="flex items-center gap-2.5 flex-wrap">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-400/30 text-cyan-200 font-semibold">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
                    <span>🎧 System Audio Listening (Interviewer Stream Active)</span>
                  </div>
                  <span className="text-[10px] text-slate-400 hidden sm:inline">
                    Mic echo disabled • Read answers aloud safely
                  </span>
                </div>

                {/* Right: Quick Action Controls */}
                <div className="flex items-center gap-2">
                  {isGenerating ? (
                    <div className="flex items-center gap-1.5 text-amber-300 text-[10px] px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30">
                      <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                      <span>Streaming Answer...</span>
                    </div>
                  ) : (
                    <button
                      onClick={handleManualForceTrigger}
                      disabled={isGenerating}
                      className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 hover:text-white text-[10px] font-mono flex items-center gap-1 transition-colors"
                      title="Force answer generation now (Cmd/Ctrl + Enter)"
                    >
                      <Zap className="w-3 h-3 text-amber-400" />
                      <span>Answer Now (Cmd+Enter)</span>
                    </button>
                  )}
                </div>
              </div>

              {pipelineError && (
                <div className="flex items-center gap-1.5 p-2 bg-rose-500/15 border border-rose-500/30 text-rose-300 rounded-lg text-xs shrink-0">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{pipelineError}</span>
                </div>
              )}

              {/* Stage 1 Real-time Rolling Transcript Ticker */}
              <div className="shrink-0">
                <TranscriptTicker
                  segments={transcriptSegments}
                  activeSpeaker={activeSpeaker}
                  interimText={interimText}
                  isListening={isListening}
                  onClear={handleClearTranscript}
                  onAnswerQuestion={(question) => handleReAnswer(question)}
                  maxHeight="max-h-32"
                />
              </div>

              {/* Stage 2 Parakeet-Style Fast LLM Answer Card */}
              <div className="flex-1 flex flex-col bg-black/35 rounded-xl border border-white/10 overflow-hidden shadow-inner relative">
                {/* Answer Card Header Bar */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.02] border-b border-white/5 shrink-0">
                  <div className="flex items-center gap-2">
                    {hasGroqApiKey() ? (
                      <>
                        <Zap className="w-3 h-3 text-amber-400" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300 font-mono">
                          Parakeet Groq Turbo (Llama-3.3-70B)
                        </span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 text-indigo-400" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-300 font-mono">
                          Parakeet Stream ({PRIMARY_MODEL})
                        </span>
                      </>
                    )}

                    {conversationHistory.length > 0 && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
                        Turn {Math.floor(conversationHistory.length / 2) + 1} • Memory Active
                      </span>
                    )}

                    {generationTimeMs !== null && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                        {(generationTimeMs / 1000).toFixed(1)}s turnaround
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {conversationHistory.length > 0 && (
                      <button
                        onClick={handleResetConversationMemory}
                        title="Reset multi-turn conversation memory"
                        className="p-1 hover:bg-white/10 text-slate-400 hover:text-amber-300 rounded transition-colors text-[9px] font-mono flex items-center gap-0.5"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>Reset Memory</span>
                      </button>
                    )}

                    {streamingAnswer && (
                      <button
                        onClick={handleCopyAnswer}
                        title="Copy answer"
                        className="p-1 hover:bg-white/10 text-slate-400 hover:text-slate-200 rounded transition-colors"
                      >
                        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Streaming Content Display */}
                <div ref={copilotScrollRef} className="flex-1 overflow-y-auto p-3 font-mono text-xs text-slate-100 leading-relaxed select-text space-y-2">
                  {isGenerating && !streamingAnswer && (
                    <div className="flex flex-col items-center justify-center h-full py-8 text-indigo-400 space-y-2">
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span className="text-xs font-sans">Generating sub-second answer via Gemini 3.8 Flash...</span>
                      <span className="text-[10px] text-slate-500 font-mono">thinkingBudget: 0 | temp: 0.1 | multi-turn active</span>
                    </div>
                  )}

                  {streamingAnswer ? (
                    <TeleprompterAnswerView rawText={streamingAnswer} />
                  ) : (
                    !isGenerating && (
                      <div className="flex flex-col items-center justify-center h-full py-6 text-slate-500 text-center space-y-1 select-none">
                        <Zap className="w-5 h-5 text-slate-600" />
                        <p className="text-xs font-sans">
                          Answers stream token-by-token automatically upon 280ms silence pause.
                        </p>
                        <p className="text-[10px] font-mono text-slate-600">
                          Structured as: 🗣️ SAY THIS FIRST • ⚡ CORE TECHNICAL BREAKDOWN • 💻 CODE • 🎯 LIKELY FOLLOW-UP
                        </p>
                      </div>
                    )
                  )}
                </div>

                {/* Robust Live Text Input & Instant Paste Bar */}
                <div className="flex flex-col gap-1.5 p-2 bg-black/40 border-t border-white/5 shrink-0">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono px-0.5">
                    <span className="flex items-center gap-1 text-slate-300">
                      <span className={`w-1.5 h-1.5 rounded-full ${autoTriggerOnSilence ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`} />
                      <span>Instant Question Bar {autoTriggerOnSilence ? '(Auto-triggers in 500ms)' : ''}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handlePasteAndSolve}
                        disabled={isGenerating}
                        className="hover:text-indigo-300 text-slate-400 flex items-center gap-1 transition-colors hover:underline"
                        title="Paste question from clipboard and generate answer immediately"
                      >
                        <Copy className="w-2.5 h-2.5" />
                        <span>📋 Paste & Auto-Solve</span>
                      </button>
                      <span className="text-slate-600">|</span>
                      <span>Cmd+Enter</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleManualForceTrigger();
                        }
                      }}
                      placeholder="Type or paste interviewer question... (auto-triggers in 500ms or hit Enter)"
                      className="flex-1 bg-black/50 text-xs text-slate-100 px-3 py-1.5 rounded-lg border border-white/10 focus:outline-none focus:border-indigo-500 placeholder-slate-500 font-sans shadow-inner"
                    />
                    {manualInput && (
                      <button
                        onClick={() => setManualInput('')}
                        className="px-2 py-1 hover:bg-white/10 text-slate-400 hover:text-slate-200 rounded-lg text-xs"
                        title="Clear"
                      >
                        ✕
                      </button>
                    )}
                    <button
                      onClick={handleManualForceTrigger}
                      disabled={isGenerating || (!manualInput.trim() && !isListening)}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition-colors shadow-md flex items-center gap-1 text-xs font-semibold"
                      title="Generate Answer Now (Cmd+Enter)"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-300" />
                      <span>⚡ Solve</span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'screen' && (
            <motion.div
              key="screen"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="h-full flex flex-col"
            >
              <ScreenSolver />
            </motion.div>
          )}

          {activeTab === 'resume' && (
            <motion.div
              key="resume"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="h-full flex flex-col"
            >
              <ResumeMatcher />
            </motion.div>
          )}

          {activeTab === 'debrief' && (
            <motion.div
              key="debrief"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="h-full flex flex-col"
            >
              <MockDebrief transcriptSegments={transcriptSegments} />
            </motion.div>
          )}

          {activeTab === 'audio' && (
            <motion.div
              key="audio"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="h-full flex flex-col"
            >
              <AudioLoopback />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
