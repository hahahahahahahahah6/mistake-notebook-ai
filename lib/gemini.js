'use strict';
// Gemini REST client: image + text in, structured JSON out, retry/backoff, model fallback, request caps.
// Docs: https://ai.google.dev/api/generate-content
let fetchImpl = (...a) => fetch(...a);
const _setFetch = (f) => { fetchImpl = f; };
let sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const _setSleep = (f) => { sleep = f; };

const RETRY = new Set([429, 500, 503]);
const limits = { max: Number(process.env.AI_MAX_REQUESTS || 200), perMinute: 10, used: 0, window: [] };
function _resetLimits(o = {}) { Object.assign(limits, { used: 0, window: [] }, o); }
function checkLimit() {
  const now = Date.now();
  limits.window = limits.window.filter((t) => now - t < 60_000);
  if (limits.used >= limits.max) throw Object.assign(new Error('AI request cap reached for this server run'), { code: 'RATE_LIMIT', status: 429 });
  if (limits.window.length >= limits.perMinute) throw Object.assign(new Error('Too many AI requests, please wait a minute'), { code: 'RATE_LIMIT', status: 429 });
  limits.used++; limits.window.push(now);
}
function modelList(env = process.env) {
  const l = [env.GEMINI_MODEL || 'gemini-3.5-flash', ...(env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash-lite').split(',')]
    .map((s) => s.trim()).filter(Boolean);
  for (const m of l) if (!/^[\w.-]{3,80}$/.test(m)) throw new Error('invalid Gemini model name');
  return [...new Set(l)];
}
function parseCandidate(data) {
  const cand = data.candidates?.[0];
  let text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1];
  try { return JSON.parse(text); } catch {
    throw Object.assign(new Error(`AI returned unreadable output${cand?.finishReason && cand.finishReason !== 'STOP' ? ` (${cand.finishReason})` : ''}`), { status: 502, retryable: true });
  }
}
async function callOnce(model, key, parts, schema, temperature) {
  checkLimit();
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 8192, ...(temperature == null ? {} : { temperature }) } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data.error?.details?.find((x) => x.reason)?.reason || data.error?.status || '';
    throw Object.assign(new Error(`AI request failed (${res.status}${reason ? ` ${reason}` : ''})`), { status: res.status });
  }
  return parseCandidate(data);
}
async function generateJson(parts, schema, opts = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('AI is not configured: set GEMINI_API_KEY'), { code: 'NOT_CONFIGURED', status: 503 });
  let last;
  for (const model of modelList()) {
    for (let i = 0; i < 2; i++) {
      try { return { data: await callOnce(model, key, parts, schema, opts.temperature), model }; } catch (e) {
        last = e;
        if (e.code === 'RATE_LIMIT') throw e;
        if (!(RETRY.has(e.status) || e.retryable)) { if (e.status === 404) break; throw e; }
        if (i === 0) await sleep(1000 + Math.floor(Math.random() * 250));
      }
    }
  }
  throw last;
}
module.exports = { generateJson, modelList, parseCandidate, _setFetch, _setSleep, _resetLimits };
