import React, { useState } from 'react';
import {
  Award,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  Play,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  MessageSquare,
  BarChart3,
} from 'lucide-react';
import {
  generateInterviewDebrief,
  generateMockQuestion,
  streamQuickAnswer,
  PRIMARY_MODEL,
} from '../services/geminiLive';
import { getCachedInterviewContext } from '../services/resumeEngine';
import { TranscriptSegment } from '../services/audioPipeline';

interface MockDebriefProps {
  transcriptSegments?: TranscriptSegment[];
}

export const MockDebrief: React.FC<MockDebriefProps> = ({ transcriptSegments = [] }) => {
  const [subTab, setSubTab] = useState<'debrief' | 'mock'>('debrief');

  // Debrief State
  const [debriefOutput, setDebriefOutput] = useState('');
  const [isDebriefLoading, setIsDebriefLoading] = useState(false);
  const [debriefError, setDebriefError] = useState<string | null>(null);

  // Mock State
  const [selectedRole, setSelectedRole] = useState('Senior Full Stack Engineer');
  const [difficulty, setDifficulty] = useState('Senior');
  const [mockQuestion, setMockQuestion] = useState('');
  const [candidateResponse, setCandidateResponse] = useState('');
  const [mockCritique, setMockCritique] = useState('');
  const [isMockLoading, setIsMockLoading] = useState(false);
  const [mockError, setMockError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  const roles = [
    'Senior Full Stack Engineer',
    'Staff Distributed Systems Engineer',
    'Frontend / React Architect',
    'AI / ML Systems Engineer',
    'Engineering Manager / Behavioral',
  ];

  const handleRunDebrief = async () => {
    setDebriefError(null);
    setIsDebriefLoading(true);
    setDebriefOutput('');

    try {
      const fullTranscript =
        transcriptSegments.length > 0
          ? transcriptSegments
              .map((s) => `[${s.speaker === 'Interviewer' ? 'Interviewer' : 'Candidate'}]: ${s.text}`)
              .join('\n')
          : 'Candidate and interviewer discussed scaling a distributed key-value store with raft consensus and handling partition tolerance.';

      const resumeContext = getCachedInterviewContext();
      const output = await generateInterviewDebrief(fullTranscript, resumeContext);
      setDebriefOutput(output);
    } catch (err: unknown) {
      setDebriefError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDebriefLoading(false);
    }
  };

  const handleGenerateQuestion = async () => {
    setMockError(null);
    setIsMockLoading(true);
    setMockCritique('');
    setCandidateResponse('');

    try {
      const q = await generateMockQuestion(selectedRole, difficulty);
      setMockQuestion(q);
    } catch (err: unknown) {
      setMockError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsMockLoading(false);
    }
  };

  const handleEvaluateMockAnswer = async () => {
    if (!candidateResponse.trim()) {
      setMockError('Please enter or dictate your response first.');
      return;
    }

    setMockError(null);
    setIsMockLoading(true);
    setMockCritique('');

    try {
      const prompt = `You are an elite Tech Interview Evaluator.
Role: ${selectedRole} (${difficulty} level)
Question:
${mockQuestion}

Candidate's Answer:
"${candidateResponse}"

Provide a crisp, actionable critique:
1. 🏆 SCORE: [X/10]
2. ⭐ WHAT WAS STRONG: [1-2 sentences]
3. ⚠️ MISSING KEY ELEMENTS: [Specific technical depth or edge cases missed]
4. 💡 10/10 REFINED ANSWER: [Parakeet-style STAR formulation]`;

      await streamQuickAnswer({
        prompt,
        onChunk: (chunk) => setMockCritique(chunk),
      });
    } catch (err: unknown) {
      setMockError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsMockLoading(false);
    }
  };

  const handleCopy = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full space-y-2.5 overflow-hidden">
      {/* Sub-tab Navigation */}
      <div className="flex bg-black/40 p-1 rounded-xl border border-white/10 shrink-0">
        <button
          onClick={() => setSubTab('debrief')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            subTab === 'debrief'
              ? 'bg-indigo-600 text-white shadow-sm font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>Interview Debrief & Scorecard</span>
        </button>

        <button
          onClick={() => setSubTab('mock')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            subTab === 'mock'
              ? 'bg-indigo-600 text-white shadow-sm font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          <span>Mock Interview Practice</span>
        </button>
      </div>

      {/* Subtab 1: Post-Mortem Debrief */}
      {subTab === 'debrief' && (
        <div className="flex-1 flex flex-col space-y-2 overflow-hidden">
          <div className="flex items-center justify-between p-2 bg-black/30 rounded-lg border border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-xs text-slate-300">
                {transcriptSegments.length > 0
                  ? `${transcriptSegments.length} live segments recorded in session`
                  : 'Ready to evaluate session or demo transcript'}
              </span>
            </div>

            <button
              onClick={handleRunDebrief}
              disabled={isDebriefLoading}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
            >
              {isDebriefLoading ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              <span>Analyze & Score</span>
            </button>
          </div>

          {debriefError && (
            <div className="p-2 bg-rose-500/15 border border-rose-500/30 text-rose-300 rounded-lg text-xs shrink-0 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{debriefError}</span>
            </div>
          )}

          {/* Debrief Output Area */}
          <div className="flex-1 overflow-y-auto bg-black/35 rounded-xl border border-white/10 p-3 font-mono text-xs text-slate-200 leading-relaxed relative select-text">
            {isDebriefLoading && !debriefOutput && (
              <div className="flex flex-col items-center justify-center h-full py-8 text-indigo-400 space-y-2">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span className="text-xs font-sans">Synthesizing executive interview debrief via Gemini 3.8 Flash...</span>
              </div>
            )}

            {debriefOutput ? (
              <div>
                <div className="whitespace-pre-wrap font-sans text-xs">{debriefOutput}</div>
                <button
                  onClick={() => handleCopy(debriefOutput)}
                  className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 text-slate-300 rounded-md transition-colors"
                  title="Copy debrief"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            ) : (
              !isDebriefLoading && (
                <div className="flex flex-col items-center justify-center h-full py-8 text-slate-500 text-center space-y-1 select-none">
                  <BarChart3 className="w-6 h-6 text-slate-600" />
                  <p className="text-xs font-sans">
                    Click "Analyze & Score" to generate an executive scorecard of the session.
                  </p>
                  <p className="text-[10px] text-slate-600">
                    Evaluates technical precision, communication clarity, and missed edge cases.
                  </p>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Subtab 2: Mock Interview Simulator */}
      {subTab === 'mock' && (
        <div className="flex-1 flex flex-col space-y-2 overflow-hidden">
          {/* Controls Bar */}
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="flex-1 bg-black/40 text-xs text-slate-200 px-2 py-1.5 rounded-lg border border-white/10 focus:outline-none focus:border-indigo-500 font-sans"
            >
              {roles.map((r) => (
                <option key={r} value={r} className="bg-slate-900">
                  {r}
                </option>
              ))}
            </select>

            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="bg-black/40 text-xs text-slate-200 px-2 py-1.5 rounded-lg border border-white/10 focus:outline-none focus:border-indigo-500 font-sans"
            >
              <option value="Senior" className="bg-slate-900">Senior</option>
              <option value="Staff / Lead" className="bg-slate-900">Staff</option>
              <option value="Principal" className="bg-slate-900">Principal</option>
            </select>

            <button
              onClick={handleGenerateQuestion}
              disabled={isMockLoading}
              className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm transition-colors shrink-0"
            >
              {isMockLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              <span>New Question</span>
            </button>
          </div>

          {mockError && (
            <div className="p-2 bg-rose-500/15 border border-rose-500/30 text-rose-300 rounded-lg text-xs shrink-0 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{mockError}</span>
            </div>
          )}

          {/* Question Box */}
          {mockQuestion && (
            <div className="p-2.5 bg-indigo-950/20 border border-indigo-500/20 rounded-lg text-xs text-indigo-100 font-sans leading-relaxed shrink-0">
              <div className="text-[10px] uppercase font-mono tracking-wider text-indigo-400 font-semibold mb-1 flex items-center gap-1">
                <HelpCircle className="w-3 h-3" /> Practice Question
              </div>
              <div className="whitespace-pre-wrap">{mockQuestion}</div>
            </div>
          )}

          {/* Candidate Response Input & Critique */}
          <div className="flex-1 flex flex-col space-y-2 overflow-hidden">
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="text"
                value={candidateResponse}
                onChange={(e) => setCandidateResponse(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleEvaluateMockAnswer();
                  }
                }}
                placeholder="Type or paste your mock answer here..."
                className="flex-1 bg-black/40 text-xs text-slate-200 px-2.5 py-1.5 rounded-lg border border-white/10 focus:outline-none focus:border-indigo-500 placeholder-slate-600 font-sans"
              />
              <button
                onClick={handleEvaluateMockAnswer}
                disabled={isMockLoading || !candidateResponse.trim()}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm transition-colors shrink-0"
              >
                {isMockLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                <span>Grade Me</span>
              </button>
            </div>

            {/* Critique Display */}
            <div className="flex-1 overflow-y-auto bg-black/35 rounded-xl border border-white/10 p-3 font-mono text-xs text-slate-200 leading-relaxed relative select-text">
              {mockCritique ? (
                <div>
                  <div className="whitespace-pre-wrap font-sans text-xs">{mockCritique}</div>
                  <button
                    onClick={() => handleCopy(mockCritique)}
                    className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 text-slate-300 rounded-md transition-colors"
                    title="Copy critique"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ) : (
                !isMockLoading && (
                  <div className="flex flex-col items-center justify-center h-full py-6 text-slate-500 text-center space-y-1 select-none">
                    <Award className="w-5 h-5 text-slate-600" />
                    <p className="text-xs font-sans">
                      Select a role, click "New Question", and practice answering.
                    </p>
                    <p className="text-[10px] text-slate-600">
                      Gemini 3.8 Flash grades response quality and gives the 10/10 model answer.
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

