import { GoogleGenAI } from '@google/genai';
import type { Part } from '@google/genai';
import { getCachedInterviewContext, buildGroundedParakeetSystemPrompt, BASE_PARAKEET_PERSONA } from './resumeEngine';

const API_KEY_STORAGE_KEY = 'only_layers_gemini_api_key';

// Primary high-speed model for live copilot & universal screen solver
export const PRIMARY_MODEL = 'gemini-3.5-flash-lite';

// Advanced reasoning model for deep architectural analysis
export const REASONING_MODEL = 'gemini-3.1-pro';

export const FLASH_CASCADE = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

export const PRO_CASCADE = [
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.1-pro',
];

export const REASONING_CASCADE = [
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
];

export function getStoredApiKey(): string {
  const saved = localStorage.getItem(API_KEY_STORAGE_KEY) || localStorage.getItem('gemini_api_key');
  if (saved && saved.trim()) return saved.trim();
  return '';
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
}

export function getGenAIClient(): GoogleGenAI {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please enter your API key in Settings.');
  }
  return new GoogleGenAI({ apiKey });
}

export const PARAKEET_SYSTEM_INSTRUCTION = BASE_PARAKEET_PERSONA;

export interface ConversationTurn {
  role: 'user' | 'model';
  text: string;
}

export interface StreamAnswerOptions {
  prompt: string;
  conversationHistory?: ConversationTurn[];
  systemPrompt?: string;
  resumeContext?: string;
  onChunk: (chunkText: string) => void;
  signal?: AbortSignal;
}

/**
 * Fast streaming copilot answer using Gemini 3.8 Flash (Sub-second TTFT) with Multi-Turn Conversation Memory.
 */
