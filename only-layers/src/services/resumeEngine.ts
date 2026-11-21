import { getGenAIClient, PRIMARY_MODEL } from './geminiLive';
import {
  RESUME_DOSSIER_KEY,
  DETECTED_PROJECTS_KEY,
  getStoredResumeDossier,
  setStoredResumeDossier,
  getStoredDetectedProjects,
  setStoredDetectedProjects,
  clearResumeDossier,
} from './resumeAnalyzer';

export const RESUME_STORAGE_KEY = 'only_layers_resume_text';
export const JD_STORAGE_KEY = 'only_layers_job_description';
export const LEGACY_JD_STORAGE_KEY = 'only_layers_jd_text';
export const CUSTOM_INSTRUCTIONS_KEY = 'only_layers_custom_instructions';
export const LEGACY_NOTES_STORAGE_KEY = 'only_layers_cheat_sheet_notes';
export { RESUME_DOSSIER_KEY, DETECTED_PROJECTS_KEY };
export { getStoredResumeDossier, setStoredResumeDossier, getStoredDetectedProjects, setStoredDetectedProjects, clearResumeDossier };

export function getStoredResume(): string {
  try {
    return localStorage.getItem(RESUME_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredResume(text: string): void {
  try {
    localStorage.setItem(RESUME_STORAGE_KEY, text);
  } catch {}
}

export function getStoredJD(): string {
  try {
    return localStorage.getItem(JD_STORAGE_KEY) || localStorage.getItem(LEGACY_JD_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export const getStoredJobDescription = getStoredJD;

export function setStoredJD(text: string): void {
  try {
    localStorage.setItem(JD_STORAGE_KEY, text);
    localStorage.setItem(LEGACY_JD_STORAGE_KEY, text);
  } catch {}
}

export const setStoredJobDescription = setStoredJD;

export function getStoredCustomInstructions(): string {
  try {
    return (
      localStorage.getItem(CUSTOM_INSTRUCTIONS_KEY) ||
      localStorage.getItem(LEGACY_NOTES_STORAGE_KEY) ||
      ''
    );
  } catch {
    return '';
  }
}

export function setStoredCustomInstructions(text: string): void {
  try {
    localStorage.setItem(CUSTOM_INSTRUCTIONS_KEY, text);
    localStorage.setItem(LEGACY_NOTES_STORAGE_KEY, text);
  } catch {}
}

// Backwards-compatibility aliases for legacy cheat sheet notes
export const getStoredNotes = getStoredCustomInstructions;
export const setStoredNotes = setStoredCustomInstructions;

export const BASE_PARAKEET_PERSONA = `You are whispering a direct, real-time spoken answer to a software engineer in a live interview. Max 2-3 short sentences, under 55 words total, first person, natural contractions, zero AI fluff.`;

export const PARAKEET_SYSTEM_INSTRUCTION = BASE_PARAKEET_PERSONA;

/**
 * Dynamically builds a strictly grounded system instruction prompt.
 * Always freshly reads latest Dossier, Raw Resume, Target JD, and Custom Instructions from localStorage.
 */
export function buildGroundedParakeetSystemPrompt(customResumeOverride?: string): string {
  const resumeDossier = getStoredResumeDossier().trim();
  const rawResumeText = (customResumeOverride !== undefined ? customResumeOverride : getStoredResume()).trim();
  const jobDescription = getStoredJD().trim();
  const customInstructions = getStoredCustomInstructions().trim();

  return `You are whispering a direct, real-time spoken answer to a software engineer in a live interview.

=== VERIFIED CANDIDATE DOSSIER (GROUND TRUTH) ===
${resumeDossier || rawResumeText || 'No resume uploaded.'}

=== TARGET ROLE ===
${jobDescription || 'Software Engineering / AI-ML Role'}
${customInstructions ? `\n=== CUSTOM INSTRUCTIONS ===\n${customInstructions}\n` : ''}
=== IRONCLAD RULES (NEVER VIOLATE) ===
1. MAXIMUM 2 TO 3 SHORT SENTENCES (UNDER 55 WORDS TOTAL):
   - Hit the exact answer in sentence 1. No intro fluff, no "That's a great question", no "In my experience", no concluding summary.
   - Write like a real person talking out loud—short, direct, natural contractions ("I used", "we didn't", "it's").
   - NEVER use AI words ("robust", "leverage", "utilize", "comprehensive", "furthermore", "moreover", "crucial", "effectively", "seamlessly").
2. STRICT RESUME GROUNDING:
   - For project/experience questions, ONLY mention exact tools and facts from the Candidate Dossier. Never invent technologies.
   - For situational questions, give a 1-sentence direct bridge to a real project from the dossier + 1-sentence outcome.
3. DIRECT TECHNICAL ANSWERS:
   - If asked a conceptual question, give the crisp definition/trade-off in 2 sentences max—no textbook lectures.

=== OUTPUT FORMAT ===
🗣️ SAY THIS:
[2 to 3 short, direct spoken sentences. Plain text only. No bullets, no bolding, no heavy paragraphs.]

⚡ CUES:
- [3–4 word metric/tech from resume]
- [3–4 word trade-off or follow-up]`;
}

export const STRICT_RESUME_GROUNDED_PROMPT = buildGroundedParakeetSystemPrompt();

/**
 * Returns formatted candidate context instantaneously from fresh localStorage.
 * Injected into every Gemini / Groq prompt for Parakeet-speed grounded answers.
 */
export function getCachedInterviewContext(): string {
  const parts: string[] = [];
  const resumeDossier = getStoredResumeDossier().trim();
  const resume = getStoredResume().trim();
  const jd = getStoredJD().trim();
  const instructions = getStoredCustomInstructions().trim();

  if (resumeDossier) {
    parts.push(`Candidate Dossier (Verified Ground Truth):\n${resumeDossier}`);
  } else if (resume) {
    parts.push(`Candidate Resume Profile:\n${resume.slice(0, 5000)}`);
  }
  if (jd) {
    parts.push(`Target Job Spec:\n${jd.slice(0, 3500)}`);
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
    let text = '';
    if (window.electronAPI?.parsePdf) {
      try {
        const byteArray = Array.from(new Uint8Array(arrayBuffer));
        text = await window.electronAPI.parsePdf(byteArray);
      } catch (e) {
        console.warn('Native PDF extraction failed:', e);
      }
    }

    // Verify if extracted text is valid and readable
    if (text && text.trim().length >= 30) {
      const printable = text.replace(/[^\x20-\x7E\t\n\r]/g, '');
      if (printable.length / text.length > 0.5) {
        return text.trim();
      }
    }

    // If PDF text extraction failed or returned garbled/empty text, throw a clear actionable error
    throw new Error(
      'PDF text extraction produced empty or unreadable text. Please copy and paste your resume text directly into the box below.'
    );
  }

  // Text, Markdown or other documents
  const content = await file.text();
  if (!content || content.trim().length === 0) {
    throw new Error('Uploaded file is empty. Please paste your resume text directly.');
  }
  return content;
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
