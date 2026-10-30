/**
 * SemanticGuard 2.0 — Zero-Confusion Speaker Lock & Semantic Answer-Echo Suppression
 *
 * Core Capabilities:
 * 1. Strict Evaluation Hierarchy: Answer Vocabulary & Fuzzy Stem Footprint Lock ALWAYS runs FIRST.
 * 2. 2-Word Technical Term & 3-Gram Matcher: Direct phrase matching against displayed HUD answer.
 * 3. Low-Threshold Fuzzy Stem Overlap (>= 12%): 4-letter prefix stemming against HUD vocabulary.
 * 4. Candidate Framing Pattern Detection: Matches candidate declarative speech patterns at start of utterance.
 * 5. Strict Start-of-Utterance Question Classifier: NEVER matches mid-sentence "how" or "which".
 * 6. 3-Way Listening Guard Modes:
 *    - 'system_only': Listens ONLY to system output stream (SPEAKER_1). Physical mic is 100% ignored for question triggering.
 *    - 'smart_dual': 4-layer AEC + 12% stem overlap + Start-of-sentence question syntax.
 *    - 'manual_lock': Microphone question triggering paused while answer is displayed until user unlocks.
 */

export type ConversationState = 'AWAITING_QUESTION' | 'GENERATING_ANSWER' | 'CANDIDATE_ANSWERING';

export type SpeakerTag = 'SPEAKER_1' | 'SPEAKER_2' | 'SHARED_MIC';

export type ListeningGuardMode = 'smart_dual' | 'system_only' | 'manual_lock';

export interface SemanticClassification {
  isInterviewerQuestion: boolean;
  isCandidateSpeaking: boolean;
  isEchoOfAnswer: boolean;
  reason: string;
  speakerLabel: 'Interviewer' | 'You' | 'You — Speaking Answer' | 'You — Answering';
  score?: number;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'had',
  'are', 'was', 'were', 'will', 'would', 'could', 'should', 'about', 'into',
  'over', 'than', 'then', 'also', 'some', 'been', 'being', 'does', 'done',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'each', 'every', 'both', 'all', 'any', 'just', 'like', 'more', 'most',
  'other', 'such', 'only', 'same', 'too', 'very', 'can', 'may', 'might',
  'shall', 'there', 'their', 'them', 'they', 'here', 'your', 'ours', 'our'
]);

/**
 * Strict Start-of-Utterance Question Patterns (Only matches in first 1-4 words).
 * NEVER matches mid-sentence "how", "when", "which", etc.
 */
