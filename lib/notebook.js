'use strict';
// Prompts, schemas and validation for analysing a problem photo and generating practice problems.
const { generateJson } = require('./gemini');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const problemSchema = {
  type: 'object',
  properties: { question: { type: 'string' }, answer: { type: 'string' }, explanation: { type: 'string' } },
  required: ['question', 'answer', 'explanation'],
};
const analyzeSchema = {
  type: 'object',
  properties: {
    readable: { type: 'boolean', description: 'false if the image does not contain a legible problem' },
    language: { type: 'string', description: 'language of the problem, e.g. "en" or "zh"' },
    problemText: { type: 'string' },
    subject: { type: 'string' },
    topics: { type: 'array', items: { type: 'string' } },
    difficulty: { type: 'integer', minimum: 1, maximum: 5 },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    solution: { type: 'string', description: 'short worked answer to the original problem' },
    practice: { type: 'array', items: problemSchema },
  },
  required: ['readable', 'language', 'problemText', 'subject', 'topics', 'difficulty', 'confidence', 'solution', 'practice'],
};
const practiceSchema = { type: 'object', properties: { practice: { type: 'array', items: problemSchema } }, required: ['practice'] };

const RULES = 'Write every field in the same language as the problem (Chinese problem -> Chinese, English -> English). ' +
  'Use plain text; write math inline like x^2 + 3x = 0 or sqrt(2). Each practice problem must test the same concept with different numbers or context, ' +
  'have one correct answer, and include a 1-3 sentence explanation. Double-check every answer.';

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

function cleanPractice(list) {
  return (Array.isArray(list) ? list : []).filter((p) => p && p.question && p.answer)
    .slice(0, 3).map((p) => ({ question: String(p.question), answer: String(p.answer), explanation: String(p.explanation || '') }));
}
function normalizeAnalysis(d) {
  if (!d || d.readable === false || !String(d.problemText || '').trim()) {
    throw Object.assign(new Error('Could not read a problem in this image. Try a sharper, well-lit photo of one problem.'), { status: 422, code: 'UNREADABLE' });
  }
  const difficulty = Math.min(5, Math.max(1, Math.round(Number(d.difficulty) || 3)));
  return {
    language: String(d.language || ''), problemText: String(d.problemText), subject: String(d.subject || 'Other'),
    topics: (Array.isArray(d.topics) ? d.topics : []).map(String).slice(0, 5), difficulty,
    confidence: ['high', 'medium', 'low'].includes(d.confidence) ? d.confidence : 'low',
    solution: String(d.solution || ''), practice: cleanPractice(d.practice),
  };
}

async function analyzeImage(body) {
  const { b64, mimeType } = validateImage(body);
  const prompt = 'You are a tutor helping a student build a mistake notebook. Read the single homework/exam problem in this photo (any subject). ' +
    'Transcribe it exactly as problemText, classify its subject and 1-5 specific topics, rate difficulty 1-5, give a short solution, ' +
    'and write exactly 3 similar practice problems. If no legible problem is visible, set readable=false. ' + RULES;
  const { data, model } = await generateJson([{ inline_data: { mime_type: mimeType, data: b64 } }, { text: prompt }], analyzeSchema);
  return { ...normalizeAnalysis(data), model };
}

async function morePractice(body) {
  const problemText = String(body?.problemText || '').trim();
  if (!problemText || problemText.length > 4000) throw bad('problemText is required (max 4000 chars)');
  const topics = (Array.isArray(body.topics) ? body.topics : []).map(String).slice(0, 5).join(', ');
  const prompt = `Original problem (subject: ${String(body.subject || '').slice(0, 60)}; topics: ${topics.slice(0, 300)}):\n${problemText}\n\n` +
    'Write exactly 3 NEW practice problems on the same concept, different from the original. ' + RULES;
  const { data, model } = await generateJson([{ text: prompt }], practiceSchema);
  const practice = cleanPractice(data.practice);
  if (!practice.length) throw Object.assign(new Error('AI returned no practice problems, please try again'), { status: 502 });
  return { practice, model };
}

module.exports = { analyzeImage, morePractice, validateImage, normalizeAnalysis, cleanPractice, MAX_IMAGE_BYTES };
