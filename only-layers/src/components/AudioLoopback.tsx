import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Sparkles, RefreshCw, Copy, Check, Radio } from 'lucide-react';
import { streamQuickAnswer, solveAudioQuestion } from '../services/geminiLive';
import { getCachedInterviewContext } from '../services/resumeEngine';
import { semanticGuard } from '../services/semanticGuard';

export const AudioLoopback: React.FC = () => {
  const [isListening, setIsListening] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState<number>(0);
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);

  // Setup Web Speech Recognition if available in the runtime
  useEffect(() => {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognitionClass) {
      try {
        const recognition = new SpeechRecognitionClass();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          let currentTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const item = event.results[i];
            if (item && item[0]) {
              currentTranscript += item[0].transcript;
            }
          }
          if (currentTranscript.trim()) {
            setTranscript(currentTranscript);
          }
        };

        recognitionRef.current = recognition;
      } catch (e) {
        console.warn('Speech recognition init error:', e);
      }
    }

    if (window.electronAPI?.onTriggerAudioAnswer) {
      window.electronAPI.onTriggerAudioAnswer(() => {
        handleTriggerAnswer();
      });
    }

    return () => {
      stopAudioCapture();
    };
  }, []);

  const startAudioCapture = async () => {
    setError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false, // Prevents background room noise amplification during silence
        },
      });
      mediaStreamRef.current = stream;

      // 1. Audio Visualizer using AudioContext
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setVolumeLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animationFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();

      // 2. MediaRecorder for raw audio capture
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;

      // 3. Start speech recognition if supported
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch {
          // Ignore if already active
        }
      }

      setIsListening(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg.includes('Permission') || msg.includes('NotAllowed')
          ? 'Microphone permission denied. Please allow microphone access in macOS System Settings -> Privacy & Security -> Microphone.'
          : 'Could not start microphone: ' + msg
      );
      setIsListening(false);
    }
  };

  const stopAudioCapture = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    setIsListening(false);
    setVolumeLevel(0);
  };

  const toggleListening = () => {
    if (isListening) {
      stopAudioCapture();
    } else {
      startAudioCapture();
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result as string;
        resolve(res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleTriggerAnswer = async () => {
    const hasAudioRecorded = audioChunksRef.current.length > 0;
    const hasTranscript = transcript.trim().length > 0;

    if (!hasAudioRecorded && !hasTranscript) {
      setError('Please speak into the microphone or type the interview question.');
      return;
    }

    // Stop listening before generating answer
    if (isListening) {
      stopAudioCapture();
    }

    setError(null);
    setIsLoading(true);
    setAnswer('');
    semanticGuard.setGeneratingAnswer();

    try {
      const resume = getCachedInterviewContext();

      // If we have microphone audio recording, pass audio directly to Gemini
      if (hasAudioRecorded && audioChunksRef.current.some((c) => c.size > 0)) {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const base64Audio = audioBlob.size > 500 ? await blobToBase64(audioBlob) : undefined;

        const result = await solveAudioQuestion({
          audioBase64: base64Audio,
          audioMimeType: 'audio/webm',
          interimTranscript: transcript,
          resumeContext: resume,
        });

        if (/please provide the audio/i.test(result) || /link to the audio/i.test(result)) {
          setError('Audio clip was too brief or low volume. Please speak clearly into the microphone.');
          semanticGuard.unlockAwaitingQuestion();
        } else {
          setAnswer(result);
          semanticGuard.setCandidateAnswering(result, transcript);
        }
        audioChunksRef.current = [];
      } else {
        // Fallback to text prompt
        const prompt = `The interviewer asked: "${transcript}"
Provide a high-scoring, precise technical interview answer with structured bullet points and STAR examples.`;

        let streamedAnswer = '';
        await streamQuickAnswer({
          prompt,
          resumeContext: resume,
          onChunk: (chunk) => {
            streamedAnswer = chunk;
            setAnswer(chunk);
          },
        });
        if (streamedAnswer) {
          semanticGuard.setCandidateAnswering(streamedAnswer, transcript);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!answer) return;
    navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Listening Control Header */}
      <div className="flex items-center justify-between gap-2 bg-black/40 p-2.5 rounded-lg border border-white/10">
        <div className="flex items-center gap-2.5">
          <button
            onClick={toggleListening}
            className={`p-2.5 rounded-full transition-all flex items-center justify-center ${
              isListening
                ? 'bg-rose-500 text-white animate-pulse shadow-lg shadow-rose-500/50'
                : 'bg-white/10 text-slate-300 hover:bg-white/20'
            }`}
            title={isListening ? 'Click to Stop Recording' : 'Click to Listen to Interviewer'}
          >
            {isListening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </button>

          <div>
            <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <span>{isListening ? '🎧 System Audio Listening (Interviewer Stream Active)' : 'System Audio Ready'}</span>
              {isListening && (
                <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/30">
                  <Radio className="w-2.5 h-2.5 animate-pulse" /> LIVE
                </span>
              )}
            </div>

            {/* Audio Waveform Volume Bars */}
            {isListening ? (
              <div className="flex items-center gap-0.5 mt-1">
                {[...Array(12)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1 rounded-full bg-emerald-400 transition-all duration-75"
                    style={{
                      height: `${Math.max(3, (volumeLevel / 100) * (i % 2 === 0 ? 12 : 18))}px`,
                      opacity: volumeLevel > i * 7 ? 1 : 0.3,
                    }}
                  />
                ))}
                <span className="text-[9px] text-slate-400 font-mono ml-1.5">
                  {volumeLevel > 5 ? 'Sound detected' : 'Waiting for voice...'}
                </span>
              </div>
            ) : (
              <div className="text-[10px] text-slate-400">
                Hotkey: <strong>Cmd + Enter</strong> to answer immediately
              </div>
            )}
          </div>
        </div>

        <button
          onClick={handleTriggerAnswer}
          disabled={isLoading || (!isListening && !transcript.trim() && audioChunksRef.current.length === 0)}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm shadow-indigo-500/30"
        >
          {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          <span>Answer Now</span>
        </button>
      </div>

      {/* Transcript / Question Input */}
      <div className="bg-black/25 rounded-lg p-2.5 border border-white/5">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-mono mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <Volume2 className="w-3 h-3 text-indigo-400" />
            <span>Question Transcript / Notes</span>
          </span>
          <span className="text-[9px] text-slate-500">Multimodal Audio Engine</span>
        </div>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder={isListening ? 'Listening to interviewer speech...' : 'Click mic to record interviewer or type question here...'}
          rows={2}
          className="w-full bg-transparent text-xs text-slate-200 resize-none focus:outline-none placeholder-slate-600 font-mono"
        />
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-2 bg-rose-500/15 border border-rose-500/25 text-rose-300 rounded-lg text-xs leading-snug">
          {error}
        </div>
      )}

      {/* Answer Area */}
      <div className="flex-1 overflow-y-auto bg-black/35 rounded-lg p-3 border border-white/5 font-mono text-xs text-slate-200 leading-relaxed min-h-[140px] max-h-[220px] relative select-text">
        {isLoading && !answer && (
          <div className="flex flex-col items-center justify-center h-full py-8 space-y-2 text-indigo-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span className="text-xs">Analyzing audio & synthesizing optimal answer...</span>
            <span className="text-[10px] text-slate-500">Direct Gemini processing</span>
          </div>
        )}

        {answer ? (
          <div>
            <div className="whitespace-pre-wrap">{answer}</div>
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 text-slate-300 rounded-md transition-colors"
              title="Copy answer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        ) : (
          !isLoading && (
            <div className="text-slate-500 text-center py-7 text-xs select-none flex flex-col items-center gap-1.5">
              <Mic className="w-5 h-5 text-slate-600" />
              <span>Click the microphone while the interviewer asks their question.</span>
              <span className="text-[10px] text-slate-600">Press <strong>Cmd + Enter</strong> to answer instantly.</span>
            </div>
          )
        )}
      </div>
    </div>
  );
};
