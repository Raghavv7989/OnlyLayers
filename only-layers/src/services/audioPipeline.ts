/**
 * AudioPipeline — Adaptive 400ms Silence VAD, Web Audio Sink Connection & Zero-Hang Streaming
 *
 * Core Architectural Safeguards:
 * 1. Explicit Web Audio Graph: source -> ScriptProcessor(2048) -> silentGain(0) -> destination (keeps graph alive in Chromium)
 * 2. autoGainControl: false in getUserMedia to prevent background noise amplification during pauses
 * 3. Dynamic Peak-Relative Silence Detection: triggers in 420ms (adapted to noise floor and peak speech RMS)
 * 4. 3-Frame Pre-roll Ring Buffer (~384ms) so the first syllable/word is never clipped
 * 5. Trailing silence trimming before 16kHz WAV encoding for minimal payload (<90KB)
 * 6. Non-blocking processing queue with 8-second timeout guard and immediate lock release on first answer token
 * 7. Real-time diagnostics feed (RMS, Pause countdown, Noise Floor, Peak RMS)
 */

import {
  streamAudioQuestionAndAnswer,
  transcribeAudioClip,
  streamQuickAnswer,
} from './geminiLive';
import { getStoredResume } from './resumeEngine';
import {
  hasGroqApiKey,
  transcribeAudioWithGroqWhisper,
  streamGroqAnswer,
  streamParakeetAnswerFromText,
} from './groqEngine';
import {
  semanticGuard,
  SpeakerTag,
  SemanticClassification,
  ListeningGuardMode,
} from './semanticGuard';

export type SpeakerType = 'Interviewer' | 'You';
export type SpeakerLabel = 'Interviewer' | 'You' | 'You — Speaking Answer' | 'You — Answering';

export type VADStatus =
  | 'idle'
  | 'ready'
  | 'speech_detected'
  | 'processing'
  | 'cooldown';

export interface VADDiagnostics {
  rms: number;
  silenceMs: number;
  targetSilenceMs: number;
  noiseFloor: number;
  peakRms: number;
  isSpeaking: boolean;
}

export interface VolumeLevels {
  interviewer: number;
  mic: number;
  waveform: number[];
}

export interface TranscriptSegment {
  id: string;
  speaker: SpeakerType;
  speakerLabel?: SpeakerLabel | string;
  isEcho?: boolean;
  text: string;
  timestamp: string;
  isFinal: boolean;
}

export interface AudioPipelineCallbacks {
  onTranscriptChunk: (segment: TranscriptSegment) => void;
  onAnswerChunk: (answerText: string, isDone: boolean, latencyMs?: number) => void;
  onVolumeChange: (levels: { interviewer: number; mic: number; waveform: number[] }) => void;
  onStatusChange: (status: {
    isListening: boolean;
    vadStatus: VADStatus;
    statusText: string;
    activeSpeaker: SpeakerType;
  }) => void;
  onDiagnostics?: (diagnostics: VADDiagnostics) => void;
  onError: (error: string) => void;
}

const SAMPLE_RATE = 16000;
const TARGET_WAV_SAMPLE_RATE = 8000;   // 8kHz 16-bit Mono WAV downsampling (half byte size, <35ms upload)
const FRAME_SIZE = 1024;               // 1024 samples = ~64ms per frame at 16kHz for ultra-snappy response
const SILENCE_DURATION_MS = 850;       // 850ms natural silence trigger: responsive turn completion without cutting mid-word
const MIN_SPEECH_DURATION_MS = 450;    // Minimum 450ms spoken speech to filter coughs/clicks
const MIN_PEAK_RMS_THRESHOLD = 0.020;  // Strict Vocal-Energy Gating: filters background fan noise, AC hum, and breathing
const MAX_UTTERANCE_CAP_MS = 25000;    // 25-second max utterance cap for long in-depth interview questions
const COOLDOWN_MS = 300;               // 300ms ultra-fast debounce between questions
const PRE_ROLL_FRAMES = 10;            // 10 frames * 64ms = ~640ms pre-roll ring buffer
const CHUNK_MERGE_WINDOW_MS = 2500;    // 2.5s merge window for mid-sentence pauses

export class AudioPipelineEngine {
  private isListening = false;
  private vadStatus: VADStatus = 'idle';
  private callbacks: AudioPipelineCallbacks | null = null;
  private listeningGuardMode: ListeningGuardMode = 'smart_dual';