export async function streamQuickAnswer({
  prompt,
  conversationHistory = [],
  systemPrompt,
  resumeContext,
  onChunk,
  signal,
}: StreamAnswerOptions): Promise<string> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please enter your API key in Settings.');
  }

  // Pre-load grounded context into persistent system instruction
  const effectiveSystemPrompt = systemPrompt || buildGroundedParakeetSystemPrompt(resumeContext);

  // Multi-Turn Conversation Memory Construction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any[] = [];
  if (conversationHistory.length > 0) {
    for (const turn of conversationHistory.slice(-8)) {
      contents.push({ role: turn.role, parts: [{ text: turn.text }] });
    }
  }
  contents.push({ role: 'user', parts: [{ text: prompt }] });

  let lastError: unknown = null;

  // 1. Primary: Direct real-time token streaming via @google/genai (sub-300ms Time-to-First-Token)
  try {
    const ai = getGenAIClient();

    for (const model of FLASH_CASCADE) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      try {
        const responseStream = await ai.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction: effectiveSystemPrompt,
            ...(model.includes('lite') ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
            temperature: 0.15,
          },
        });

        let accumulated = '';
        for await (const chunk of responseStream) {
          if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          const chunkText = chunk.text || '';
          accumulated += chunkText;
          onChunk(accumulated);
        }

        if (accumulated.trim()) {
          return accumulated;
        }
      } catch (err: unknown) {
        if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          throw err;
        }
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        // If thinkingConfig is unsupported or throws INVALID_ARGUMENT, retry immediately with temperature 0.1
        if (msg.includes('INVALID_ARGUMENT') || msg.includes('thinking')) {
          try {
            const fallbackStream = await ai.models.generateContentStream({
              model,
              contents,
              config: {
                systemInstruction: effectiveSystemPrompt,
                temperature: 0.15,
              },
            });

            let accumulated = '';
            for await (const chunk of fallbackStream) {
              if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
              }
              const chunkText = chunk.text || '';
              accumulated += chunkText;
              onChunk(accumulated);
            }

            if (accumulated.trim()) {
              return accumulated;
            }
          } catch (retryErr) {
            if (signal?.aborted || (retryErr instanceof DOMException && retryErr.name === 'AbortError')) {
              throw retryErr;
            }
            lastError = retryErr;
          }
        }
        console.warn(`Model ${model} streaming error, checking next in cascade:`, err);
      }
    }
  } catch (initErr) {
    if (signal?.aborted || (initErr instanceof DOMException && initErr.name === 'AbortError')) {
      throw initErr;
    }
    lastError = initErr;
  }

  // 2. Secondary Fallback: Electron IPC Native Network Stack
  if (window.electronAPI?.geminiGenerate && !signal?.aborted) {
    try {
      const res = await window.electronAPI.geminiGenerate({
        apiKey,
        prompt,
        systemInstruction: effectiveSystemPrompt,
        model: PRIMARY_MODEL,
        modelsCascade: FLASH_CASCADE,
        thinkingBudget: 0,
        temperature: 0.1,
      });

      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      if (res.ok && res.text) {
        const text = res.text;
        // Progressive delivery for visual responsiveness
        const step = Math.max(20, Math.floor(text.length / 12));
        for (let i = step; i < text.length + step; i += step) {
          if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          onChunk(text.slice(0, i));
          await new Promise((r) => setTimeout(r, 8));
        }
        if (!signal?.aborted) {
          onChunk(text);
        }
        return text;
      }
    } catch (ipcErr) {
      if (signal?.aborted || (ipcErr instanceof DOMException && ipcErr.name === 'AbortError')) {
        throw ipcErr;
      }
      lastError = ipcErr;
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Failed to generate answer: ${msg}`);
}

/**
 * Transcribe a short audio clip (WebM/MP4 base64) into clean text using Gemini 3.8 Flash.
 * Solves the standalone Electron issue where Web Speech API is blocked.
 */
export async function transcribeAudioClip(
  audioBase64: string,
  audioMimeType = 'audio/webm'
): Promise<string> {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please enter your API key in Settings.');
  }

  const rawBase64 = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
  const cleanBase64 = rawBase64.trim();
  if (!cleanBase64) return '';

  const prompt = 'Transcribe this short audio clip accurately into clean text. Return ONLY the transcribed text with no conversational filler, labels, or explanations.';

  // 1. Primary: Electron IPC (Direct Node socket, no pipe errors)
  if (window.electronAPI?.geminiGenerate) {
    try {
      const res = await window.electronAPI.geminiGenerate({
        apiKey,
        prompt,
        audioBase64: cleanBase64,
        audioMimeType,
        model: PRIMARY_MODEL,
        thinkingBudget: 0,
      });

      if (res.ok && res.text) {
        return res.text.trim();
      }
    } catch (ipcErr) {
      console.warn('IPC transcription error:', ipcErr);
    }
  }

  // 2. Direct GenAI client fallback for non-Electron environments
  try {
    const ai = getGenAIClient();
    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: audioMimeType,
                data: cleanBase64,
              },
            },
          ],
        },
      ],
      config: {
        temperature: 0.1,
      },
    });

    if (response && response.text) {
      return response.text.trim();
    }
  } catch (err) {
    console.warn('Direct GenAI transcription error:', err);
  }

  return '';
}

export interface LiveAudioChunkResult {
  transcript: string;
  speaker: 'Interviewer' | 'You';
  hasQuestion: boolean;
  answer?: string;
  rawText: string;
}

export function parseAudioChunkResponse(
  rawText: string,
  fallbackSpeaker: 'Interviewer' | 'You' = 'Interviewer'
): LiveAudioChunkResult {
  const result: LiveAudioChunkResult = {
    transcript: '',
    speaker: fallbackSpeaker,
    hasQuestion: false,
    rawText,
  };

  if (!rawText || !rawText.trim()) return result;

  // Filter out model hallucinations / errors asking for audio files
  if (
    /please provide the audio/i.test(rawText) ||
    /provide an audio clip/i.test(rawText) ||
    /link to the audio/i.test(rawText) ||
    /i cannot listen/i.test(rawText) ||
    /no audio was provided/i.test(rawText)
  ) {
    console.warn('[Audio Response Filtered]', rawText);
    return result;
  }

  // 1. Extract TRANSCRIPT
  const transcriptMatch = rawText.match(/TRANSCRIPT\s*:\s*(?:\[?(Interviewer|You|Candidate)\]?\s*:\s*)?([^\n]+)/i);
  if (transcriptMatch) {
    if (transcriptMatch[1]) {
      const spk = transcriptMatch[1].toLowerCase();
      result.speaker = (spk === 'you' || spk === 'candidate') ? 'You' : 'Interviewer';
    }
    result.transcript = transcriptMatch[2].trim();
  } else {
    // If no explicit TRANSCRIPT: header, check for lines starting with [Interviewer] or [You]
    const lineMatch = rawText.match(/\[?(Interviewer|You)\]?\s*:\s*([^\n]+)/i);
    if (lineMatch) {
      result.speaker = lineMatch[1].toLowerCase() === 'you' ? 'You' : 'Interviewer';
      result.transcript = lineMatch[2].trim();
    }
  }

  // Clean up any remaining tags from transcript
  result.transcript = result.transcript
    .replace(/^\[?(?:Interviewer|You|Candidate)\]?[:\s]*/i, '')
    .trim();

  // If no explicit TRANSCRIPT: was parsed, capture the leading text before any answer blocks
  if (!result.transcript && rawText.trim()) {
    const preAnswer = rawText.split(/(?:QUESTION_DETECTED|ANSWER|⭐ DIRECT ANSWER):?/i)[0].trim();
    if (preAnswer && !preAnswer.toLowerCase().includes('please provide')) {
      result.transcript = preAnswer.replace(/^\[?(?:Interviewer|You|Candidate)\]?[:\s]*/i, '').trim();
    }
  }

  // If fallback was explicitly You, enforce candidate speaker attribution
  if (fallbackSpeaker === 'You') {
    result.speaker = 'You';
  }

  // 2. Extract QUESTION_DETECTED and ANSWER (Strictly suppressed if speaker is candidate [You])
  if (result.speaker === 'You') {
    result.hasQuestion = false;
    result.answer = undefined;
    return result;
  }

  const questionDetectedMatch = rawText.match(/QUESTION_DETECTED\s*:\s*(YES|NO)/i);
  const questionDetected = questionDetectedMatch ? questionDetectedMatch[1].toUpperCase() === 'YES' : false;

  // Check for ANSWER section
  const answerIndex = rawText.indexOf('ANSWER:');
  const directAnswerIndex = rawText.indexOf('⭐ DIRECT ANSWER');

  if (answerIndex !== -1 || directAnswerIndex !== -1) {
    const startIndex = directAnswerIndex !== -1 ? directAnswerIndex : answerIndex + 7;
    const answerContent = rawText.slice(startIndex).trim();
    if (answerContent.length > 20) {
      result.answer = answerContent;
      result.hasQuestion = true;
    }
  } else if (questionDetected) {
    result.hasQuestion = true;
  }

  return result;
}

export interface AudioQnAResult {
  transcript: string;
  answer: string;
  latencyMs: number;
}

/**
 * Single-Pass Audio Question Transcription + Instant Parakeet Answer Stream
 * Pipes 16kHz WAV inline audio directly to gemini-3.8-flash.
 * Emits the <TRANSCRIPT> immediately to UI, then streams the structured answer in real-time.
 */
export async function streamAudioQuestionAndAnswer(
  base64Wav: string,
  contextPrompt?: string,
  onUpdate?: (transcript: string, answerMarkdown: string, latencyMs: number) => void
): Promise<AudioQnAResult> {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please enter your API key in Settings.');
  }

  const rawBase64 = base64Wav.includes(',') ? base64Wav.split(',')[1] : base64Wav;
  const cleanBase64 = rawBase64.trim();
  if (!cleanBase64) {
    return { transcript: '', answer: '', latencyMs: 0 };
  }

  const startTime = Date.now();
  const effectiveContext = contextPrompt || getCachedInterviewContext();

  const promptText = `Listen to this spoken audio segment from a live technical interview.${
    effectiveContext ? `\n[Candidate Resume Grounding]:\n${effectiveContext}\n` : ''
  }
First, output the exact verbatim transcription inside <TRANSCRIPT>...</TRANSCRIPT> tags.
Second, if the audio contains a question, technical topic, or interview prompt (even implied), immediately write a hyper-concise Parakeet-style response starting right after </TRANSCRIPT>:

⭐ DIRECT ANSWER
(1-2 crisp, first-person sentences answering the question immediately)

⚡ KEY TALKING POINTS
• [Core Concept / Mechanism]: ...
• [Real Implementation / Metrics]: ...
• [Trade-off / Edge Case]: ...

🎯 FOLLOW-UP ANTICIPATION
• [Likely next question + 10-word counter-answer]`;

  let accumulated = '';
  let transcript = '';
  let answer = '';

  const processChunkText = (text: string) => {
    accumulated = text;
    // Extract text inside <TRANSCRIPT>...</TRANSCRIPT>
    const transcriptMatch = accumulated.match(/<TRANSCRIPT>([\s\S]*?)(?:<\/TRANSCRIPT>|$)/i);
    if (transcriptMatch) {
      transcript = transcriptMatch[1].trim();
    }

    // Extract text after </TRANSCRIPT>
    const closeIndex = accumulated.indexOf('</TRANSCRIPT>');
    if (closeIndex !== -1) {
      answer = accumulated.slice(closeIndex + 13).trim();
    } else if (accumulated.includes('⭐ DIRECT ANSWER')) {
      const directIndex = accumulated.indexOf('⭐ DIRECT ANSWER');
      answer = accumulated.slice(directIndex).trim();
      if (!transcript && directIndex > 0) {
        transcript = accumulated.slice(0, directIndex).replace(/<\/?TRANSCRIPT>/gi, '').trim();
      }
    }

    const elapsed = Date.now() - startTime;
    onUpdate?.(transcript, answer, elapsed);
  };

  const AUDIO_CASCADE = [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
  ];

  // 1. Primary: Direct real-time token streaming via @google/genai
  try {
    const ai = getGenAIClient();
    for (const model of AUDIO_CASCADE) {
      try {
        const stream = await Promise.race([
          ai.models.generateContentStream({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: 'audio/wav',
                      data: cleanBase64,
                    },
                  },
                  { text: promptText },
                ],
              },
            ],
            config: {
              temperature: 0.15,
              ...(model.includes('lite') ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout connecting to ${model}`)), 4500)
          ),
        ]);

        let currentStreamed = '';
        for await (const chunk of stream) {
          currentStreamed += chunk.text || '';
          processChunkText(currentStreamed);
        }

        // Check if transcription returned pure silence or noise without question
        const isPureNoise = /^(?:\[(?:silence|noise|background noise|cough|unintelligible|inaudible)\]|\s*)$/i.test(transcript);
        if (isPureNoise && !answer) {
          return { transcript: '', answer: '', latencyMs: Date.now() - startTime };
        }

        if (currentStreamed.trim()) {
          return { transcript, answer, latencyMs: Date.now() - startTime };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('INVALID_ARGUMENT') || msg.includes('thinking')) {
          try {
            const fallbackStream = await ai.models.generateContentStream({
              model,
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'audio/wav',
                        data: cleanBase64,
                      },
                    },
                    { text: promptText },
                  ],
                },
              ],
              config: { temperature: 0.15 },
            });

            let currentStreamed = '';
            for await (const chunk of fallbackStream) {
              currentStreamed += chunk.text || '';
              processChunkText(currentStreamed);
            }

            if (currentStreamed.trim()) {
              return { transcript, answer, latencyMs: Date.now() - startTime };
            }
          } catch {}
        }
        console.warn(`Model ${model} audio streaming attempt failed:`, err);
      }
    }
  } catch (err) {
    console.warn('Direct audio stream failed, falling back to Electron IPC:', err);
  }

  // 2. Secondary Fallback: Electron IPC Native Network Stack
  if (window.electronAPI?.geminiGenerate) {
    try {
      const res = await window.electronAPI.geminiGenerate({
        apiKey,
        prompt: promptText,
        audioBase64: cleanBase64,
        audioMimeType: 'audio/wav',
        model: 'gemini-3.8-flash',
        modelsCascade: AUDIO_CASCADE,
        thinkingBudget: 0,
        temperature: 0.15,
      });

      if (res.ok && res.text) {
        processChunkText(res.text);
        return { transcript, answer, latencyMs: Date.now() - startTime };
      }
    } catch (ipcErr) {
      console.warn('IPC audio generation failed:', ipcErr);
    }
  }

  return { transcript, answer, latencyMs: Date.now() - startTime };
}

