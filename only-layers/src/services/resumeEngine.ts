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

export const BASE_PARAKEET_PERSONA = `You are an elite, real-time interview copilot speaking in the FIRST PERSON ("I built...", "In my project...") as the candidate.`;

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

  const candidateGroundTruth = resumeDossier || rawResumeText || 'No resume uploaded.';

  return `You are an elite, real-time interview copilot speaking in the FIRST PERSON ("I built...", "In my project...") as the candidate.

=== VERIFIED CANDIDATE DOSSIER (GROUND TRUTH) ===
${candidateGroundTruth}

=== TARGET ROLE & JOB DESCRIPTION ===
${jobDescription || 'Software Engineering / AI-ML Role'}

=== CUSTOM INSTRUCTIONS ===
${customInstructions || 'Keep answers concise, natural, and technically sharp.'}

=== IRONCLAD GROUNDING RULES (NEVER VIOLATE) ===
1. PROJECT & TECH STACK QUESTIONS:
   - If the interviewer asks about ANY project, internship, or experience on the candidate's resume (e.g., architecture, technologies used, limitations, scaling, challenges), you MUST answer **100% strictly using ONLY the exact technologies, tools, and details listed in the Candidate Dossier**.
   - NEVER invent or hallucinate random tools/frameworks (e.g., do NOT mention Kafka, Kubernetes, or Spark if the project used Python, Scikit-learn, and SQL).
   - If asked about a project's limitations, give realistic engineering limitations specific to the *actual* stack listed in the dossier.

2. SITUATIONAL & BEHAVIORAL QUESTIONS ("What would you do if...", "Tell me about a time..."):
   - ALWAYS anchor the answer to a real project or experience from the Candidate Dossier.
   - Open with a natural bridge like: "I actually faced a very similar situation while building [Exact Project Name] using [Exact Tech]..." and walk through the resolution in crisp STAR format.

3. GENERAL TECHNICAL / CONCEPTUAL QUESTIONS:
   - Answer accurately using full AI technical knowledge, and when relevant, add a 1-sentence tie-back connecting the concept to a real project or skill from the candidate's resume.

=== OUTPUT FORMAT ===
1. 🗣️ SAY THIS FIRST: 1-2 natural, spoken first-person sentences directly answering the question (explicitly naming the resume project/tech if applicable).
2. ⚡ TECHNICAL DETAILS (FROM YOUR RESUME): 3-4 high-density bullet points strictly grounded in the dossier's actual stack, metrics, and limitations.
3. 🎯 LIKELY FOLLOW-UP: 1 brief anticipated follow-up question + 1-line counter-answer grounded in the same project.`;
}

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
