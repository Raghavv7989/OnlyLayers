/**
 * ResumeAnalyzer — Pre-Interview Dossier Extraction & Anti-Hallucination Indexer
 * 
 * Extracts a dense, structured Candidate Dossier (exact projects, verified tech stack,
 * realistic limitations, and STAR behavioral hooks) to eliminate AI hallucinations.
 */

import { getStoredGroqApiKey, hasGroqApiKey } from './groqEngine';
import { getStoredApiKey, PRIMARY_MODEL, getGenAIClient } from './geminiLive';

export const RESUME_DOSSIER_KEY = 'only_layers_resume_dossier';
export const DETECTED_PROJECTS_KEY = 'only_layers_detected_projects';
export const RESUME_STORAGE_KEY = 'only_layers_resume_text';
export const JD_STORAGE_KEY = 'only_layers_job_description';
export const CUSTOM_INSTRUCTIONS_KEY = 'only_layers_custom_instructions';

export interface ResumeDossierResult {
  dossierMarkdown: string;
  detectedProjects: string[];
}

export function getStoredResumeDossier(): string {
  try {
    return localStorage.getItem(RESUME_DOSSIER_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredResumeDossier(dossier: string): void {
  try {
    localStorage.setItem(RESUME_DOSSIER_KEY, dossier);
  } catch {}
}

export function getStoredDetectedProjects(): string[] {
  try {
    const raw = localStorage.getItem(DETECTED_PROJECTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((p) => String(p).trim())
          .filter((p) => p.length > 0);
      }
    }
  } catch {}
  return [];
}

export function setStoredDetectedProjects(projects: string[]): void {
  try {
    localStorage.setItem(DETECTED_PROJECTS_KEY, JSON.stringify(projects));
  } catch {}
}

export function clearResumeDossier(): void {
  try {
    localStorage.removeItem(RESUME_DOSSIER_KEY);
    localStorage.removeItem(DETECTED_PROJECTS_KEY);
  } catch {}
}

export const RESUME_ANALYZER_SYSTEM_PROMPT = `You are an expert technical interviewer and executive talent assessor.
Analyze the following candidate resume and target job description to create a comprehensive, dense, zero-hallucination CANDIDATE DOSSIER for real-time interview grounding.

STRICT ACCURACY RULES:
1. ONLY include technologies, libraries, tools, and databases that are EXPLICITLY stated in the candidate's resume.
2. NEVER extrapolate or invent modern tools (e.g., if a project mentions Python and Scikit-learn, do NOT add Kafka, Kubernetes, Docker, or AWS unless explicitly stated).
3. For EVERY project mentioned on the resume:
   - Extract the exact project name.
   - List ONLY the tools explicitly mentioned for that project.
   - Formulate realistic engineering trade-offs and limitations grounded strictly in the actual stack used.
   - Formulate a 1-line situational/conflict/STAR hook for that project (e.g., debugging, latency bottleneck, data pipeline issue, memory leak).
4. Extract all verified work experience/internships and skills.

OUTPUT FORMAT SPECIFICATION:
First, output the detected project titles inside <DETECTED_PROJECTS>...</DETECTED_PROJECTS> tags as a valid JSON array of strings:
<DETECTED_PROJECTS>
["Exact Project Name 1", "Exact Project Name 2"]
</DETECTED_PROJECTS>

Followed immediately by this exact Markdown structure:
### CANDIDATE PROFILE & VERIFIED SKILLS
- **Programming Languages:** [Only verified languages]
- **Frameworks & Libraries:** [Only verified frameworks]
- **Databases & Storage:** [Only verified databases]
- **Cloud & DevOps:** [Only verified tools]

### PROJECT-BY-PROJECT TECHNICAL BREAKDOWN
For EVERY project on the resume:
- **Project Name:** [Exact Name]
- **Exact Tech Stack Used:** [ONLY tools/libraries explicitly mentioned for this project]
- **Core Architecture & What Was Built:** [Concise, factual 1-2 sentence engineering summary]
- **Key Engineering Trade-offs & Limitations:** [Realistic limitations grounded strictly in the actual stack used]
- **Situational / STAR Hook:** [1-sentence conflict, performance bottleneck, or scaling challenge tied to this project]

### WORK EXPERIENCE & INTERNSHIPS
- **[Company Name]** — [Role] ([Duration])
  - Exact Tech Used: [Tools]
  - Key Engineering Impact: [Metrics, achievements, scaling]`;

/**
 * Extracts detected project titles from LLM output using both JSON block and regex fallback.
 */
export function extractDetectedProjects(text: string): string[] {
  const projects: string[] = [];

  // 1. Try to extract from <DETECTED_PROJECTS>...</DETECTED_PROJECTS>
  const tagMatch = text.match(/<DETECTED_PROJECTS>([\s\S]*?)<\/DETECTED_PROJECTS>/i);
  if (tagMatch) {
    try {
      const parsed = JSON.parse(tagMatch[1].trim());
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string' && item.trim().length > 0) {
            projects.push(item.trim());
          }
        }
      }
    } catch {
      // If JSON parse fails, split by quotes/lines
      const items = tagMatch[1].split(/[\n,]/);
      for (const item of items) {
        const clean = item.replace(/[\[\]"']/g, '').trim();
        if (clean.length > 1 && !clean.toLowerCase().includes('exact project')) {
          projects.push(clean);
        }
      }
    }
  }

  // 2. Regex scan for "- **Project Name:**" or "**Project Name:**"
  const projectRegex = /(?:-\s*)?\*\*Project Name:\*\*\s*([^\n\r]+)/gi;
  let match;
  while ((match = projectRegex.exec(text)) !== null) {
    const rawName = match[1].replace(/^[\["`']+|[\]"`']+$/g, '').trim();
    if (
      rawName &&
      !rawName.toLowerCase().includes('[exact') &&
      !projects.includes(rawName)
    ) {
      projects.push(rawName);
    }
  }

  return projects;
}

/**
 * Strips XML tags from LLM output to produce clean Markdown for storage and inspection.
 */
export function cleanDossierMarkdown(text: string): string {
  return text
    .replace(/<DETECTED_PROJECTS>[\s\S]*?<\/DETECTED_PROJECTS>/gi, '')
    .trim();
}

/**
 * Analyzes and indexes raw resume text into a structured, zero-hallucination Candidate Dossier.
 * Cascades: Groq Llama-3.3-70B (Fast) -> Gemini Flash (Reliable).
 */
export async function analyzeAndIndexResume(
  rawResumeText: string,
  jobDescription: string = ''
): Promise<ResumeDossierResult> {
  const cleanResume = rawResumeText.trim();
  if (!cleanResume || cleanResume.length < 20) {
    throw new Error(
      'Resume text is empty or too short. Please upload a valid resume or paste the text directly.'
    );
  }

  const prompt = `Candidate Resume:\n${cleanResume.slice(0, 8000)}\n\nTarget Job Description:\n${(
    jobDescription || 'Software Engineering / AI-ML Role'
  ).slice(0, 4000)}`;

  let rawOutput = '';

  // 1. Try Groq (Llama-3.3-70b-versatile) for lightning fast indexer
  if (hasGroqApiKey()) {
    const groqKey = getStoredGroqApiKey();
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groqKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.1,
          max_tokens: 2500,
          messages: [
            { role: 'system', content: RESUME_ANALYZER_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        rawOutput = data.choices?.[0]?.message?.content || '';
      } else {
        console.warn('[ResumeAnalyzer] Groq resume indexing failed, falling back to Gemini:', await res.text());
      }
    } catch (err) {
      console.warn('[ResumeAnalyzer] Groq resume indexing network error, falling back to Gemini:', err);
    }
  }

  // 2. Fallback to Gemini if Groq was not used or failed
  if (!rawOutput) {
    const geminiKey = getStoredApiKey();
    if (!geminiKey && !hasGroqApiKey()) {
      throw new Error(
        'Please configure a valid Groq or Gemini API key in Settings or the Context tab before indexing.'
      );
    }

    if (geminiKey) {
      if (window.electronAPI?.geminiGenerate) {
        const res = await window.electronAPI.geminiGenerate({
          apiKey: geminiKey,
          prompt: `${RESUME_ANALYZER_SYSTEM_PROMPT}\n\n${prompt}`,
          model: PRIMARY_MODEL,
        });
        if (res.ok && res.text) {
          rawOutput = res.text;
        } else {
          throw new Error(res.error || 'Gemini indexing generation failed.');
        }
      } else {
        const ai = getGenAIClient();
        const response = await ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: prompt,
          config: {
            systemInstruction: RESUME_ANALYZER_SYSTEM_PROMPT,
            temperature: 0.1,
          },
        });
        rawOutput = response.text || '';
      }
    }
  }

  if (!rawOutput.trim()) {
    throw new Error(
      'LLM returned an empty response. Please check your API key and connection and try again.'
    );
  }

  const detectedProjects = extractDetectedProjects(rawOutput);
  const cleanDossier = cleanDossierMarkdown(rawOutput);

  // Store in localStorage
  setStoredResumeDossier(cleanDossier);
  setStoredDetectedProjects(detectedProjects);

  return {
    dossierMarkdown: cleanDossier,
    detectedProjects,
  };
}