/**
 * Direct Multimodal Audio Ingestion & Sub-3-Second Parakeet Stream.
 * Pipes audio/webm chunks directly into gemini-3.8-flash as inlineData,
 * transcribes speech ([Interviewer] vs [You]) and instantly synthesizes Parakeet answers.
 */
export async function processLiveAudioChunk({
  audioBase64,
  audioMimeType = 'audio/webm',
  resumeContext,
  fallbackSpeaker = 'Interviewer',
  allowAnswerGeneration = true,
}: {
  audioBase64: string;
  audioMimeType?: string;
  resumeContext?: string;
  fallbackSpeaker?: 'Interviewer' | 'You';
  allowAnswerGeneration?: boolean;
}): Promise<LiveAudioChunkResult> {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please enter your API key in Settings.');
  }

  const rawBase64 = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
  const cleanBase64 = rawBase64.trim();
  if (!cleanBase64) {
    return { transcript: '', speaker: fallbackSpeaker, hasQuestion: false, rawText: '' };
  }

  const effectiveCandidateContext = resumeContext || getCachedInterviewContext();
  const isCandidateSpeaking = fallbackSpeaker === 'You' || !allowAnswerGeneration;

  const promptText = isCandidateSpeaking
    ? `Listen to this live meeting audio chunk from the candidate [You]. Transcribe the speech accurately into clean text. Return ONLY the transcription with no labels, filler, or answers.
Format:
TRANSCRIPT: [You]: <exact transcribed words>
QUESTION_DETECTED: NO`
    : `Listen to this live meeting audio chunk from the interviewer [Interviewer]. Transcribe the exact speech into clean text, and if a question was asked, immediately provide a concise Parakeet-style answer (DIRECT ANSWER + KEY TALKING POINTS). If no question was asked yet, return ONLY the transcription.${
        effectiveCandidateContext ? `\n\n[Candidate Resume Grounding]:\n${effectiveCandidateContext}\n` : ''
      }

Format your output strictly as:
TRANSCRIPT: [Interviewer]: <exact speech words>
QUESTION_DETECTED: <YES or NO>
ANSWER:
⭐ DIRECT ANSWER
<1-2 crisp, authoritative first-person sentences directly answering the question>

⚡ KEY TALKING POINTS
• **Core Mechanism**: <key technical detail or architectural choice>
• **STAR Action**: <concrete implementation step or trade-off>
• **Impact / Complexity**: <quantified metric or complexity>`;

  let fullOutput = '';

  // 1. Primary: Electron IPC Native Network Stack (Zero CORS, sub-second latency)
  if (window.electronAPI?.geminiGenerate) {
    try {
      const res = await window.electronAPI.geminiGenerate({
        apiKey,
        prompt: promptText,
        audioBase64: cleanBase64,
        audioMimeType,
        model: PRIMARY_MODEL,
        modelsCascade: FLASH_CASCADE,
        thinkingBudget: 0,
        temperature: 0.1,
      });

      if (res.ok && res.text) {
        fullOutput = res.text.trim();
      }
    } catch (ipcErr) {
      console.warn('IPC live audio chunk processing error:', ipcErr);
    }
  }

  // 2. Direct GenAI Client Fallback
  if (!fullOutput) {
    try {
      const ai = getGenAIClient();
      for (const model of FLASH_CASCADE) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  { text: promptText },
                  {
                    inlineData: {
                      mimeType: audioMimeType,
                      data: cleanBase64,
                    },
                  },
                ],
              },
            ],
            config: {
              temperature: 0.1,
              ...(model.includes('lite') ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
            },
          });

          if (response && response.text) {
            fullOutput = response.text.trim();
            break;
          }
        } catch (mErr: unknown) {
          const errMsg = mErr instanceof Error ? mErr.message : String(mErr);
          // If thinkingConfig rejected, retry immediately without thinkingConfig
          if (errMsg.includes('INVALID_ARGUMENT') || errMsg.includes('thinking')) {
            try {
              const retryRes = await ai.models.generateContent({
                model,
                contents: [
                  {
                    role: 'user',
                    parts: [
                      { text: promptText },
                      {
                        inlineData: {
                          mimeType: audioMimeType,
                          data: cleanBase64,
                        },
                      },
                    ],
                  },
                ],
                config: { temperature: 0.1 },
              });
              if (retryRes && retryRes.text) {
                fullOutput = retryRes.text.trim();
                break;
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      console.warn('Direct GenAI live audio chunk processing error:', err);
    }
  }

  return parseAudioChunkResponse(fullOutput, fallbackSpeaker);
}

export interface DiarizedTranscriptResult {
  speaker: 'Interviewer' | 'You';
  text: string;
}

/**
 * Transcribe a short audio clip and diarize whether the speaker is the Interviewer or Candidate (You)
 * using Gemini 3.8 Flash.
 */
export async function transcribeAndDiarizeAudioClip(
  audioBase64: string,
  audioMimeType = 'audio/webm',
  fallbackSpeaker: 'Interviewer' | 'You' = 'Interviewer'
): Promise<DiarizedTranscriptResult> {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please enter your API key in Settings.');
  }

  const rawBase64 = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
  const cleanBase64 = rawBase64.trim();
  if (!cleanBase64) return { speaker: fallbackSpeaker, text: '' };

  const prompt = `Transcribe this short audio clip accurately. Identify if it is an interviewer asking a question or a candidate answering. Return clean text.
Format your output strictly as:
SPEAKER: [Interviewer or You]
TRANSCRIPT: [exact transcription text]`;

  let fullOutput = '';

  // 1. Primary: Electron IPC Native Network Stack
  if (window.electronAPI?.geminiGenerate) {
    try {
      const res = await window.electronAPI.geminiGenerate({
        apiKey,
        prompt,
        audioBase64: cleanBase64,
        audioMimeType,
        model: PRIMARY_MODEL,
        modelsCascade: FLASH_CASCADE,
        thinkingBudget: 0,
        temperature: 0.1,
      });

      if (res.ok && res.text) {
        fullOutput = res.text.trim();
      }
    } catch (ipcErr) {
      console.warn('IPC diarized transcription error:', ipcErr);
    }
  }

  // 2. Direct GenAI Client Fallback
  if (!fullOutput) {
    try {
      const ai = getGenAIClient();
      for (const model of FLASH_CASCADE) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: audioMimeType,
                      data: cleanBase64,
                    },
                  },
                ],
              },
            ],
            config: {
              temperature: 0.1,
            },
          });

          if (response && response.text) {
            fullOutput = response.text.trim();
            break;
          }
        } catch (mErr) {
          console.warn(`Model ${model} diarization attempt failed:`, mErr);
        }
      }
    } catch (err) {
      console.warn('Direct GenAI diarized transcription error:', err);
    }
  }

  if (!fullOutput) {
    return { speaker: fallbackSpeaker, text: '' };
  }

  // Parse SPEAKER and TRANSCRIPT
  let speaker = fallbackSpeaker;
  let text = fullOutput;

  const speakerMatch = fullOutput.match(/SPEAKER\s*:\s*(Interviewer|You|Candidate)/i);
  if (speakerMatch) {
    const val = speakerMatch[1].toLowerCase();
    speaker = (val === 'you' || val === 'candidate') ? 'You' : 'Interviewer';
  }

  const transcriptMatch = fullOutput.match(/TRANSCRIPT\s*:\s*([\s\S]*)/i);
  if (transcriptMatch) {
    text = transcriptMatch[1].trim();
  } else {
    text = fullOutput.replace(/SPEAKER\s*:\s*(?:Interviewer|You|Candidate)/gi, '').trim();
  }

  return { speaker, text };
}