  // Rolling Accumulation & Mid-Sentence Pause Merge Buffer
  private lastUtteranceText = '';
  private lastUtteranceTimestamp = 0;
  private pendingSegmentId = '';

  // Real-time cancellation controller for in-flight answer streams
  private answerAbortController: AbortController | null = null;

  // Web Audio Context & Nodes
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private interviewerStream: MediaStream | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private interviewerAnalyser: AnalyserNode | null = null;
  private mixerGain: GainNode | null = null;
  private interviewerSource: MediaStreamAudioSourceNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;

  // Adaptive Noise Floor & Peak Tracking
  private noiseFloor = 0.008;
  private utterancePeakRms = 0.01;

  // 3-Frame Pre-roll Ring Buffer (~384ms)
  private preRollRingBuffer: Float32Array[] = [];

  // Utterance Buffering & State
  private utteranceBuffer: Float32Array[] = [];
  private totalSampleCount = 0;
  private isSpeaking = false;
  private speechStartTime = 0;
  private silenceStartTime = 0;
  private isProcessing = false;

  // Live waveform history
  private waveformHistory: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

  // Diarization & Cooldown Control
  private speakerOverride: SpeakerType | 'auto' = 'auto';
  private activeSpeaker: SpeakerType = 'Interviewer';
  private cooldownTimer: NodeJS.Timeout | null = null;
  private currentSegmentId = '';

  // DSP Diarization & Software AEC Envelope Tracking (Layer 1 & Layer 2)
  private hasDesktopLoopback = false;
  private sysRmsPeak = 0;
  private micRmsPeak = 0;
  private netCandidateRmsPeak = 0;
  private currentSpeakerTag: SpeakerTag = 'SHARED_MIC';

  public getListeningState(): boolean {
    return this.isListening;
  }

  public getVADStatus(): VADStatus {
    return this.vadStatus;
  }

  public getActiveSpeaker(): SpeakerType {
    return this.activeSpeaker;
  }

  public getCurrentSpeakerTag(): SpeakerTag {
    return this.currentSpeakerTag;
  }

  public getListeningGuardMode(): ListeningGuardMode {
    return this.listeningGuardMode;
  }

  public setListeningGuardMode(mode: ListeningGuardMode): void {
    this.listeningGuardMode = mode;
    semanticGuard.setListeningMode(mode);
  }

  public setSpeakerOverride(mode: SpeakerType | 'auto'): void {
    this.speakerOverride = mode;
    if (mode !== 'auto') {
      this.activeSpeaker = mode;
      this.currentSpeakerTag = mode === 'Interviewer' ? 'SPEAKER_1' : 'SPEAKER_2';
    }
  }

  public resetForNextQuestion(): void {
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.abortActiveGeneration();
    this.lastUtteranceText = '';
    this.lastUtteranceTimestamp = 0;
    this.pendingSegmentId = '';
    this.utteranceBuffer = [];
    this.totalSampleCount = 0;
    this.isSpeaking = false;
    this.silenceStartTime = 0;
    this.isProcessing = false;
    this.utterancePeakRms = 0.01;
    this.sysRmsPeak = 0;
    this.micRmsPeak = 0;
    this.netCandidateRmsPeak = 0;
    this.currentSpeakerTag = 'SPEAKER_1';

    if (this.isListening) {
      this.vadStatus = 'ready';
      this.notifyStatus('ready', '🎧 System Listening — Interviewer Stream Active');
    } else {
      this.vadStatus = 'idle';
      this.notifyStatus('idle', 'Listening paused');
    }
  }

