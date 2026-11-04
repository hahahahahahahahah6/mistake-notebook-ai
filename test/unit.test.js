'use strict';
const test = require('node:test');
const assert = require('node:assert');
const g = require('../lib/gemini');
const nb = require('../lib/notebook');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64');
const reply = (obj, status = 200) => async () => ({ ok: status < 400, status, json: async () => (status < 400 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] } : { error: {} }) });
const good = { readable: true, language: 'en', problemText: 'Solve x^2-5x+6=0', subject: 'Math', topics: ['Quadratic equations'], difficulty: 2, confidence: 'high', solution: 'x=2 or x=3',
  practice: ['A garden is 3 m longer than wide with area 40 m^2. Find its width.', 'One root of x^2 + bx + 6 = 0 is 2. Find b.', 'Find the vertex of y = x^2 - 4x + 1 and its zeros.']
    .map((question, i) => ({ variation: ['new_context', 'different_unknown', 'extra_step'][i], question, answer: `A${i}`, explanation: 'E' })) };

test.beforeEach(() => { process.env.GEMINI_API_KEY = 'test-key'; g._resetLimits(); g._setSleep(async () => {}); });

test('rejects missing / wrong-type / oversized images', () => {
  assert.throws(() => nb.validateImage({}), /imageBase64 is required/);
  assert.throws(() => nb.validateImage({ imageBase64: PNG, mimeType: 'image/gif' }), /mimeType/);
  assert.throws(() => nb.validateImage({ imageBase64: '###', mimeType: 'image/png' }), /not valid base64/);
  const big = Buffer.alloc(nb.MAX_IMAGE_BYTES + 1).toString('base64');
  assert.throws(() => nb.validateImage({ imageBase64: big, mimeType: 'image/png' }), /larger than 5 MB/);
  assert.ok(nb.validateImage({ imageBase64: `data:image/png;base64,${PNG}`, mimeType: 'image/png' }).b64);
});

test('analyzeImage returns normalized analysis and the model used', async () => {
  g._setFetch(reply(good));
  const r = await nb.analyzeImage({ imageBase64: PNG, mimeType: 'image/png' });
  assert.equal(r.subject, 'Math'); assert.equal(r.practice.length, 3); assert.ok(r.model);
});

test('unreadable image gives a clear 422 error', async () => {
  g._setFetch(reply({ ...good, readable: false, problemText: '' }));
  await assert.rejects(nb.analyzeImage({ imageBase64: PNG, mimeType: 'image/png' }), (e) => e.status === 422 && e.code === 'UNREADABLE');
});

test('missing key reports NOT_CONFIGURED, never mock data', async () => {
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(nb.analyzeImage({ imageBase64: PNG, mimeType: 'image/png' }), (e) => e.code === 'NOT_CONFIGURED');
});

test('normalizes difficulty, confidence and practice list', () => {
  const r = nb.normalizeAnalysis({ ...good, difficulty: 9, confidence: 'sure', practice: [...good.practice, { question: 'Totally different extra problem about speed', answer: 'y' }, { question: '' }] });
  assert.equal(r.difficulty, 5); assert.equal(r.confidence, 'low'); assert.equal(r.practice.length, 3);
});

test('retries 503 then falls back to the next model', async () => {
  const seen = []; let n = 0;
  g._setFetch(async (url) => { seen.push(url.match(/models\/([^:]+)/)[1]); n++; return n <= 2 ? reply({}, 503)() : reply(good)(); });
  const r = await nb.analyzeImage({ imageBase64: PNG, mimeType: 'image/png' });
  assert.equal(seen.length, 3); assert.notEqual(r.model, seen[0]);
});

test('parses fenced JSON and rejects non-JSON', () => {
  assert.deepEqual(g.parseCandidate({ candidates: [{ content: { parts: [{ text: '```json\n{"a":1}\n```' }] } }] }), { a: 1 });
  assert.throws(() => g.parseCandidate({ candidates: [{ content: { parts: [{ text: 'nope' }] }, finishReason: 'MAX_TOKENS' }] }), /MAX_TOKENS/);
});

test('per-minute rate limit stops extra AI calls', async () => {
  g._resetLimits({ perMinute: 1 }); g._setFetch(reply({ practice: good.practice }));
  await nb.morePractice({ problemText: 'p' });
  await assert.rejects(nb.morePractice({ problemText: 'p' }), (e) => e.code === 'RATE_LIMIT');
});

test('morePractice validates input', async () => {
  await assert.rejects(nb.morePractice({}), /problemText is required/);
});

test('similarity flags number/name-swapped copies but not genuinely new problems', () => {
  assert.ok(nb.similarity('Solve for x: 2x^2 - 7x + 3 = 0', 'Solve for x: 3x^2 - 10x + 3 = 0') > 0.9);
  assert.ok(nb.similarity('Solve for x: 2x^2 - 7x + 3 = 0', 'A rectangle has area 24 and its length is 2 more than its width. Find the width.') < 0.5);
});

test('cleanPractice drops near-copies of the original and of each other', () => {
  const orig = 'Solve for x: 2x^2 - 7x + 3 = 0';
  const r = nb.cleanPractice([
    { variation: 'new_context', question: 'Solve for x: 3x^2 - 10x + 3 = 0', answer: 'a' },
    { variation: 'different_unknown', question: 'The equation x^2 + bx + 6 = 0 has a root x = 2. Find b and the other root.', answer: 'b' },
    { variation: 'extra_step', question: 'The equation x^2 + bx + 8 = 0 has a root x = 4. Find b and the other root.', answer: 'c' },
    { variation: 'bogus', question: 'A ball is thrown so its height is h = -5t^2 + 20t. When does it land?', answer: 'd' },
  ], orig);
  assert.deepEqual(r.map((p) => p.answer), ['b', 'd']); assert.equal(r[1].variation, '');
});

test('difficulty is kept consistent with step count and reason is returned', () => {
  assert.equal(nb.normalizeAnalysis({ ...good, difficulty: 1, steps: 5 }).difficulty, 3);
  assert.equal(nb.normalizeAnalysis({ ...good, difficulty: 4, steps: 1 }).difficulty, 2);
  assert.equal(nb.normalizeAnalysis({ ...good, difficulty: 2, steps: 3, difficultyReason: 'r' }).difficultyReason, 'r');
});

test('analysis uses low temperature and practice requests vary', async () => {
  const bodies = []; g._setFetch(async (u, o) => { bodies.push(JSON.parse(o.body)); return reply(good)(); });
  await nb.analyzeImage({ imageBase64: PNG, mimeType: 'image/png' });
  assert.ok(bodies[0].generationConfig.temperature <= 0.3);
  assert.ok(bodies[0].generationConfig.responseJsonSchema.required.includes('difficultyReason'));
});
