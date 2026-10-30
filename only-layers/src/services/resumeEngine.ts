import { getGenAIClient, PRIMARY_MODEL } from './geminiLive';

export const RESUME_STORAGE_KEY = 'only_layers_resume_text';
export const JD_STORAGE_KEY = 'only_layers_job_description';
export const LEGACY_JD_STORAGE_KEY = 'only_layers_jd_text';
export const CUSTOM_INSTRUCTIONS_KEY = 'only_layers_custom_instructions';
export const LEGACY_NOTES_STORAGE_KEY = 'only_layers_cheat_sheet_notes';

// High-speed In-Memory Cache for 0ms context grounding
let memoryResume: string = '';
let memoryJD: string = '';
let memoryCustomInstructions: string = '';

// Preload cache from localStorage on module initialization
try {
  memoryResume = localStorage.getItem(RESUME_STORAGE_KEY) || '';
  memoryJD = localStorage.getItem(JD_STORAGE_KEY) || localStorage.getItem(LEGACY_JD_STORAGE_KEY) || '';
  memoryCustomInstructions =
    localStorage.getItem(CUSTOM_INSTRUCTIONS_KEY) || localStorage.getItem(LEGACY_NOTES_STORAGE_KEY) || '';
} catch (e) {
  console.warn('Failed to initialize in-memory resume cache:', e);
}

export function getStoredResume(): string {
  if (memoryResume) return memoryResume;
  try {
    memoryResume = localStorage.getItem(RESUME_STORAGE_KEY) || '';
  } catch {}
  return memoryResume;
}

export function setStoredResume(text: string): void {
  memoryResume = text;
  try {
    localStorage.setItem(RESUME_STORAGE_KEY, text);
  } catch {}
}

export function getStoredJD(): string {
  if (memoryJD) return memoryJD;
  try {
    memoryJD = localStorage.getItem(JD_STORAGE_KEY) || localStorage.getItem(LEGACY_JD_STORAGE_KEY) || '';
  } catch {}
  return memoryJD;
}

export const getStoredJobDescription = getStoredJD;

export function setStoredJD(text: string): void {
  memoryJD = text;
  try {
    localStorage.setItem(JD_STORAGE_KEY, text);
    localStorage.setItem(LEGACY_JD_STORAGE_KEY, text);
  } catch {}
}

export const setStoredJobDescription = setStoredJD;

export function getStoredCustomInstructions(): string {
  if (memoryCustomInstructions) return memoryCustomInstructions;
  try {
    memoryCustomInstructions =
      localStorage.getItem(CUSTOM_INSTRUCTIONS_KEY) || localStorage.getItem(LEGACY_NOTES_STORAGE_KEY) || '';
  } catch {}
  return memoryCustomInstructions;
}

export function setStoredCustomInstructions(text: string): void {
  memoryCustomInstructions = text;
  try {
    localStorage.setItem(CUSTOM_INSTRUCTIONS_KEY, text);
    localStorage.setItem(LEGACY_NOTES_STORAGE_KEY, text);
  } catch {}
}

// Backwards-compatibility aliases for legacy cheat sheet notes
export const getStoredNotes = getStoredCustomInstructions;
export const setStoredNotes = setStoredCustomInstructions;

export const BASE_PARAKEET_PERSONA = `You are Parakeet AI 2.0, an elite real-time Staff/Principal Software Engineer & Executive Interview Copilot.
The candidate is in a live interview right now and will read your response out loud immediately.

CRITICAL QUALITY RULES:
1. NEVER give generic textbook fluff or vague 1-line summaries. Give concrete, senior-level, production-grade answers that make the candidate sound like a top 1% engineer.
2. Automatically weave in the candidate's Resume, Projects, and Tech Stack context whenever relevant.
3. Structure EVERY response in this exact scannable layout so the candidate can start speaking within 1 second:

🗣️ SAY THIS FIRST (VERBATIM SPOKEN HOOK)
"[Write a natural, confident, 2-to-3 sentence first-person spoken answer that directly answers the core question with high technical precision. Ground it immediately in candidate's real resume experience (e.g. 'In my work at [Company] building [Project]...'). The candidate will read this out loud word-for-word.]"

⚡ CORE TECHNICAL BREAKDOWN & TALKING POINTS
• **[Mechanism / Internal Architecture]**: Explain the exact internal mechanics, lifecycle, memory model, or protocol flow with specific technical terms.
• **[Production Application & Metrics]**: Tie it to real-world engineering (e.g., latency reduction, concurrency handling, scalability, or a project from the candidate's resume).
• **[Trade-offs & Edge Cases]**: State when to use it vs. alternatives, bottlenecks, and how to mitigate failure modes.

💻 CODE / COMPLEXITY / ARCHITECTURE SNIPPET (Include if technical/coding/system design; omit ONLY for pure HR questions)
\`\`\`[language]
// Clean, concise, production-ready code example, query, or architecture flow (8-15 lines max)
\`\`\`
Complexity / Key Metric: Time: O(...) | Space: O(...) (or System SLA / Throughput metric)

🎯 LIKELY FOLLOW-UP & 1-LINE COUNTER
• If they ask: "[Most probable follow-up question]" → Say: "[Sharp 1-sentence counter-answer]"`;

export const PARAKEET_SYSTEM_INSTRUCTION = BASE_PARAKEET_PERSONA;

/**
 * Dynamically builds a fully grounded system instruction prompt for Parakeet 2.0
 * Injects candidate resume profile, target job description, and custom instructions
 */