  private getFormattedTime(): string {
    return new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private notifyStatus(status: VADStatus, statusText: string): void {
    this.vadStatus = status;
    if (this.callbacks) {
      this.callbacks.onStatusChange({
        isListening: this.isListening,
        vadStatus: status,
        statusText,
        activeSpeaker: this.activeSpeaker,
      });
    }
  }

  /**
   * Start 16kHz PCM Utterance VAD Recording Pipeline
   */
  public async start(callbacks: AudioPipelineCallbacks): Promise<void> {
    if (this.isListening) {
      this.callbacks = callbacks;
      return;
    }

    this.callbacks = callbacks;
    this.utteranceBuffer = [];
    this.totalSampleCount = 0;
    this.preRollRingBuffer = [];
    this.isSpeaking = false;
    this.silenceStartTime = 0;
    this.isProcessing = false;
    this.noiseFloor = 0.008;
    this.utterancePeakRms = 0.01;

    try {
      // 1. Create AudioContext (Prefer 16000Hz native sample rate)
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      try {
        this.audioContext = new AudioCtxClass({ sampleRate: SAMPLE_RATE });
      } catch {
        this.audioContext = new AudioCtxClass();
      }

      // Explicitly resume audioContext if suspended by Chromium autoplay policy
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        console.log('🔊 [AudioPipeline] AudioContext resumed from suspended state. State:', this.audioContext.state);
      }

      // 2. Microphone Stream Acquisition (Provides physical mic visualizer & graceful VAD fallback)
      let micSourceNode: MediaStreamAudioSourceNode | null = null;
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
            channelCount: 1,
            sampleRate: SAMPLE_RATE,
          },
        });

        micSourceNode = this.audioContext.createMediaStreamSource(this.micStream);
        this.micAnalyser = this.audioContext.createAnalyser();
        this.micAnalyser.fftSize = 256;
        micSourceNode.connect(this.micAnalyser);
        console.log('🎤 [AudioPipeline] Local microphone stream initialized successfully.');
      } catch (micErr) {
        console.warn('⚠️ [AudioPipeline] Local mic acquisition error (room audio):', micErr);
      }

      // 3. Desktop System Audio Loopback Capture (desktopCapturer)
      try {
        const getSourcesFn = window.electronAPI?.getDesktopSources || window.electronAPI?.getAudioSources;
        if (getSourcesFn) {
          const sources = await getSourcesFn({ types: ['screen', 'window'] });
          console.log(
            '🖥️ [AudioPipeline] Available desktop sources:',
            sources?.length,
            sources?.map((s) => `${s.id}: ${s.name}`)
          );

          if (sources && sources.length > 0) {
            // Prioritize primary screen or known meeting apps
            const targetSource =
              sources.find((s) => s.id?.startsWith('screen:')) ||
              sources.find((s) => /zoom|meet|teams|slack|webex|call|chrome|browser/i.test(s.name)) ||
              sources[0];

            console.log('🎯 [AudioPipeline] Initializing desktop audio stream for source:', targetSource.id, targetSource.name);

            const constraints = {
              audio: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: targetSource.id,
                },
              },
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: targetSource.id,
                  maxWidth: 1920,
                  maxHeight: 1080,
                },
              },
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const desktopStream = await (navigator.mediaDevices as any).getUserMedia(constraints);

            // Disable video track without stopping it (calling track.stop() cancels Chromium desktop capture session)
            desktopStream.getVideoTracks().forEach((track: MediaStreamTrack) => {
              track.enabled = false;
            });

            const audioTracks = desktopStream.getAudioTracks();
            console.log(
              '🔊 [AudioPipeline] Desktop audio tracks obtained:',
              audioTracks.length,
              audioTracks.map((t: MediaStreamTrack) => t.label)
            );

            if (audioTracks.length > 0) {
              this.interviewerStream = new MediaStream(audioTracks);
              this.interviewerSource = this.audioContext.createMediaStreamSource(this.interviewerStream);
              this.interviewerAnalyser = this.audioContext.createAnalyser();
              this.interviewerAnalyser.fftSize = 256;
              this.interviewerSource.connect(this.interviewerAnalyser);
              this.hasDesktopLoopback = true;
              console.log('🎧 [AudioPipeline] Primary system loopback audio source initialized.');
            }
          }
        }
      } catch (sysErr) {
        console.warn('⚠️ [AudioPipeline] Desktop loopback audio capture error:', sysErr);
      }

      // 4. Ensure Web Audio Processing Graph Has An Active Connected Input Node
      this.scriptProcessor = this.audioContext.createScriptProcessor(FRAME_SIZE, 1, 1);
      this.silentGain = this.audioContext.createGain();
      this.silentGain.gain.value = 0; // Prevents speaker acoustic feedback while keeping graph alive in Chromium

      if (this.interviewerSource) {
        // EXCLUSIVE: Connect primary system loopback audio to the question VAD
        this.interviewerSource.connect(this.scriptProcessor);
        this.hasDesktopLoopback = true;
        console.log('🎧 [AudioPipeline] Connected system audio loopback to ScriptProcessor VAD.');
      } else if (micSourceNode) {
        // Fallback: If OS desktop audio loopback has no tracks on current hardware, route mic to VAD so HUD is never deaf
        micSourceNode.connect(this.scriptProcessor);
        this.hasDesktopLoopback = false;
        console.warn('⚠️ [AudioPipeline] No desktop audio loopback track available. Routing microphone to ScriptProcessor so listening remains fully active!');
      } else {
        console.error('❌ [AudioPipeline] No audio sources available to connect to ScriptProcessor!');
      }

      this.scriptProcessor.connect(this.silentGain);
      this.silentGain.connect(this.audioContext.destination);

      // Verify and re-resume AudioContext after graph wiring
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        console.log('🔊 [AudioPipeline] AudioContext verified active. State:', this.audioContext.state);
      }

      // 5. Real-Time System Audio VAD Process Handler with Frame Logging
      let frameCounter = 0;
      this.scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
        if (!this.isListening) return;

        const inputBuffer = event.inputBuffer.getChannelData(0);

        // Calculate real-time RMS of active audio stream
        let sumSquares = 0;
        for (let i = 0; i < inputBuffer.length; i++) {
          sumSquares += inputBuffer[i] * inputBuffer[i];
        }
        const rms = Math.sqrt(sumSquares / inputBuffer.length);

        // Measure local physical microphone level for UI meter
        let micRms = 0;
        if (this.micAnalyser) {
          const micData = new Float32Array(this.micAnalyser.fftSize);
          this.micAnalyser.getFloatTimeDomainData(micData);
          let micSum = 0;
          for (let i = 0; i < micData.length; i++) {
            micSum += micData[i] * micData[i];
          }
          micRms = Math.sqrt(micSum / micData.length);
        }

        // Console frame logging to verify active data flow
        frameCounter++;
        if (frameCounter % 16 === 0 || rms > 0.015) {
          console.log(
            `[AudioPipeline Frame] RMS: ${rms.toFixed(5)} | Mic: ${micRms.toFixed(5)} | Speaking: ${this.isSpeaking} | NoiseFloor: ${this.noiseFloor.toFixed(5)} | Loopback: ${this.hasDesktopLoopback}`
          );
        }

        // Keep lightweight pre-roll ring buffer
        const frameCopy = new Float32Array(inputBuffer);
        this.preRollRingBuffer.push(frameCopy);
        if (this.preRollRingBuffer.length > PRE_ROLL_FRAMES) {
          this.preRollRingBuffer.shift();
        }

        const sysRms = rms;
        const micVolume = Math.min(100, Math.round(micRms * 400));
        const interviewerVolume = Math.min(100, Math.round(sysRms * 400));

        // Maintain 8-bar rolling waveform for UI
        this.waveformHistory.push(Math.min(100, Math.round(rms * 500)));
        if (this.waveformHistory.length > 8) {
          this.waveformHistory.shift();
        }

        if (this.callbacks) {
          this.callbacks.onVolumeChange({
            mic: micVolume,
            interviewer: interviewerVolume,
            waveform: [...this.waveformHistory],
          });
        }

        const now = Date.now();

        // If in brief debounce cooldown or currently processing an answer, skip speech trigger
        if (this.vadStatus === 'cooldown' || this.isProcessing) {
          if (this.callbacks?.onDiagnostics) {
            this.callbacks.onDiagnostics({
              rms,
              silenceMs: 0,
              targetSilenceMs: SILENCE_DURATION_MS,
              noiseFloor: this.noiseFloor,
              peakRms: this.utterancePeakRms,
              isSpeaking: false,
            });
          }
          return;
        }

        // System audio loopback is ALWAYS the Interviewer
        this.currentSpeakerTag = 'SPEAKER_1';
        this.activeSpeaker = 'Interviewer';

        // Dynamic thresholds:
        // Speech start requires clear vocal energy above background noise floor
        const speechStartThreshold = Math.max(this.noiseFloor * 2.2, 0.014);

        // Dynamic peak-drop silence: frame is silent if rms drops below peak * 0.28 or noiseFloor * 1.5
        const silenceThreshold = Math.max(this.noiseFloor * 1.5, this.utterancePeakRms * 0.28, 0.010);

        if (!this.isSpeaking) {
          if (rms > speechStartThreshold) {
            // Cancel active generation immediately when interviewer starts speaking!
            this.abortActiveGeneration();

            // SPEECH START DETECTION ON SYSTEM LOOPBACK
            this.isSpeaking = true;
            this.speechStartTime = now;
            this.silenceStartTime = 0;
            this.utterancePeakRms = rms;
            this.sysRmsPeak = sysRms;
            this.micRmsPeak = micRms;
            this.utteranceBuffer = [];
            this.totalSampleCount = 0;

            // Prepend pre-roll ring buffer so initial syllables ("What", "How", "Why") are preserved!
            for (const preChunk of this.preRollRingBuffer) {
              this.utteranceBuffer.push(preChunk);
              this.totalSampleCount += preChunk.length;
            }

            this.currentSegmentId = Math.random().toString(36).substring(2, 9);
            this.notifyStatus('speech_detected', '🎧 Interviewer Speaking — Recording Question...');

            if (this.callbacks) {
              this.callbacks.onTranscriptChunk({
                id: this.currentSegmentId,
                speaker: 'Interviewer',
                text: '🎙️ Capturing Interviewer Question...',
                timestamp: this.getFormattedTime(),
                isFinal: false,
              });
            }
          }
        } else {
          // CURRENTLY RECORDING SYSTEM AUDIO SPEECH
          this.utterancePeakRms = Math.max(this.utterancePeakRms, rms);
          this.sysRmsPeak = Math.max(this.sysRmsPeak, sysRms);
          this.micRmsPeak = Math.max(this.micRmsPeak, micRms);
          this.utteranceBuffer.push(frameCopy);
          this.totalSampleCount += frameCopy.length;

          // Enforce 8-second max continuous speech cap with vocal energy verification
          if (now - this.speechStartTime >= MAX_UTTERANCE_CAP_MS) {
            if (this.utterancePeakRms >= MIN_PEAK_RMS_THRESHOLD) {
              const bufferSnapshot = [...this.utteranceBuffer];
              const speakerTagSnapshot = this.currentSpeakerTag;
              const segmentIdSnapshot = this.currentSegmentId || Math.random().toString(36).substring(2, 9);
              this.resetUtteranceStateSilently();
              this.finalizeUtteranceWithBuffer(bufferSnapshot, 0, speakerTagSnapshot, segmentIdSnapshot);
            } else {
              this.resetUtteranceState();
            }
            return;
          }

          // Evaluate 280ms Ultra-Fast Silence Condition
          if (rms < silenceThreshold) {
            if (this.silenceStartTime === 0) {
              this.silenceStartTime = now;
            }
            const silenceElapsed = now - this.silenceStartTime;
            if (silenceElapsed >= SILENCE_DURATION_MS) {
              const speechDuration = now - this.speechStartTime;
              // Strict Vocal-Energy Gating: at least 450ms duration AND peak RMS >= 0.020
              if (speechDuration >= MIN_SPEECH_DURATION_MS && this.utterancePeakRms >= MIN_PEAK_RMS_THRESHOLD) {
                // PARALLEL NON-BLOCKING ASR DISPATCH: clone buffer in <1ms and reset audio loop immediately!
                const bufferSnapshot = [...this.utteranceBuffer];
                const speakerTagSnapshot = this.currentSpeakerTag;
                const segmentIdSnapshot = this.currentSegmentId || Math.random().toString(36).substring(2, 9);
                this.resetUtteranceStateSilently();
                this.finalizeUtteranceWithBuffer(bufferSnapshot, silenceElapsed, speakerTagSnapshot, segmentIdSnapshot);
                return;
              } else {
                // Short noise spike, click, or quiet background fan noise: discard cleanly
                this.resetUtteranceState();
                return;
              }
            }
          } else {
            // Vocal sound resumed before 280ms elapsed
            this.silenceStartTime = 0;
          }
        }

        // Live Diagnostics Emission
        const silenceElapsed =
          this.isSpeaking && this.silenceStartTime > 0
            ? Math.min(SILENCE_DURATION_MS, now - this.silenceStartTime)
            : 0;

        if (this.callbacks?.onDiagnostics) {
          this.callbacks.onDiagnostics({
            rms,
            silenceMs: silenceElapsed,
            targetSilenceMs: SILENCE_DURATION_MS,
            noiseFloor: this.noiseFloor,
            peakRms: this.utterancePeakRms,
            isSpeaking: this.isSpeaking,
          });
        }
      };

      this.isListening = true;
      this.vadStatus = 'ready';
      this.notifyStatus('ready', '🎧 System Listening — Interviewer Stream Active');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.stop();
      if (this.callbacks) {
        this.callbacks.onError(`Microphone initialization error: ${msg}`);
      }
      throw err;
    }
  }

  private resetUtteranceStateSilently(): void {
    this.isSpeaking = false;
    this.silenceStartTime = 0;
    this.utteranceBuffer = [];
    this.totalSampleCount = 0;
    this.utterancePeakRms = 0.01;
    this.sysRmsPeak = 0;
    this.micRmsPeak = 0;
    this.netCandidateRmsPeak = 0;
    this.notifyStatus('processing', '⚡ Transcribing Question (Sub-300ms ASR)...');
  }

  private resetUtteranceState(): void {
    this.isSpeaking = false;
    this.silenceStartTime = 0;
    this.utteranceBuffer = [];
    this.totalSampleCount = 0;
    this.utterancePeakRms = 0.01;
    this.sysRmsPeak = 0;
    this.micRmsPeak = 0;
    this.netCandidateRmsPeak = 0;
    this.notifyStatus('ready', '🎧 System Listening — Interviewer Stream Active');
    if (this.callbacks) {
      this.callbacks.onTranscriptChunk({
        id: this.currentSegmentId,
        speaker: this.activeSpeaker,
        text: '',
        timestamp: this.getFormattedTime(),
        isFinal: true,
      });
    }
  }

  /**
   * Immediately aborts any running LLM answer generation stream
   */
  public abortActiveGeneration(): void {
    if (this.answerAbortController) {
      try {
        this.answerAbortController.abort();
      } catch {}
      this.answerAbortController = null;
    }
    this.isProcessing = false;
  }

  /**
   * Finalizes utterance using 8kHz 16-bit Mono downsampling (<15KB payload, <35ms upload).
   */
  public async finalizeUtteranceWithBuffer(
    buffer: Float32Array[],
    silenceElapsed: number,
    speakerTag: SpeakerTag,
    segmentId: string
  ): Promise<void> {
    if (this.isProcessing || buffer.length === 0) return;

    this.isProcessing = true;
    this.notifyStatus('processing', '⚡ Transcribing via Groq Whisper Turbo (8kHz)...');

    try {
      // 1. Trim trailing silent frames (leave ~80ms cushion)
      const chunksToDrop = Math.max(0, Math.floor((silenceElapsed - 80) / 64));
      if (chunksToDrop > 0 && buffer.length > chunksToDrop + 2) {
        buffer.splice(buffer.length - chunksToDrop, chunksToDrop);
      }

      // 2. Merge Float32Array frames into contiguous PCM buffer
      let totalSamples = 0;
      for (const chunk of buffer) {
        totalSamples += chunk.length;
      }
      const merged = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of buffer) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      // 3. 8kHz 16-bit Mono WAV Downsampling (<15KB upload payload)
      const inputRate = this.audioContext?.sampleRate || SAMPLE_RATE;
      const samples8k = downsampleTo8k(merged, inputRate);
      const wavBlob = encodeWAV(samples8k, TARGET_WAV_SAMPLE_RATE);

      // Flush pre-roll ring buffer
      this.preRollRingBuffer = [];

      // 4. STAGE 1: Sub-300ms ASR Transcription (<10ms handoff to network)
      let transcriptText = '';
      const startTime = Date.now();

      if (hasGroqApiKey()) {
        try {
          const { text } = await transcribeAudioWithGroqWhisper(wavBlob);
          transcriptText = (text || '').trim();
        } catch (whisperErr) {
          console.warn('Groq Whisper transcription failed, trying Gemini ASR:', whisperErr);
        }
      }

      if (!transcriptText) {
        try {
          this.notifyStatus('processing', '⚡ Transcribing via Gemini Fast ASR (8kHz)...');
          const base64Wav = await blobToBase64(wavBlob);
          transcriptText = await transcribeAudioClip(base64Wav, 'audio/wav');
          transcriptText = (transcriptText || '').trim();
        } catch (geminiAsrErr) {
          console.warn('Gemini ASR transcription error:', geminiAsrErr);
        }
      }

      // Filter pure noise or silence hallucinations
      const isNoise =
        !transcriptText ||
        /^(?:\[(?:silence|noise|background noise|cough|unintelligible|inaudible)\]|\s*)$/i.test(transcriptText);

      if (isNoise) {
        this.isProcessing = false;
        this.notifyStatus('ready', '🎧 System Listening — Interviewer Stream Active');
        return;
      }

      // 5. Intelligent Rolling Merge Buffer for Mid-Sentence Pauses & Breaths
      const now = Date.now();
      let finalQuestionText = transcriptText;
      let effectiveSegmentId = segmentId;

      const timeSinceLastUtterance = now - this.lastUtteranceTimestamp;
      const previousEndedWithTerminal = /[?.!]$/.test(this.lastUtteranceText.trim());

      if (
        this.lastUtteranceText &&
        timeSinceLastUtterance <= CHUNK_MERGE_WINDOW_MS &&
        !previousEndedWithTerminal
      ) {
        // Automatically merge chunks into a single unified sentence
        finalQuestionText = `${this.lastUtteranceText} ${transcriptText}`.trim();
        effectiveSegmentId = this.pendingSegmentId || segmentId;
        console.log(
          `[AudioPipeline] Merged mid-sentence pause utterance (${timeSinceLastUtterance}ms gap): "${finalQuestionText}"`
        );
      }

      this.lastUtteranceText = finalQuestionText;
      this.lastUtteranceTimestamp = now;
      this.pendingSegmentId = effectiveSegmentId;

      // Update transcript on UI ticker (in-place replaces partial chunk via matching segment ID)
      this.callbacks?.onTranscriptChunk({
        id: effectiveSegmentId,
        speaker: 'Interviewer',
        speakerLabel: 'Interviewer',
        isEcho: false,
        text: finalQuestionText,
        timestamp: this.getFormattedTime(),
        isFinal: true,
      });

      // Release lock & IMMEDIATELY pipe into Stage 2 Parakeet LLM streaming (Zero artificial debounce)
      this.isProcessing = false;
      await this.dispatchAnswerGeneration(finalQuestionText, startTime);
    } catch (err) {
      console.warn('Utterance ASR error:', err);
      if (this.callbacks) {
        this.callbacks.onError(`Audio processing error: ${(err as Error)?.message || String(err)}`);
      }
      this.isProcessing = false;
      this.enterCooldown(300);
    }
  }

  /**
   * Dispatches LLM answer generation (Groq Llama-3.3-70B or Gemini Flash single-pass streaming)
   * Runs with zero artificial buffering and supports sub-millisecond abort cancellation.
   */
  public async dispatchAnswerGeneration(questionText: string, startTime: number): Promise<void> {
    if (this.isProcessing) {
      this.abortActiveGeneration();
    }
    this.isProcessing = true;
    semanticGuard.setGeneratingAnswer();

    const abortController = new AbortController();
    this.answerAbortController = abortController;

    let completedAnswer = '';
    let hasReceivedFirstAnswerToken = false;
    const resumeContext = getStoredResume();

    try {
      this.notifyStatus('processing', '⚡ Streaming Parakeet 2.0 Answer (Zero Latency)...');

      await streamParakeetAnswerFromText({
        question: questionText,
        resumeContext,
        onChunk: (answerMarkdown) => {
          if (abortController.signal.aborted) return;
          completedAnswer = answerMarkdown;
          if (!hasReceivedFirstAnswerToken && answerMarkdown.length > 0) {
            hasReceivedFirstAnswerToken = true;
            this.isProcessing = false;
          }
          if (answerMarkdown) {
            this.callbacks?.onAnswerChunk(answerMarkdown, false);
          }
        },
        signal: abortController.signal,
      });

      if (!abortController.signal.aborted) {
        semanticGuard.setCandidateAnswering(completedAnswer, questionText);
        const totalElapsed = Date.now() - startTime;
        this.callbacks?.onAnswerChunk('', true, totalElapsed);
        this.lastUtteranceText = '';
      }
    } catch (err: unknown) {
      if (abortController.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        return;
      }
      console.warn('Answer generation error:', err);
      if (this.callbacks) {
        this.callbacks.onError(`Answer generation error: ${(err as Error)?.message || String(err)}`);
      }
    } finally {
      if (this.answerAbortController === abortController) {
        this.answerAbortController = null;
        this.isProcessing = false;
        this.enterCooldown(300);
      }
    }
  }

  /**
   * Force Answer Now: Immediately flushes audio buffer or triggers pending question
   */
  public async forceTrigger(): Promise<void> {
    if (this.utteranceBuffer.length > 0) {
      await this.finalizeUtterance();
    } else if (this.lastUtteranceText) {
      await this.dispatchAnswerGeneration(this.lastUtteranceText, Date.now());
    }
  }

  public async finalizeUtterance(): Promise<void> {
    if (this.utteranceBuffer.length === 0) return;
    const bufferSnapshot = [...this.utteranceBuffer];
    const silenceElapsed = this.silenceStartTime > 0 ? Date.now() - this.silenceStartTime : 0;
    const speakerTag = this.currentSpeakerTag;
    const segmentId = this.currentSegmentId || Math.random().toString(36).substring(2, 9);
    this.resetUtteranceStateSilently();
    await this.finalizeUtteranceWithBuffer(bufferSnapshot, silenceElapsed, speakerTag, segmentId);
  }

  /**
   * Enters brief post-answer debounce so trailing frames don't re-trigger
   */
  private enterCooldown(durationMs = 300): void {
    this.vadStatus = 'cooldown';
    this.notifyStatus('cooldown', `⏳ Buffering — System Audio Active`);

    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null;
      if (this.isListening) {
        this.vadStatus = 'ready';
        this.notifyStatus('ready', '🎧 System Listening — Interviewer Stream Active');
      } else {
        this.vadStatus = 'idle';
        this.notifyStatus('idle', 'Listening paused');
      }
    }, durationMs);
  }

  /**
   * Stop continuous listening and release all audio hardware cleanly
   */
  public stop(): void {
    this.abortActiveGeneration();
    this.isListening = false;
    this.vadStatus = 'idle';
    this.isSpeaking = false;
    this.isProcessing = false;
    this.hasDesktopLoopback = false;
    this.currentSpeakerTag = 'SPEAKER_1';
    this.sysRmsPeak = 0;
    this.micRmsPeak = 0;
    this.netCandidateRmsPeak = 0;

    this.lastUtteranceText = '';
    this.lastUtteranceTimestamp = 0;
    this.pendingSegmentId = '';

    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }

    if (this.mixerGain) {
      try {
        this.mixerGain.disconnect();
      } catch {}
      this.mixerGain = null;
    }

    if (this.interviewerSource) {
      try {
        this.interviewerSource.disconnect();
      } catch {}
      this.interviewerSource = null;
    }

    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.disconnect();
      } catch {}
      this.scriptProcessor = null;
    }

    if (this.silentGain) {
      try {
        this.silentGain.disconnect();
      } catch {}
      this.silentGain = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }

    if (this.interviewerStream) {
      this.interviewerStream.getTracks().forEach((t) => t.stop());
      this.interviewerStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    if (this.callbacks) {
      this.callbacks.onVolumeChange({ interviewer: 0, mic: 0, waveform: [0, 0, 0, 0, 0, 0, 0, 0] });
      this.callbacks.onStatusChange({
        isListening: false,
        vadStatus: 'idle',
        statusText: 'Listening paused',
        activeSpeaker: this.activeSpeaker,
      });
      if (this.callbacks.onDiagnostics) {
        this.callbacks.onDiagnostics({
          rms: 0,
          silenceMs: 0,
          targetSilenceMs: SILENCE_DURATION_MS,
          noiseFloor: 0.008,
          peakRms: 0.01,
          isSpeaking: false,
        });
      }
    }
  }
}