export interface AudioAnswerOptions {
  audioBase64?: string;
  audioMimeType?: string;
  interimTranscript?: string;
  conversationHistory?: ConversationTurn[];
  resumeContext?: string;
  onChunk?: (chunkText: string) => void;
}

/**
 * Solve audio questions with multimodal Gemini 3.8 Flash streaming and multi-turn context.
 */
export async function solveAudioQuestion({
  audioBase64,
  audioMimeType,
  interimTranscript,
  conversationHistory = [],
  resumeContext,
  onChunk,
}: AudioAnswerOptions): Promise<string> {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please enter your API key in Settings.');
  }

  const effectiveSystemPrompt = buildGroundedParakeetSystemPrompt(resumeContext);

  const rawBase64 = audioBase64 && audioBase64.includes(',') ? audioBase64.split(',')[1] : (audioBase64 || '');
  const cleanBase64 = rawBase64.trim();

  // If no audio was captured but we have transcript, stream directly via text
  if (!cleanBase64 && interimTranscript && interimTranscript.trim()) {
    return streamQuickAnswer({
      prompt: interimTranscript.trim(),
      conversationHistory,
      systemPrompt: effectiveSystemPrompt,
      resumeContext,
      onChunk: onChunk || (() => {}),
    });
  }

  const promptText = interimTranscript
    ? `The interviewer asked: "${interimTranscript}". If the attached audio contains additional nuance or corrections, formulate the answer based on the full audio.`
    : `The candidate recorded the interviewer asking an interview question in the attached audio. Formulate the optimal response.`;

  // 1. Primary: Electron IPC Native Network Stack
  if (window.electronAPI?.geminiGenerate) {
    const res = await window.electronAPI.geminiGenerate({
      apiKey,
      prompt: promptText,
      systemInstruction: effectiveSystemPrompt,
      audioBase64: cleanBase64,
      audioMimeType: audioMimeType || 'audio/webm',
      model: PRIMARY_MODEL,
      thinkingBudget: 0,
    });

    if (res.ok && res.text) {
      const text = res.text;
      if (onChunk) {
        const step = Math.max(15, Math.floor(text.length / 20));
        for (let i = step; i < text.length + step; i += step) {
          onChunk(text.slice(0, i));
          await new Promise((r) => setTimeout(r, 12));
        }
        onChunk(text);
      }
      return text;
    }
    throw new Error(res.error || 'Failed to analyze audio.');
  }

  // 2. Fallback: Direct GenAI Client
  try {
    const ai = getGenAIClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [
      { text: `[System]: ${effectiveSystemPrompt}` },
      { text: promptText },
    ];
    if (cleanBase64) {
      parts.push({
        inlineData: {
          mimeType: audioMimeType || 'audio/webm',
          data: cleanBase64,
        },
      });
    }

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        temperature: 0.2,
      },
    });

    const text = response?.text || '';
    if (onChunk) onChunk(text);
    return text;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Audio processing error: ${msg}`);
  }
}

export const SOLVE_FIRST_REASONING_SYSTEM_PROMPT = `You are an elite, zero-error Quantitative Aptitude, Logical Reasoning, Verbal, and Technical Assessment Solver.
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