export function buildGroundedParakeetSystemPrompt(customResumeOverride?: string): string {
  const resume = (customResumeOverride !== undefined ? customResumeOverride : getStoredResume()).trim();
  const jd = getStoredJD().trim();
  const instructions = getStoredCustomInstructions().trim();

  const groundingBlocks: string[] = [];

  if (resume) {
    groundingBlocks.push(`--- CANDIDATE RESUME & PROFILE (GROUND EVERY ANSWER IN THESE REAL EXPERIENCES) ---
${resume.slice(0, 5000)}
CRITICAL: Whenever relevant, frame your answers using the candidate's actual projects, companies, tech stack, and achievements described above.`);
  }

  if (jd) {
    groundingBlocks.push(`--- TARGET JOB DESCRIPTION & ROLE REQUIREMENTS ---
${jd.slice(0, 3500)}
CRITICAL: Align technical depth, terminology, and prioritized concepts with this target role's expectations.`);
  }

  if (instructions) {
    groundingBlocks.push(`--- USER CUSTOM INSTRUCTIONS & PREFERENCES ---
${instructions.slice(0, 2500)}
CRITICAL: Strictly adhere to these candidate-defined behavioral rules, framing preferences, and constraints at all times.`);
  }

  if (groundingBlocks.length === 0) {
    return BASE_PARAKEET_PERSONA;
  }

  return `${BASE_PARAKEET_PERSONA}\n\n${groundingBlocks.join('\n\n')}`;
}

/**
 * Returns formatted candidate context instantaneously from RAM.
 * Injected into every Gemini / Groq prompt for Parakeet-speed grounded answers.
 */
export function getCachedInterviewContext(): string {
  const parts: string[] = [];
  const resume = getStoredResume().trim();
  const jd = getStoredJD().trim();
  const instructions = getStoredCustomInstructions().trim();

  if (resume) {
    parts.push(`Candidate Resume Profile:\n${resume.slice(0, 4000)}`);
  }
  if (jd) {
    parts.push(`Target Job Spec:\n${jd.slice(0, 3000)}`);
  }
  if (instructions) {
    parts.push(`User Custom Instructions & Preferences:\n${instructions.slice(0, 2000)}`);
  }

  return parts.join('\n\n');
}

export async function parseResumeFile(file: File): Promise<string> {
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith('.pdf')) {
    const arrayBuffer = await file.arrayBuffer();
    if (window.electronAPI?.parsePdf) {
      const byteArray = Array.from(new Uint8Array(arrayBuffer));
      const text = await window.electronAPI.parsePdf(byteArray);
      if (text && text.trim().length > 0) {
        return text;
      }
    }
    // Fallback: raw buffer decoded
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const raw = decoder.decode(arrayBuffer);
    const cleaned = raw.replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s+/g, ' ');
    return cleaned.slice(0, 5000);
  }

  // Text, Markdown or other documents
  return await file.text();
}

export interface SkillMatchResult {
  matchedSkills: string[];
  missingSkills: string[];
  matchScore: number;
}

export function extractKeywordMatch(resume: string, jd: string): SkillMatchResult {
  const resumeLower = resume.toLowerCase();
  const jdLower = jd.toLowerCase();

  const commonKeywords = [
    'react', 'typescript', 'javascript', 'python', 'java', 'c++', 'go', 'golang', 'rust',
    'sql', 'nosql', 'mongodb', 'postgresql', 'redis', 'kafka', 'graphql', 'rest',
    'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'ci/cd', 'terraform', 'git',
    'system design', 'microservices', 'distributed systems', 'concurrency', 'algorithms',
    'data structures', 'electron', 'next.js', 'node.js', 'express', 'tailwind', 'agile'
  ];

  const jdKeywords = commonKeywords.filter(k => jdLower.includes(k));
  if (jdKeywords.length === 0) {
    return {
      matchedSkills: [],
      missingSkills: [],
      matchScore: 100,
    };
  }

  const matched = jdKeywords.filter(k => resumeLower.includes(k));
  const missing = jdKeywords.filter(k => !resumeLower.includes(k));
  const matchScore = Math.round((matched.length / jdKeywords.length) * 100);

  return {
    matchedSkills: matched,
    missingSkills: missing,
    matchScore,
  };
}

export async function generateInterviewTalkingPoints(resume: string, jd: string): Promise<string> {
  const prompt = `You are an elite interview advisor.
Analyze the following Candidate Resume and Job Description (JD).
Provide 4 high-impact, tailored STAR (Situation, Task, Action, Result) talking points that directly showcase why this candidate is the ideal match for this role.
Keep the points punchy, confident, and conversational so the candidate can reference them mid-interview.

Candidate Resume:
${resume.slice(0, 4000)}

Job Description:
${jd.slice(0, 3000)}`;

  const apiKey = localStorage.getItem('only_layers_gemini_api_key') || '';

  if (window.electronAPI?.geminiGenerate && apiKey) {
    const res = await window.electronAPI.geminiGenerate({
      apiKey,
      prompt,
      model: PRIMARY_MODEL,
    });
    if (res.ok && res.text) {
      return res.text;
    }
    throw new Error(res.error || 'Failed to generate talking points.');
  }

  const ai = getGenAIClient();
  const response = await ai.models.generateContent({
    model: PRIMARY_MODEL,
    contents: prompt,
    config: {
      temperature: 0.2,
    },
  });

  return response.text || 'Unable to generate talking points.';
}
