'use strict';
// Prompts, schemas and validation for analysing a problem photo and generating practice problems.
const { generateJson } = require('./gemini');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const VARIATIONS = ['new_context', 'different_unknown', 'extra_step'];
const problemSchema = {
  type: 'object',
  properties: {
    variation: { type: 'string', enum: VARIATIONS, description: 'how this problem differs from the original' },
    question: { type: 'string' }, answer: { type: 'string' }, explanation: { type: 'string' },
  },
  required: ['variation', 'question', 'answer', 'explanation'],
};
const analyzeSchema = {
  type: 'object',
  properties: {
    readable: { type: 'boolean', description: 'false if the image does not contain a legible problem' },
    language: { type: 'string', description: 'language of the problem, e.g. "en" or "zh"' },
    problemText: { type: 'string' },
    subject: { type: 'string' },
    topics: { type: 'array', items: { type: 'string' } },
    steps: { type: 'integer', minimum: 1, maximum: 20, description: 'number of distinct reasoning/calculation steps in a full solution' },
    difficultyReason: { type: 'string', description: 'one sentence applying the difficulty rubric' },
    difficulty: { type: 'integer', minimum: 1, maximum: 5 },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    solution: { type: 'string', description: 'short worked answer to the original problem' },
    practice: { type: 'array', items: problemSchema },
  },
  required: ['readable', 'language', 'problemText', 'subject', 'topics', 'steps', 'difficultyReason', 'difficulty', 'confidence', 'solution', 'practice'],
};
const practiceSchema = { type: 'object', properties: { practice: { type: 'array', items: problemSchema } }, required: ['practice'] };

const RULES = 'Write every field in the same language as the problem (Chinese problem -> Chinese, English -> English). ' +
  'Use plain text; write math inline like x^2 + 3x = 0 or sqrt(2). ' +
  'Practice problems must test the SAME core concept but must NOT be the original with only numbers or names swapped. ' +
  'Write exactly one of each variation type: ' +
  'new_context = a different real-world or abstract setting with different wording AND different numbers; ' +
  'different_unknown = give what the original asked for and ask for a quantity the original gave (work backwards), or ask a different question about the same situation; ' +
  'extra_step = the same concept plus one additional step or a closely related sub-skill. ' +
  'Do not reuse the original sentence structure. Each must have one correct answer and a 1-3 sentence explanation. Double-check every answer.';

const RUBRIC = 'Rate difficulty for a student at the level the problem is written for, using this rubric exactly: ' +
  '1 = direct recall or a single operation; ' +
  '2 = routine one-method exercise of 2-3 steps, like a textbook example; ' +
  '3 = standard test question: several steps (about 4+) or two linked parts/ideas; ' +
  '4 = non-routine: combines several concepts, needs planning or a trap must be avoided; ' +
  '5 = competition/olympiad level or long proof. ' +
  'First count the steps of a full solution, then pick the rubric level and justify it in difficultyReason.';

// Mask digits and Latin letters so "numbers/variables swapped only" copies look identical.
function shape(s) { return String(s).toLowerCase().replace(/[0-9]+(\.[0-9]+)?/g, '#').replace(/[a-z]+/g, (w) => (w.length <= 2 ? 'v' : w)).replace(/\s+/g, ''); }
function similarity(a, b) {
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(shape(a)), B = grams(shape(b)); let inter = 0, n = 0;
  for (const [g, c] of A) { inter += Math.min(c, B.get(g) || 0); n += c; } for (const c of B.values()) n += c;
  return n ? (2 * inter) / n : 1;
}
const MAX_SIMILARITY = 0.7;

function validateImage(body) {
  if (!body || typeof body.imageBase64 !== 'string' || !body.imageBase64) throw bad('imageBase64 is required');
  if (!MIME.has(body.mimeType)) throw bad('mimeType must be image/jpeg, image/png or image/webp');
  const b64 = body.imageBase64.replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw bad('imageBase64 is not valid base64');
  const bytes = Buffer.from(b64, 'base64').length;
  if (bytes === 0) throw bad('image is empty');
  if (bytes > MAX_IMAGE_BYTES) throw bad('image is larger than 5 MB');
  return { b64: b64.replace(/\s/g, ''), mimeType: body.mimeType };
}
function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }

// Drops problems that are near-copies of the original or of each other.
function cleanPractice(list, original = '') {
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || !p.question || !p.answer || out.length >= 3) continue;
    const q = String(p.question);
    if (original && similarity(q, original) > MAX_SIMILARITY) continue;
    if (out.some((o) => similarity(q, o.question) > MAX_SIMILARITY)) continue;
    out.push({ question: q, answer: String(p.answer), explanation: String(p.explanation || ''),
      variation: VARIATIONS.includes(p.variation) ? p.variation : '' });
  }
  return out;
}
function normalizeAnalysis(d) {
  if (!d || d.readable === false || !String(d.problemText || '').trim()) {
    throw Object.assign(new Error('Could not read a problem in this image. Try a sharper, well-lit photo of one problem.'), { status: 422, code: 'UNREADABLE' });
  }
  let difficulty = Math.min(5, Math.max(1, Math.round(Number(d.difficulty) || 3)));
  // Keep the score consistent with the rubric's step counts.
  const steps = Math.round(Number(d.steps)) || 0;
  if (steps >= 4) difficulty = Math.max(difficulty, 3);
  if (steps > 0 && steps <= 1) difficulty = Math.min(difficulty, 2);
  return {
    language: String(d.language || ''), problemText: String(d.problemText), subject: String(d.subject || 'Other'),
    topics: (Array.isArray(d.topics) ? d.topics : []).map(String).slice(0, 5), difficulty,
    confidence: ['high', 'medium', 'low'].includes(d.confidence) ? d.confidence : 'low',
    difficultyReason: String(d.difficultyReason || ''),
    solution: String(d.solution || ''), practice: cleanPractice(d.practice, d.problemText),
  };
}

async function analyzeImage(body) {
  const { b64, mimeType } = validateImage(body);
  const prompt = 'You are a tutor helping a student build a mistake notebook. Read the single homework/exam problem in this photo (any subject). ' +
    'Transcribe it exactly as problemText, classify its subject and 1-5 specific topics, give a short solution, rate difficulty, ' +
    'and write exactly 3 practice problems. If no legible problem is visible, set readable=false. ' + RUBRIC + ' ' + RULES;
  const { data, model } = await generateJson([{ inline_data: { mime_type: mimeType, data: b64 } }, { text: prompt }], analyzeSchema, { temperature: 0.2 });
  return { ...normalizeAnalysis(data), model };
}

async function morePractice(body) {
  const problemText = String(body?.problemText || '').trim();
  if (!problemText || problemText.length > 4000) throw bad('problemText is required (max 4000 chars)');
  const topics = (Array.isArray(body.topics) ? body.topics : []).map(String).slice(0, 5).join(', ');
  const prompt = `Original problem (subject: ${String(body.subject || '').slice(0, 60)}; topics: ${topics.slice(0, 300)}):\n${problemText}\n\n` +
    'Write exactly 3 NEW practice problems on the same concept, different from the original. ' + RULES;
  const { data, model } = await generateJson([{ text: prompt }], practiceSchema, { temperature: 0.7 });
  const practice = cleanPractice(data.practice, problemText);
  if (!practice.length) throw Object.assign(new Error('AI returned no practice problems, please try again'), { status: 502 });
  return { practice, model };
}

module.exports = { analyzeImage, morePractice, validateImage, normalizeAnalysis, cleanPractice, similarity, MAX_IMAGE_BYTES };