export const STRICT_INTERVIEWER_REGEX =
  /^(?:ok(?:ay)?|alright|great|nice|got it|makes sense|cool|so|now|next question|moving on|follow up)?[\s,:-]*(?:what|why|how|when|where|which|who|whose|can you|could you|would you|will you|do you|did you|have you|are you|is there|are there|tell me|explain|describe|walk me through|elaborate on|compare|contrast|differentiate|define|implement|write|design|architect|solve|suppose|imagine|let's say|if you had|give me an example)\b/i;

/**
 * Candidate speech framing and continuation patterns.
 */
export const CANDIDATE_FRAMING_REGEX =
  /^(?:so |and |but |because |basically |essentially |in my |for example |for instance |firstly |secondly |finally |also |that means |which means |this allows |we use |i used |i implemented |it works by |the reason is |to summarize |yes,? |yeah,? |sure,? |actually,? |as per |i think |i believe )/i;

const CANDIDATE_ANSWERING_TIMEOUT_MS = 45000; // 45-second persistent reading lock

export function get4LetterStem(word: string): string {
  return word.slice(0, 4).toLowerCase();
}

export function extractContentWords(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .replace(/[*#•⭐⚡🎯`_~>\[\]()\\\/]/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .toLowerCase();
  return cleaned
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * Direct 3-Gram Matcher (Consecutive 3 words in target text)
 */
export function has3GramMatch(transcriptText: string, targetText: string): boolean {
  if (!transcriptText || !targetText) return false;
  const rawWords = transcriptText
    .toLowerCase()
    .replace(/[*#•⭐⚡🎯`_~>\[\]()\\\/]/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (rawWords.length < 3) return false;

  const normalizedTarget = ` ${targetText
    .toLowerCase()
    .replace(/[*#•⭐⚡🎯`_~>\[\]()\\\/]/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;

  for (let i = 0; i <= rawWords.length - 3; i++) {
    const trigram = ` ${rawWords[i]} ${rawWords[i + 1]} ${rawWords[i + 2]} `;
    if (normalizedTarget.includes(trigram)) {
      return true;
    }
  }
  return false;
}

/**
 * Direct 2-Word Technical Phrase Matcher (Any 2 consecutive non-stopword terms)
 */
export function has2WordTechnicalMatch(transcriptText: string, targetText: string): boolean {
  if (!transcriptText || !targetText) return false;
  const transcriptWords = extractContentWords(transcriptText);
  if (transcriptWords.length < 2) return false;

  const targetWords = extractContentWords(targetText);
  if (targetWords.length < 2) return false;

  const targetBigrams = new Set<string>();
  for (let i = 0; i < targetWords.length - 1; i++) {
    targetBigrams.add(`${targetWords[i]} ${targetWords[i + 1]}`);
  }

  for (let i = 0; i < transcriptWords.length - 1; i++) {
    const bigram = `${transcriptWords[i]} ${transcriptWords[i + 1]}`;
    if (targetBigrams.has(bigram)) {
      return true;
    }
  }
  return false;
}

/**
 * Answer Vocabulary & Fuzzy Stem Footprint Lock (Runs FIRST!)
 */
export function isCandidateReadingOrParaphrasing(
  transcript: string,
  currentDisplayedAnswer: string,
  lastInterviewerQuestion = '',
  previousDisplayedAnswer = ''
): { isEcho: boolean; reason: string; score: number } {
  const text = transcript.trim();
  if (!text) {
    return { isEcho: false, reason: 'Empty transcript', score: 0 };
  }

  // 1. Candidate speech framing / continuation patterns
  if (CANDIDATE_FRAMING_REGEX.test(text)) {
    return {
      isEcho: true,
      reason: 'Candidate declarative speech framing pattern',
      score: 1.0,
    };
  }

  if (!currentDisplayedAnswer.trim() && !previousDisplayedAnswer.trim()) {
    return { isEcho: false, reason: 'No active HUD answer displayed', score: 0 };
  }

  // 2. Direct 3-Gram Match against displayed answer
  if (has3GramMatch(text, currentDisplayedAnswer)) {
    return {
      isEcho: true,
      reason: 'Direct consecutive 3-gram match with displayed HUD answer',
      score: 1.0,
    };
  }

  // 3. Direct 2-Word Technical Phrase Match
  if (has2WordTechnicalMatch(text, currentDisplayedAnswer)) {
    return {
      isEcho: true,
      reason: 'Direct 2-word technical phrase match with displayed HUD answer',
      score: 0.95,
    };
  }

  // Check previous displayed answer (if candidate is finishing previous point)
  if (previousDisplayedAnswer) {
    if (has3GramMatch(text, previousDisplayedAnswer)) {
      return {
        isEcho: true,
        reason: 'Consecutive 3-gram match with previous answer',
        score: 0.9,
      };
    }
    if (has2WordTechnicalMatch(text, previousDisplayedAnswer)) {
      return {
        isEcho: true,
        reason: '2-word technical phrase match with previous answer',
        score: 0.85,
      };
    }
  }

  // 4. Low-Threshold Fuzzy Stem Overlap (>= 12%)
  const transcriptWords = extractContentWords(text);
  if (transcriptWords.length >= 2) {
    const combinedTarget = [currentDisplayedAnswer, lastInterviewerQuestion, previousDisplayedAnswer].join(' ');
    const targetWords = extractContentWords(combinedTarget);
    const targetStems = new Set(targetWords.map(get4LetterStem));

    if (targetStems.size > 0) {
      let matchCount = 0;
      for (const word of transcriptWords) {
        if (targetStems.has(get4LetterStem(word))) {
          matchCount++;
        }
      }
      const stemOverlapRatio = matchCount / transcriptWords.length;
      if (stemOverlapRatio >= 0.12) {
        return {
          isEcho: true,
          reason: `${Math.round(stemOverlapRatio * 100)}% technical stem vocabulary overlap with HUD answer (threshold: 12%)`,
          score: stemOverlapRatio,
        };
      }
    }
  }

  return { isEcho: false, reason: 'No echo detected', score: 0 };
}

// Backward-compatible alias
export const isCandidateReadingAnswerAloud = (
  transcript: string,
  activeDisplayedAnswerText: string,
  lastQuestionText = '',
  history: string[] = []
): { isEcho: boolean; ratio: number; reason?: string } => {
  const prev = history.length > 0 ? history[0] : '';
  const res = isCandidateReadingOrParaphrasing(transcript, activeDisplayedAnswerText, lastQuestionText, prev);
  return { isEcho: res.isEcho, ratio: res.score, reason: res.reason };
};

export class SemanticGuard {
  private state: ConversationState = 'AWAITING_QUESTION';
  private listeningMode: ListeningGuardMode = 'smart_dual';
  private activeDisplayedAnswerText = '';
  private previousDisplayedAnswerText = '';
  private lastQuestionText = '';
  private answerHistory: string[] = [];
  private answeringTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<(state: ConversationState) => void> = new Set();
  private modeListeners: Set<(mode: ListeningGuardMode) => void> = new Set();

  public getState(): ConversationState {
    return this.state;
  }

  public getListeningMode(): ListeningGuardMode {
    return this.listeningMode;
  }

  public setListeningMode(mode: ListeningGuardMode): void {
    this.listeningMode = mode;
    this.modeListeners.forEach((cb) => {
      try {
        cb(mode);
      } catch {}
    });
  }

  public subscribeMode(listener: (mode: ListeningGuardMode) => void): () => void {
    this.modeListeners.add(listener);
    listener(this.listeningMode);
    return () => {
      this.modeListeners.delete(listener);
    };
  }

  public subscribe(listener: (state: ConversationState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyState(newState: ConversationState): void {
    this.state = newState;
    this.listeners.forEach((cb) => {
      try {
        cb(newState);
      } catch {}
    });
  }

  public setGeneratingAnswer(): void {
    if (this.answeringTimer) {
      clearTimeout(this.answeringTimer);
      this.answeringTimer = null;
    }
    this.notifyState('GENERATING_ANSWER');
  }

  public setCandidateAnswering(activeAnswerMarkdown: string, questionText?: string): void {
    if (this.answeringTimer) {
      clearTimeout(this.answeringTimer);
    }

    if (this.activeDisplayedAnswerText) {
      this.previousDisplayedAnswerText = this.activeDisplayedAnswerText;
      this.answerHistory.unshift(this.activeDisplayedAnswerText);
      if (this.answerHistory.length > 3) {
        this.answerHistory.pop();
      }
    }

    this.activeDisplayedAnswerText = activeAnswerMarkdown || '';
    if (questionText) {
      this.lastQuestionText = questionText;
    }

    this.notifyState('CANDIDATE_ANSWERING');

    // 45-second persistent guard while candidate reads
    this.answeringTimer = setTimeout(() => {
      this.unlockAwaitingQuestion();
    }, CANDIDATE_ANSWERING_TIMEOUT_MS);
  }

  public refreshCandidateAnsweringTimer(): void {
    if (this.state === 'CANDIDATE_ANSWERING') {
      if (this.answeringTimer) clearTimeout(this.answeringTimer);
      this.answeringTimer = setTimeout(() => {
        this.unlockAwaitingQuestion();
      }, CANDIDATE_ANSWERING_TIMEOUT_MS);
    }
  }

  public unlockAwaitingQuestion(): void {
    if (this.answeringTimer) {
      clearTimeout(this.answeringTimer);
      this.answeringTimer = null;
    }
    this.notifyState('AWAITING_QUESTION');
  }

  public getDisplayedAnswer(): string {
    return this.activeDisplayedAnswerText;
  }

  public getPreviousAnswer(): string {
    return this.previousDisplayedAnswerText;
  }

  public getLastQuestion(): string {
    return this.lastQuestionText;
  }

  /**
   * Evaluates an ASR-transcribed utterance in <5ms using strict evaluation hierarchy.
   */
  public evaluateUtterance(
    transcript: string,
    speakerTag: SpeakerTag,
    overrideMode?: ListeningGuardMode
  ): SemanticClassification {
    const text = transcript.trim();
    const mode = overrideMode || this.listeningMode;

    if (!text) {
      return {
        isInterviewerQuestion: false,
        isCandidateSpeaking: false,
        isEchoOfAnswer: false,
        reason: 'Empty transcript',
        speakerLabel: 'You',
      };
    }

    // =========================================================================
    // MODE 1: System Audio Only (100% Zero-Echo)
    // Physical microphone is COMPLETELY IGNORED for question triggering!
    // =========================================================================
    if (mode === 'system_only') {
      if (speakerTag !== 'SPEAKER_1') {
        return {
          isInterviewerQuestion: false,
          isCandidateSpeaking: true,
          isEchoOfAnswer: true,
          reason: '🎧 System Audio Only Mode: Physical mic is strictly ignored for question trigger',
          speakerLabel: 'You',
        };
      }
      return {
        isInterviewerQuestion: true,
        isCandidateSpeaking: false,
        isEchoOfAnswer: false,
        reason: '🎧 System Audio Loopback (SPEAKER_1)',
        speakerLabel: 'Interviewer',
      };
    }

    // =========================================================================
    // MODE 3: Manual Lock on Answer
    // Pauses microphone question triggering while HUD answer is shown
    // =========================================================================
    if (mode === 'manual_lock' && this.state === 'CANDIDATE_ANSWERING') {
      if (speakerTag === 'SPEAKER_1' && STRICT_INTERVIEWER_REGEX.test(text)) {
        return {
          isInterviewerQuestion: true,
          isCandidateSpeaking: false,
          isEchoOfAnswer: false,
          reason: 'Interviewer question detected via system loopback during manual lock',
          speakerLabel: 'Interviewer',
        };
      }
      this.refreshCandidateAnsweringTimer();
      return {
        isInterviewerQuestion: false,
        isCandidateSpeaking: true,
        isEchoOfAnswer: true,
        reason: '🔒 Manual Lock Active: Mic question triggering paused until manual unlock / Space',
        speakerLabel: 'You — Answering',
      };
    }

    // =========================================================================
    // HARDWARE DIARIZATION CHECK
    // =========================================================================
    if (speakerTag === 'SPEAKER_2') {
      return {
        isInterviewerQuestion: false,
        isCandidateSpeaking: true,
        isEchoOfAnswer: false,
        reason: 'Hardware DSP tagged as SPEAKER_2 (Physical Mic only)',
        speakerLabel: 'You',
      };
    }

    // =========================================================================
    // STEP A: Answer Vocabulary & Fuzzy Stem Footprint Lock (ALWAYS RUNS FIRST!)
    // Candidate readback detection runs BEFORE any question regex!
    // =========================================================================
    const echoResult = isCandidateReadingOrParaphrasing(
      text,
      this.activeDisplayedAnswerText,
      this.lastQuestionText,
      this.previousDisplayedAnswerText
    );

    if (echoResult.isEcho) {
      this.refreshCandidateAnsweringTimer();
      return {
        isInterviewerQuestion: false,
        isCandidateSpeaking: true,
        isEchoOfAnswer: true,
        reason: echoResult.reason,
        speakerLabel: 'You — Speaking Answer',
        score: echoResult.score,
      };
    }

    // =========================================================================
    // STEP B: Strict Start-of-Utterance Question Syntax Classifier
    // ONLY runs if isEcho === false! NEVER matches mid-sentence "how" or "which".
    // =========================================================================
    const hasStrictStartOfSentenceQuestion = STRICT_INTERVIEWER_REGEX.test(text);

    if (hasStrictStartOfSentenceQuestion) {
      return {
        isInterviewerQuestion: true,
        isCandidateSpeaking: false,
        isEchoOfAnswer: false,
        reason: 'Strict start-of-utterance interviewer question syntax detected',
        speakerLabel: 'Interviewer',
      };
    }

    // Pure Hardware System Loopback (SPEAKER_1)
    if (speakerTag === 'SPEAKER_1') {
      return {
        isInterviewerQuestion: true,
        isCandidateSpeaking: false,
        isEchoOfAnswer: false,
        reason: 'Hardware DSP tagged as SPEAKER_1 (System Audio loopback)',
        speakerLabel: 'Interviewer',
      };
    }

    // =========================================================================
    // STATE-BASED DEFAULTS
    // =========================================================================
    if (this.state === 'CANDIDATE_ANSWERING') {
      this.refreshCandidateAnsweringTimer();
      return {
        isInterviewerQuestion: false,
        isCandidateSpeaking: true,
        isEchoOfAnswer: false,
        reason: 'Candidate declarative speech during CANDIDATE_ANSWERING lock',
        speakerLabel: 'You — Answering',
      };
    }

    // In AWAITING_QUESTION state:
    if (text.endsWith('?')) {
      return {
        isInterviewerQuestion: true,
        isCandidateSpeaking: false,
        isEchoOfAnswer: false,
        reason: 'Interrogative question ending with question mark in awaiting state',
        speakerLabel: 'Interviewer',
      };
    }

    return {
      isInterviewerQuestion: true,
      isCandidateSpeaking: false,
      isEchoOfAnswer: false,
      reason: 'Default incoming question prompt in awaiting question state',
      speakerLabel: 'Interviewer',
    };
  }
}

// Global persistent singleton instance
export const semanticGuard = new SemanticGuard();
export default semanticGuard;
