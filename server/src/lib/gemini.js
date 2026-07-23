import { config } from '../config.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

async function callGemini(prompt, { json = true } = {}) {
  if (!config.geminiApiKey) {
    const err = new Error('GEMINI_API_KEY is not set. Add it to exampro/.env to enable AI Studio.');
    err.status = 503;
    throw err;
  }
  const url = `${API}/${encodeURIComponent(config.geminiModel)}:generateContent?key=${config.geminiApiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    const err = new Error(`Gemini API error ${r.status}: ${detail.slice(0, 400)}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!json) return text;
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) return JSON.parse(m[1]);
    throw new Error('Gemini returned non-JSON output');
  }
}

/**
 * Generate MCQs + essay questions strictly from notes (PRD 4.9).
 * Returns { mcqs: [{text, options[4], correct_index, points, rationale}], essays: [{text, model_answer, points, rubric}] }
 */
export async function generateQuestionsFromNotes({ notesText, courseLabel, mcqCount, essayCount }) {
  const clipped = notesText.slice(0, 60000);
  const prompt = `You are an exam question author for the course "${courseLabel}".
Using ONLY the reference notes below, generate:
- ${mcqCount} multiple-choice questions with exactly 4 options, one clearly correct answer, and three plausible distractors drawn from the notes.
- ${essayCount} essay questions, each with a model answer derived from the notes and a short grading rubric.

Return STRICT JSON in this exact shape (no markdown fences):
{"mcqs":[{"text":"...","options":["...","...","...","..."],"correct_index":0,"points":2}],
 "essays":[{"text":"...","model_answer":"...","rubric":"...","points":10}]}
Every fact must come from the notes. Do not invent content.

REFERENCE NOTES:
${clipped}`;
  const out = await callGemini(prompt);
  return {
    mcqs: Array.isArray(out?.mcqs) ? out.mcqs : [],
    essays: Array.isArray(out?.essays) ? out.essays : [],
  };
}

/**
 * Grade an essay against the model answer/notes (PRD 4.9).
 * Returns { score, rationale } where 0 <= score <= points.
 */
export async function gradeEssayWithNotes({ question, modelAnswer, notesExcerpt, studentAnswer, points }) {
  const prompt = `You are grading a student's essay answer against reference material and a model answer.
Award a score from 0 to ${points} (decimals allowed). Base the grade only on correctness/completeness
relative to the reference material. Return STRICT JSON: {"score": 0.0, "rationale": "2-4 sentences"}.

QUESTION: ${question}

MODEL ANSWER:
${(modelAnswer || '').slice(0, 8000)}

REFERENCE NOTES EXCERPT:
${(notesExcerpt || '').slice(0, 12000)}

STUDENT ANSWER:
${(studentAnswer || '').slice(0, 12000)}`;
  const out = await callGemini(prompt);
  let score = Number(out?.score);
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(points, Math.round(score * 10) / 10));
  return { score, rationale: String(out?.rationale || '').slice(0, 2000) };
}