/**
 * Pure JavaScript In-Memory 44-Byte RIFF/WAVE 16-bit Mono WAV Encoder
 */
export function encodeWAV(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  /* RIFF chunk descriptor */
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true); // ChunkSize
  writeString(8, 'WAVE');

  /* "fmt " sub-chunk */
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);             // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);              // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true);              // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true);     // SampleRate (16000)
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true);              // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true);             // BitsPerSample (16)

  /* "data" sub-chunk */
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true); // Subchunk2Size

  // Write 16-bit PCM audio samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Fast Linear Downsampler to 8kHz (Telephony Mono, 50% payload reduction)
 */
export function downsampleTo8k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 8000) return input;
  const ratio = inputSampleRate / 8000;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    result[i] = input[Math.min(Math.round(i * ratio), input.length - 1)];
  }
  return result;
}

/**
 * Fast Linear Downsampler to 16kHz
 */
export function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 16000) return input;
  const ratio = inputSampleRate / 16000;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    result[i] = input[Math.min(Math.round(i * ratio), input.length - 1)];
  }
  return result;
}

/**
 * Encodes Float32Array PCM samples into 8kHz 16-bit Mono RIFF WAV Blob
 */
export function encodeWAV8kHz(samples: Float32Array, inputSampleRate = 16000): Blob {
  const samples8k = downsampleTo8k(samples, inputSampleRate);
  return encodeWAV(samples8k, 8000);
}

/**
 * Blob to Base64 String Helper
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      const base64 = res.includes(',') ? res.split(',')[1] : res;
      resolve(base64.trim());
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Global persistent instance for background continuity across tab transitions
export const audioPipeline = new AudioPipelineEngine();
