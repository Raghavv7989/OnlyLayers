import React, { useEffect, useRef } from 'react';
import { Volume2, Mic, Clock, Trash2, Copy, Check, Radio, Zap, Shield } from 'lucide-react';
import { SpeakerType, TranscriptSegment } from '../services/audioPipeline';

export interface TranscriptTickerProps {
  segments: TranscriptSegment[];
  activeSpeaker: SpeakerType | null;
  interimText?: string;
  isListening: boolean;
  onClear?: () => void;
  onAnswerQuestion?: (questionText: string) => void;
  maxHeight?: string;
}

export const TranscriptTicker: React.FC<TranscriptTickerProps> = ({
  segments,
  activeSpeaker,
  interimText,
  isListening,
  onClear,
  onAnswerQuestion,
  maxHeight = 'max-h-48',
}) => {
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = React.useState(false);

  // Filter out any raw model hallucinations or audio file requests
  const cleanSegments = segments.filter(
    (s) =>
      s.text &&
      !/please provide the audio/i.test(s.text) &&
      !/provide an audio clip/i.test(s.text) &&
      !/link to the audio/i.test(s.text) &&
      !/no audio was provided/i.test(s.text) &&
      !/as an ai/i.test(s.text)
  );

  // Auto-scroll to bottom as segments update or interim text streams in
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [cleanSegments, interimText, activeSpeaker]);

  const handleCopyTranscript = () => {
    if (cleanSegments.length === 0) return;
    const text = cleanSegments
      .map((s) => `[${s.speaker} - ${s.timestamp}]: ${s.text}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col bg-black/45 rounded-xl border border-white/10 overflow-hidden shadow-lg backdrop-blur-md">
      {/* Ticker Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.03] border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="relative flex items-center justify-center">
            <Radio className={`w-3.5 h-3.5 ${isListening ? 'text-rose-400 animate-pulse' : 'text-slate-500'}`} />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 font-mono">
            Live Q&A Transcription (Stage 1 ASR)
          </span>
          {activeSpeaker && (
            <span
              className={`text-[9px] px-1.5 py-0.2 rounded font-mono border animate-pulse ${
                activeSpeaker === 'Interviewer'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                  : 'bg-violet-500/20 text-violet-300 border-violet-500/30'
              }`}
            >
              {activeSpeaker === 'Interviewer' ? 'Interviewer speaking...' : 'You speaking...'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {cleanSegments.length > 0 && (
            <>
              <button
                onClick={handleCopyTranscript}
                title="Copy full transcript"
                className="p-1 hover:bg-white/10 text-slate-400 hover:text-slate-200 rounded transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
              {onClear && (
                <button
                  onClick={onClear}
                  title="Clear transcript"
                  className="p-1 hover:bg-white/10 text-slate-400 hover:text-rose-400 rounded transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Scrolling Content Feed */}
      <div className={`flex-1 overflow-y-auto p-2.5 space-y-2 select-text font-mono text-xs ${maxHeight}`}>
        {cleanSegments.length === 0 && !interimText ? (
          <div className="flex flex-col items-center justify-center py-6 text-slate-500 text-center space-y-1">
            <Volume2 className="w-5 h-5 text-slate-600" />
            <p className="text-[11px] font-sans">
              {isListening
                ? 'Listening to live speech... [Interviewer] (Cyan) and [You] (Violet) transcripts stream here.'
                : 'Click "Listen (Dual Audio)" to capture meeting audio and candidate mic.'}
            </p>
            <span className="text-[9px] text-slate-600 font-mono">
              VAD auto-detects 500ms pauses to dispatch Stage 2 Fast LLM answers in 2–4s.
            </span>
          </div>
        ) : (
          <>
            {cleanSegments.map((seg) => {
              const isInterviewer = seg.speaker === 'Interviewer';
              const isCandidateAnswerVoice =
                !isInterviewer &&
                (seg.isEcho ||
                  seg.speakerLabel === 'You — Speaking Answer' ||
                  seg.speakerLabel === 'You — Answering');

              return (
                <div
                  key={seg.id}
                  className={`flex flex-col p-2 rounded-lg border transition-all ${
                    isInterviewer
                      ? 'bg-cyan-950/25 border-cyan-500/25 text-slate-200 mr-2'
                      : isCandidateAnswerVoice
                      ? 'bg-violet-950/15 border-violet-500/15 text-slate-300 ml-4 opacity-90'
                      : 'bg-violet-950/25 border-violet-500/25 text-slate-200 ml-4'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold ${
                          isInterviewer
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                            : 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                        }`}
                      >
                        {isInterviewer ? <Volume2 className="w-2.5 h-2.5" /> : <Mic className="w-2.5 h-2.5" />}
                        <span>[{isInterviewer ? 'Interviewer' : (seg.speakerLabel || 'You')}]</span>
                      </span>

                      {/* 🛡️ Candidate Voice Echo Ignored Badge */}
                      {isCandidateAnswerVoice && (
                        <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-mono font-medium bg-violet-500/20 text-violet-300 border border-violet-500/30">
                          <Shield className="w-2.5 h-2.5 text-violet-400" />
                          <span>🛡️ Ignored (Your Voice)</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-[9px] text-slate-500">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{seg.timestamp}</span>
                      </span>

                      {/* ⚡ Re-Answer Button on Interviewer Lines */}
                      {isInterviewer && onAnswerQuestion && (
                        <button
                          onClick={() => onAnswerQuestion(seg.text)}
                          className="px-1.5 py-0.5 bg-indigo-600/80 hover:bg-indigo-500 text-white rounded text-[9px] font-sans font-medium flex items-center gap-0.5 shadow-sm transition-colors"
                          title="Regenerate instant answer for this interviewer question"
                        >
                          <Zap className="w-2.5 h-2.5 text-amber-300" />
                          <span>⚡ Re-Answer</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-slate-200 font-sans pl-0.5">
                    {seg.text}
                  </p>
                </div>
              );
            })}

            {/* In-Flight Real-Time Streaming Syllables */}
            {interimText && (
              <div
                className={`flex flex-col p-2 rounded-lg border animate-pulse ${
                  activeSpeaker === 'You'
                    ? 'bg-violet-950/30 border-violet-500/30 text-violet-200 ml-4'
                    : 'bg-cyan-950/30 border-cyan-500/30 text-cyan-200 mr-2'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold ${
                      activeSpeaker === 'You'
                        ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                        : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    }`}
                  >
                    <Volume2 className="w-2.5 h-2.5 animate-spin" />
                    <span>[{activeSpeaker === 'You' ? 'You' : 'Interviewer'} - Speaking...]</span>
                  </span>
                  <span className="text-[9px] text-indigo-400 font-mono">Live ASR Stream</span>
                </div>
                <p className="text-xs leading-relaxed font-sans pl-0.5 italic">
                  {interimText}
                </p>
              </div>
            )}
          </>
        )}
        <div ref={scrollEndRef} />
      </div>
    </div>
  );
};
