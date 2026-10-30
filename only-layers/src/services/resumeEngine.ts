import { getGenAIClient, PRIMARY_MODEL } from './geminiLive';

const RESUME_STORAGE_KEY = 'only_layers_resume_text';
const JD_STORAGE_KEY = 'only_layers_jd_text';
const NOTES_STORAGE_KEY = 'only_layers_cheat_sheet_notes';

// High-speed In-Memory Cache for 0ms context grounding
let memoryResume: string = '';
let memoryJD: string = '';
let memoryNotes: string = '';

// Preload cache from localStorage on module initialization
try {
  memoryResume = localStorage.getItem(RESUME_STORAGE_KEY) || '';
  memoryJD = localStorage.getItem(JD_STORAGE_KEY) || '';
  memoryNotes = localStorage.getItem(NOTES_STORAGE_KEY) || '';
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
    memoryJD = localStorage.getItem(JD_STORAGE_KEY) || '';
  } catch {}
  return memoryJD;
}

export function setStoredJD(text: string): void {
  memoryJD = text;
  try {
    localStorage.setItem(JD_STORAGE_KEY, text);
  } catch {}
}

export function getStoredNotes(): string {
  if (memoryNotes) return memoryNotes;
  try {
    memoryNotes = localStorage.getItem(NOTES_STORAGE_KEY) || '';
  } catch {}
  return memoryNotes;
}

export function setStoredNotes(text: string): void {
  memoryNotes = text;
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, text);
  } catch {}
}

/**
 * Returns formatted candidate context instantaneously from RAM.
 * Injected into every Gemini prompt for Parakeet-speed grounded answers.
 */
export function getCachedInterviewContext(): string {
  const parts: string[] = [];
  const resume = getStoredResume().trim();
  const jd = getStoredJD().trim();
  const notes = getStoredNotes().trim();

  if (resume) {
    parts.push(`Candidate Resume Profile:\n${resume.slice(0, 3500)}`);
  }
  if (jd) {
    parts.push(`Target Job Spec:\n${jd.slice(0, 2500)}`);
  }
  if (notes) {
    parts.push(`Personal Notes & Cheat Sheet:\n${notes.slice(0, 1500)}`);
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
