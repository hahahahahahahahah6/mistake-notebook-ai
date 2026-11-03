'use strict';
const test = require('node:test');
const assert = require('node:assert');
const g = require('../lib/gemini');
const nb = require('../lib/notebook');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64');
const reply = (obj, status = 200) => async () => ({ ok: status < 400, status, json: async () => (status < 400 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] } : { error: {} }) });
const good = { readable: true, language: 'en', problemText: 'Solve x^2-5x+6=0', subject: 'Math', topics: ['Quadratic equations'], difficulty: 2, confidence: 'high', solution: 'x=2 or x=3',
  practice: [1, 2, 3].map((i) => ({ question: `Q${i}`, answer: `A${i}`, explanation: 'E' })) };

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
  const r = nb.normalizeAnalysis({ ...good, difficulty: 9, confidence: 'sure', practice: [...good.practice, { question: 'x', answer: 'y' }, { question: '' }] });
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
