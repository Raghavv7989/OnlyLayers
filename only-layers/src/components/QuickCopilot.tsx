import React, { useState } from 'react';
import { Send, Sparkles, Copy, Check, Zap, RefreshCw } from 'lucide-react';
import { streamQuickAnswer } from '../services/geminiLive';
import { getCachedInterviewContext } from '../services/resumeEngine';

export const QuickCopilot: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quickPrompts = [
    'Optimal LeetCode algorithm & complexity',
    'Explain how to scale this system to 100k QPS',
    'Refactor this code to O(n) time & O(1) space',
    'STAR answer for: Tell me about a technical challenge',
  ];

  const handleSend = async (customText?: string) => {
    const textToQuery = customText || prompt;
    if (!textToQuery.trim() || isLoading) return;

    setError(null);
    setIsLoading(true);
    setOutput('');

    try {
      const resume = getCachedInterviewContext();
      await streamQuickAnswer({
        prompt: textToQuery,
        resumeContext: resume,
        onChunk: (chunk) => {
          setOutput(chunk);
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!output) return;
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Quick Prompt Pills */}
      <div className="flex flex-wrap gap-1.5">
        {quickPrompts.map((qp, i) => (
          <button
            key={i}
            onClick={() => {
              setPrompt(qp);
              handleSend(qp);
            }}
            disabled={isLoading}
            className="text-[10px] bg-white/5 hover:bg-white/10 text-slate-300 px-2 py-1 rounded-md border border-white/10 transition-colors flex items-center gap-1 text-left"
          >
            <Sparkles className="w-2.5 h-2.5 text-indigo-400" />
            <span className="truncate max-w-[200px]">{qp}</span>
          </button>
        ))}
      </div>

      {/* Answer Output Area */}
      <div className="flex-1 overflow-y-auto bg-black/30 rounded-lg p-3 border border-white/5 font-mono text-xs text-slate-200 leading-relaxed min-h-[160px] max-h-[280px] relative">
        {isLoading && !output && (
          <div className="flex items-center gap-2 text-indigo-400 animate-pulse text-xs py-4 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Streaming Gemini 3.8 Flash response...</span>
          </div>
        )}

        {error && (
          <div className="p-2 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded text-xs mb-2">
            {error}
          </div>
        )}

        {output ? (
          <div className="whitespace-pre-wrap select-text">{output}</div>
        ) : (
          !isLoading && (
            <div className="text-slate-500 text-center py-8 text-xs select-none">
              Ask anything or select a quick prompt. Sub-300ms streaming copilot ready.
            </div>
          )
        )}

        {output && (
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 text-slate-300 rounded-md transition-colors"
            title="Copy answer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Input Bar */}
      <div className="flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend();
          }}
          placeholder="Ask a technical or algorithm question..."
          className="flex-1 bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
        <button
          onClick={() => handleSend()}
          disabled={isLoading || !prompt.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm shadow-indigo-500/30"
        >
          {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          <span>Send</span>
        </button>
      </div>
    </div>
  );
};
