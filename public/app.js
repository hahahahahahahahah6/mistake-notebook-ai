'use strict';
const $ = (id) => document.getElementById(id);
const KEY = 'mistake-notebook-v1';
let image = null; let current = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const d = await r.json().catch(() => ({ error: `Server error (${r.status})` }));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}
function busy(on, msg = '') { $('analyze').disabled = on || !image; $('more').disabled = on; $('busy').textContent = on ? msg : ''; }

api('/api/status').then((s) => { $('status').textContent = s.gemini ? `AI ready (${s.models[0]})` : 'AI is not configured on this server (GEMINI_API_KEY missing).'; })
  .catch(() => { $('status').textContent = 'Server unreachable.'; });

$('file').onchange = () => {
  const f = $('file').files[0]; $('error').textContent = ''; image = null;
  if (!f) return busy(false);
  if (f.size > 5 * 1024 * 1024) { $('error').textContent = 'Image is larger than 5 MB.'; return busy(false); }
  const rd = new FileReader();
  rd.onload = () => { image = { mimeType: f.type, imageBase64: String(rd.result).split(',')[1] }; $('preview').src = rd.result; $('preview').style.display = 'block'; busy(false); };
  rd.readAsDataURL(f);
};

function renderPractice(list) {
  $('practice').innerHTML = list.map((p, i) => `<div class="card"><b>${i + 1}.</b> ${esc(p.question)}
<details><summary>Show answer</summary><b>${esc(p.answer)}</b>\n${esc(p.explanation)}</details></div>`).join('') || '<p class="muted">No practice problems returned.</p>';
}
function render(d) {
  current = d; $('result').hidden = false; $('saved').textContent = '';
  $('meta').innerHTML = `<b>Subject:</b> ${esc(d.subject)} &nbsp; <b>Difficulty:</b> <span title="${esc(d.difficultyReason || '')}">${'★'.repeat(d.difficulty)}${'☆'.repeat(5 - d.difficulty)}</span> &nbsp; <b>AI confidence:</b> ${esc(d.confidence)}<br>` +
    d.topics.map((t) => `<span class="tag">${esc(t)}</span>`).join('') + `<br><span class="muted">model: ${esc(d.model)}</span>` +
    (d.confidence === 'low' ? '<p class="err">Low confidence: please check the problem text below.</p>' : '');
  $('problemText').value = d.problemText; $('solution').textContent = d.solution; renderPractice(d.practice);
}

$('analyze').onclick = async () => {
  $('error').textContent = ''; busy(true, 'Reading the problem… (first request after idle can take ~30-60 s)');
  try { render(await api('/api/analyze', image)); } catch (e) { $('error').textContent = e.message; } finally { busy(false); }
};
$('more').onclick = async () => {
  $('error').textContent = ''; busy(true, 'Writing new practice problems…');
  try {
    current.problemText = $('problemText').value;
    const r = await api('/api/practice', { problemText: current.problemText, subject: current.subject, topics: current.topics });
    current.practice = r.practice; renderPractice(r.practice);
  } catch (e) { $('error').textContent = e.message; } finally { busy(false); }
};

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const store = (l) => localStorage.setItem(KEY, JSON.stringify(l));
$('save').onclick = () => {
  if (!current) return;
  const l = load(); l.unshift({ id: Date.now(), savedAt: new Date().toISOString(), ...current, problemText: $('problemText').value });
  store(l); $('saved').textContent = 'Saved.'; renderList();
};
function renderList() {
  const l = load(); const fs = $('fSubject').value; const ft = $('fTopic').value;
  const subjects = [...new Set(l.map((e) => e.subject))].sort(); const topics = [...new Set(l.flatMap((e) => e.topics))].sort();
  const opts = (sel, vals, all) => { const v = sel.value; sel.innerHTML = `<option value="">${all}</option>` + vals.map((x) => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join(''); };
  opts($('fSubject'), subjects, 'All subjects'); opts($('fTopic'), topics, 'All topics');
  const shown = l.filter((e) => (!fs || e.subject === fs) && (!ft || e.topics.includes(ft)));
  $('list').innerHTML = shown.length ? shown.map((e) => `<div class="card"><b>${esc(e.subject)}</b> ${e.topics.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
${esc(e.problemText)}
<details><summary>Practice (${e.practice.length})</summary>${e.practice.map((p, i) => `${i + 1}. ${esc(p.question)}\n   → ${esc(p.answer)}`).join('\n')}</details><button class="ghost" data-del="${e.id}">Delete</button></div>`).join('')
    : (l.length ? 'No entries match this filter.' : 'Nothing saved yet. Entries are stored only in this browser (localStorage).');
}
$('fSubject').onchange = renderList; $('fTopic').onchange = renderList;
$('list').onclick = (ev) => { const id = ev.target.dataset?.del; if (id) { store(load().filter((e) => String(e.id) !== id)); renderList(); } };
renderList();