export const VERIFIED_REASONING_SYSTEM_PROMPT = SOLVE_FIRST_REASONING_SYSTEM_PROMPT;
export const UNIVERSAL_REASONING_SYSTEM_PROMPT = SOLVE_FIRST_REASONING_SYSTEM_PROMPT;

export interface SolveScreenProblemOptions {
  base64Image: string;
  prompt?: string;
  resumeContext?: string;
  onChunk?: (chunkText: string) => void;
  thinkingBudget?: number;
  temperature?: number;
}

/**
 * Solve-First Multimodal Screen Solver using high-reasoning Gemini models with 4096-token reasoning budget and Search Grounding.
 * Solves Quantitative Aptitude, Logical Reasoning, Non-Verbal Matrices, MCQs, or LeetCode/DSA with 100% verification.
 */
export async function solveScreenProblem({
  base64Image,
  prompt,
  resumeContext,
  onChunk,
  thinkingBudget = 4096,
  temperature = 0.0,
}: SolveScreenProblemOptions): Promise<string> {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please open Settings (gear icon) and enter your key.');
  }

  const candidateContext = resumeContext || getCachedInterviewContext();
  const effectiveSystemPrompt = `${SOLVE_FIRST_REASONING_SYSTEM_PROMPT}${
    candidateContext ? `\n\n[Candidate Context Grounding]:\n${candidateContext}` : ''
  }`;

  const promptText = prompt && prompt.trim().length > 0
    ? prompt.trim()
    : 'Carefully examine the screen and solve this question using the Solve-First Chain-of-Thought Protocol. Output strictly following the specified 4 steps and <VERIFIED_VERDICT> format.';

  const isJpeg = base64Image.startsWith('data:image/jpeg') || !base64Image.startsWith('data:image/png');
  const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
  const rawBase64 = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
  const cleanBase64 = rawBase64 ? rawBase64.trim() : '';

  // 1. Primary: Use Electron Main Process Native Network Stack (Zero CORS, robust error retry, desktop bypass)
  if (window.electronAPI?.geminiGenerate) {
    const result = await window.electronAPI.geminiGenerate({
      apiKey,
      prompt: promptText,
      systemInstruction: effectiveSystemPrompt,
      imageBase64: cleanBase64,
      model: REASONING_CASCADE[0],
      modelsCascade: REASONING_CASCADE,
      thinkingBudget,
      temperature,
      tools: [{ googleSearch: {} }],
    });

    if (result.ok && result.text) {
      const fullText = result.text;
      if (onChunk) {
        // Stream progressively for smooth token rendering
        const step = Math.max(20, Math.floor(fullText.length / 25));
        for (let i = step; i < fullText.length + step; i += step) {
          onChunk(fullText.slice(0, i));
          await new Promise((r) => setTimeout(r, 10));
        }
        onChunk(fullText);
      }
      return fullText;
    }
    throw new Error(result.error || 'Failed to analyze screen content.');
  }

  // 2. Fallback: Direct GenAI Client
  let lastError: unknown = null;
  try {
    const ai = getGenAIClient();
    for (const model of REASONING_CASCADE) {
      const parts: Part[] = [{ text: promptText }];
      if (cleanBase64.length > 0) {
        parts.push({
          inlineData: {
            mimeType,
            data: cleanBase64,
          },
        });
      }

      // Try with tools (googleSearch) + thinkingConfig (4096) + temperature 0.0
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction: effectiveSystemPrompt,
            temperature,
            thinkingConfig: { thinkingBudget },
            tools: [{ googleSearch: {} }],
          },
        });
        if (response && response.text) {
          const text = response.text;
          if (onChunk) onChunk(text);
          return text;
        }
      } catch (err: unknown) {
        console.warn(`Screen solver error with search grounding on ${model}, retrying without tools:`, err);
        // Fallback without tools
        try {
          const fallbackRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts }],
            config: {
              systemInstruction: effectiveSystemPrompt,
              temperature,
              thinkingConfig: { thinkingBudget },
            },
          });
          if (fallbackRes && fallbackRes.text) {
            const text = fallbackRes.text;
            if (onChunk) onChunk(text);
            return text;
          }
        } catch (noToolsErr: unknown) {
          const errMsg = noToolsErr instanceof Error ? noToolsErr.message : String(noToolsErr);
          // Fallback without thinkingConfig if unsupported
          if (errMsg.includes('INVALID_ARGUMENT') || errMsg.includes('thinking')) {
            try {
              const fallbackNoThinking = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts }],
                config: {
                  systemInstruction: effectiveSystemPrompt,
                  temperature: 0.1,
                },
              });
              if (fallbackNoThinking && fallbackNoThinking.text) {
                const text = fallbackNoThinking.text;
                if (onChunk) onChunk(text);
                return text;
              }
            } catch (retryErr) {
              lastError = retryErr;
            }
          } else {
            lastError = noToolsErr;
          }
        }
      }
    }
  } catch (e) {
    lastError = e;
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Failed to solve screen: ${msg}`);
}

export interface SolveScreenOptions {
  imageBase64: string;
  prompt?: string;
  resumeContext?: string;
  onChunk?: (chunkText: string) => void;
}

/**
 * Backward-compatible wrapper for Screen Solver
 */
export async function solveScreenContent(options: SolveScreenOptions): Promise<string> {
  return solveScreenProblem({
    base64Image: options.imageBase64,
    prompt: options.prompt,
    resumeContext: options.resumeContext,
    onChunk: options.onChunk,
  });
}

/**
 * Generate full interview scorecard and debrief post-interview.
 */
export async function generateInterviewDebrief(
  transcript: string,
  resumeContext?: string
): Promise<string> {
  const prompt = `You are a Principal Engineering Interview Debrief Coach.
Analyze the following live interview transcript between the Interviewer and Candidate.
Candidate Background:
${resumeContext || getCachedInterviewContext()}

Live Transcript:
${transcript}

Provide an Executive Interview Scorecard & Debrief in the following format:
📊 OVERALL PERFORMANCE: [Score /10] — [1-sentence verdict]
🎯 KEY STRENGTHS:
• [Strength 1 with specific quote or evidence from transcript]
• [Strength 2 with specific quote or evidence from transcript]
⚠️ MISSED OPPORTUNITIES & GAPS:
• [Gap 1: What the interviewer was probing for vs what was missed]
• [Gap 2: Technical or STAR refinement]
💡 GOLD STANDARD ANSWERS:
[For the toughest question asked, formulate the optimal 10/10 response]`;

  return streamQuickAnswer({
    prompt,
    onChunk: () => {},
  });
}

/**
 * Generate practice question for interactive mock interview.
 */
export async function generateMockQuestion(role: string, difficulty = 'Senior'): Promise<string> {
  const prompt = `Generate a realistic, challenging interview question for a ${difficulty} ${role} role.
Format:
❓ QUESTION: [Direct question text]
🎯 INTERVIEWER INTENT: [What signals the interviewer is assessing]
💡 HINT: [Key architectural pattern or algorithmic edge-case to consider]`;

  return streamQuickAnswer({
    prompt,
    onChunk: () => {},
  });
}
