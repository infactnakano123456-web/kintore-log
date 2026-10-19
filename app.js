/* 筋トレログ — iPhoneのホーム画面に追加して使う、オフライン対応の筋トレ記録アプリ
 * データは端末内（localStorage）にだけ保存する。サーバーには送らない。
 */
'use strict';

const STORE_KEY = 'kintore-log-v1';
const APP_VERSION = '1.0.1';
const PARTS = ['胸', '背中', '肩', '腕', '脚', '腹筋', '有酸素', 'その他'];
const PART_COLORS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8'];

/* ── データ ──────────────────────────────────────────────
 * db = {
 *   app, version,
 *   sessions: { 'YYYY-MM-DD': { items: [ { exercise, kind: 'strength'|'cardio', sets: [...] } ] } },
 *   exercises: { 名前: { part, kind } },
 *   meta: { lastBackup }
 * }
 * 筋トレのセット: { w: 重量kg, r: 回数, memo }   有酸素のセット: { km, min, kcal, memo }
 */
let db = loadDb();

function emptyDb() {
  return { app: 'kintore-log', version: 1, sessions: {}, exercises: {}, meta: {} };
}
function loadDb() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalizeDb(JSON.parse(raw));
  } catch (e) { console.error(e); }
  return emptyDb();
}
function normalizeDb(d) {
  const out = emptyDb();
  out.sessions = d.sessions || {};
  out.exercises = d.exercises || {};
  out.meta = d.meta || {};
  return out;
}
function saveDb() {
  // 空になった日は消す
  for (const [d, s] of Object.entries(db.sessions)) {
    if (!s.items || s.items.length === 0) delete db.sessions[d];
  }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    toast('保存できませんでした（容量不足の可能性）');
    console.error(e);
  }
}

/* ── 計算 ─────────────────────────────────────────── */
// RM（推定1RM）は筋トレMEMOと同じ式: 重量 × (1 + 回数/40)
const rm = (w, r) => (w != null && r != null && r > 0) ? w * (1 + r / 40) : null;
const vol = s => (s.w != null && s.r != null) ? s.w * s.r : 0;
const round = (v, n = 1) => v == null ? null : Math.round(v * 10 ** n) / 10 ** n;
const fmt = (v, n = 1) => v == null ? '-' : (Math.round(v * 10 ** n) / 10 ** n).toLocaleString('ja-JP', { maximumFractionDigits: n });
const kindOf = name => db.exercises[name]?.kind || 'strength';
const partOf = name => db.exercises[name]?.part || 'その他';

function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
const todayIso = () => isoDate(new Date());
function parseIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseIso(s); d.setDate(d.getDate() + n); return isoDate(d); }
const WD = ['日', '月', '火', '水', '木', '金', '土'];
function labelDate(s) { const d = parseIso(s); return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; }
// 年をまたぐ表示用（自己ベストなど）
function labelDateY(s) { const d = parseIso(s); return `${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}/${d.getDate()}`; }

function daySummary(session) {
  let sets = 0, reps = 0, volume = 0;
  for (const it of session?.items || []) {
    for (const s of it.sets) {
      sets++;
      if (it.kind !== 'cardio') { reps += s.r || 0; volume += vol(s); }
    }
  }
  return { exercises: session?.items?.length || 0, sets, reps, volume };
}

// 種目ごとの日別集計（分析・前回値で使う）
function exerciseHistory(name) {
  const out = [];
  for (const [d, s] of Object.entries(db.sessions).sort()) {
    for (const it of s.items) {
      if (it.exercise !== name) continue;
      const st = it.sets.filter(x => x.w != null && x.r != null);
      if (it.kind === 'cardio') {
        out.push({ date: d, km: sum(it.sets.map(x => x.km || 0)), min: sum(it.sets.map(x => x.min || 0)),
                   kcal: sum(it.sets.map(x => x.kcal || 0)), sets: it.sets.length });
        continue;
      }
      out.push({
        date: d,
        maxW: st.length ? Math.max(...st.map(x => x.w)) : null,
        maxRm: st.length ? Math.max(...st.map(x => rm(x.w, x.r))) : null,
        volume: sum(st.map(vol)),
        reps: sum(st.map(x => x.r)),
        sets: it.sets.length,
        raw: it.sets,
      });
    }
  }
  return out;
}
const sum = a => a.reduce((x, y) => x + (y || 0), 0);

function exerciseNamesByRecent() {
  const last = {}, count = {};
  for (const [d, s] of Object.entries(db.sessions)) {
    for (const it of s.items) {
      last[it.exercise] = last[it.exercise] > d ? last[it.exercise] : d;
      count[it.exercise] = (count[it.exercise] || 0) + it.sets.length;
    }
  }
  const names = new Set([...Object.keys(db.exercises), ...Object.keys(last)]);
  return [...names].map(n => ({ name: n, last: last[n] || '', count: count[n] || 0 }))
    .sort((a, b) => (b.last).localeCompare(a.last) || b.count - a.count);
}

function previousSets(name, beforeDate) {
  const dates = Object.keys(db.sessions).filter(d => d < beforeDate).sort().reverse();
  for (const d of dates) {
    const it = db.sessions[d].items.find(i => i.exercise === name);
    if (it) return { date: d, sets: it.sets, kind: it.kind };
  }
  return null;
}

/* ── UI共通 ──────────────────────────────────────── */
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}
let sheetOnClose = null;
function openSheet(html, onMount, onClose) {
  sheetOnClose = onClose || null;
  const sh = $('#sheet');
  sh.innerHTML = html;
  sh.classList.remove('hidden');
  $('#sheet-backdrop').classList.remove('hidden');
  sh.scrollTop = 0;
  onMount?.(sh);
}
function closeSheet() {
  const cb = sheetOnClose; sheetOnClose = null;
  $('#sheet').classList.add('hidden');
  $('#sheet-backdrop').classList.add('hidden');
  $('#sheet').innerHTML = '';
  cb?.();
}
$('#sheet-backdrop').addEventListener('click', closeSheet);

const state = {
  tab: 'record',
  date: todayIso(),
  month: todayIso().slice(0, 7),
  an: { exercise: null, metric: 'maxRm', range: '1y', type: 'line', monthMetric: 'volume', monthRange: '1y', stackParts: true },
  ex: { scope: 'month', date: todayIso(), month: todayIso().slice(0, 7), from: addDays(todayIso(), -27), to: todayIso(), prompt: true },
};

function setTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll('#tabbar button')) b.classList.toggle('active', b.dataset.tab === tab);
  render();
  window.scrollTo(0, 0);
}
document.querySelectorAll('#tabbar button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

function render() {
  const views = { record: renderRecord, history: renderHistory, analysis: renderAnalysis, export: renderExport, settings: renderSettings };
  $('#topbar-actions').innerHTML = '';
  views[state.tab]();
}

/* ── 記録 ────────────────────────────────────────── */
function renderRecord() {
  $('#title').textContent = '記録';
  const session = db.sessions[state.date];
  const sm = daySummary(session);
  const isToday = state.date === todayIso();
  if (!isToday) {
    $('#topbar-actions').innerHTML = '<button id="go-today">今日へ</button>';
    $('#go-today').onclick = () => { state.date = todayIso(); render(); };
  }
  let html = `
    <div class="datebar">
      <button id="d-prev" aria-label="前の日">‹</button>
      <input type="date" id="d-input" value="${state.date}">
      <button id="d-next" aria-label="次の日">›</button>
    </div>
    <div class="stats">
      <div class="stat"><b>${sm.exercises}</b><span>種目</span></div>
      <div class="stat"><b>${sm.sets}</b><span>セット</span></div>
      <div class="stat"><b>${fmt(sm.reps, 0)}</b><span>レップ</span></div>
      <div class="stat"><b>${fmt(sm.volume, 0)}</b><span>総負荷kg</span></div>
    </div>`;
  if (!session || session.items.length === 0) {
    html += `<div class="empty">${labelDate(state.date)} の記録はまだありません</div>`;
  } else {
    session.items.forEach((it, idx) => { html += exerciseCard(it, idx); });
  }
  html += `<button class="btn primary block" id="add-ex">＋ 種目を追加</button>`;
  if (!session || session.items.length === 0) {
    const prev = Object.keys(db.sessions).filter(d => d < state.date).sort().pop();
    if (prev) html += `<button class="btn ghost block" id="copy-prev" style="margin-top:8px">${labelDate(prev)} のメニューをコピー</button>`;
  }
  // 記録が1件もないとき（初回）は、これまでのデータの取り込みを案内する
  if (Object.keys(db.sessions).length === 0) {
    html += `
    <div class="card" style="margin-top:16px">
      <h2>これまでの記録を取り込む</h2>
      <div class="muted">筋トレMEMOから移した記録ファイル（kintore_initial.json または CSV）を選ぶと、過去の記録が表示されます。ファイルは先にAirDropなどで「ファイル」Appに保存しておいてください。</div>
      <button class="btn primary block" id="first-import" style="margin-top:10px">ファイルを選んで取り込む</button>
      <input type="file" id="first-file" accept=".json,.csv,application/json,text/csv" class="hidden">
    </div>`;
  }
  $('#view').innerHTML = html;
  $('#first-import')?.addEventListener('click', () => $('#first-file').click());
  $('#first-file')?.addEventListener('change', ev => { const f = ev.target.files[0]; if (f) importFile(f); });

  $('#d-prev').onclick = () => { state.date = addDays(state.date, -1); render(); };
  $('#d-next').onclick = () => { state.date = addDays(state.date, 1); render(); };
  $('#d-input').onchange = e => { if (e.target.value) { state.date = e.target.value; render(); } };
  $('#add-ex').onclick = openExercisePicker;
  $('#copy-prev')?.addEventListener('click', copyPreviousMenu);

  $('#view').querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', onRecordAction));
}

function exerciseCard(it, idx) {
  const cardio = it.kind === 'cardio';
  const prev = previousSets(it.exercise, state.date);
  let rows = '';
  it.sets.forEach((s, i) => {
    if (cardio) {
      rows += `<tr data-act="edit-set" data-i="${idx}" data-s="${i}"><td>${i + 1}</td>
        <td><b>${fmt(s.km, 2)}</b><small> km</small></td><td><b>${fmt(s.min, 1)}</b><small> 分</small></td>
        <td><small>${fmt(s.kcal, 0)} kcal</small></td></tr>`;
    } else {
      rows += `<tr data-act="edit-set" data-i="${idx}" data-s="${i}"><td>${i + 1}</td>
        <td><b>${fmt(s.w, 2)}</b><small> kg</small></td><td><b>${s.r ?? '-'}</b><small> 回</small></td>
        <td><small>${fmt(rm(s.w, s.r), 1)} kg</small></td></tr>`;
    }
    if (s.memo) rows += `<tr class="memo" data-act="edit-set" data-i="${idx}" data-s="${i}"><td></td><td colspan="3">${esc(s.memo)}</td></tr>`;
  });
  const head = cardio
    ? '<tr><th>#</th><th>距離</th><th>時間</th><th>kcal</th></tr>'
    : '<tr><th>#</th><th>重さ</th><th>回数</th><th>RM</th></tr>';
  let prevText = '';
  if (prev) {
    const p = prev.sets.slice(0, 6).map(s => prev.kind === 'cardio' ? `${fmt(s.km, 2)}km` : `${fmt(s.w, 2)}×${s.r ?? '-'}`).join(' / ');
    prevText = `前回 ${labelDate(prev.date)}: ${p}${prev.sets.length > 6 ? ' …' : ''}`;
  }
  return `
  <div class="ex-card">
    <div class="ex-head">
      <span class="name">${esc(it.exercise)}</span><span class="tag">${esc(partOf(it.exercise))}</span>
      <button data-act="ex-menu" data-i="${idx}" aria-label="種目のメニュー">⋯</button>
    </div>
    <table class="sets">${head}${rows}</table>
    <div class="ex-foot">
      <span class="prev">${esc(prevText)}</span>
      <button class="btn small primary" data-act="add-set" data-i="${idx}">＋セット</button>
    </div>
  </div>`;
}

function onRecordAction(e) {
  const el = e.currentTarget;
  const idx = Number(el.dataset.i);
  const session = db.sessions[state.date];
  const it = session?.items[idx];
  if (!it) return;
  switch (el.dataset.act) {
    case 'add-set': openSetEditor(idx, null); break;
    case 'edit-set': openSetEditor(idx, Number(el.dataset.s)); break;
    case 'ex-menu': openExerciseMenu(idx); break;
  }
}

function ensureSession(date) {
  if (!db.sessions[date]) db.sessions[date] = { items: [] };
  return db.sessions[date];
}

function addExerciseToDay(name) {
  const session = ensureSession(state.date);
  let idx = session.items.findIndex(i => i.exercise === name);
  if (idx < 0) {
    session.items.push({ exercise: name, kind: kindOf(name), sets: [] });
    idx = session.items.length - 1;
  }
  saveDb();
  closeSheet();
  render();
  openSetEditor(idx, null, true);
}

function copyPreviousMenu() {
  const prev = Object.keys(db.sessions).filter(d => d < state.date).sort().pop();
  if (!prev) return;
  const session = ensureSession(state.date);
  for (const it of db.sessions[prev].items) {
    session.items.push({ exercise: it.exercise, kind: it.kind, sets: [] });
  }
  saveDb();
  render();
  toast('種目だけコピーしました。＋セットで記録してください');
}

function openExercisePicker() {
  let part = 'すべて';
  const draw = sh => {
    const q = sh.querySelector('#ex-q').value.trim();
    const list = exerciseNamesByRecent().filter(x =>
      (part === 'すべて' || partOf(x.name) === part) && (!q || x.name.includes(q)));
    sh.querySelector('#ex-list').innerHTML = list.map(x =>
      `<button data-name="${esc(x.name)}"><span>${esc(x.name)}</span><span class="sub">${esc(partOf(x.name))}${x.last ? '・' + x.last.slice(5).replace('-', '/') : ''}</span></button>`
    ).join('') + (q && !list.some(x => x.name === q)
      ? `<button data-new="${esc(q)}"><span>＋「${esc(q)}」を新しい種目として追加</span></button>` : '');
    sh.querySelectorAll('#ex-list [data-name]').forEach(b => b.onclick = () => addExerciseToDay(b.dataset.name));
    sh.querySelectorAll('#ex-list [data-new]').forEach(b => b.onclick = () => openNewExercise(b.dataset.new));
    sh.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.part === part));
  };
  openSheet(`
    <h3>種目を追加</h3>
    <input type="search" id="ex-q" placeholder="種目名で検索・新規追加" autocomplete="off">
    <div class="chips" style="margin-top:8px">${['すべて', ...PARTS].map(p => `<button class="chip" data-part="${p}">${p}</button>`).join('')}</div>
    <div class="pick-list" id="ex-list"></div>
    <button class="btn ghost block" id="ex-new" style="margin-top:8px">＋ 新しい種目を作る</button>
  `, sh => {
    sh.querySelector('#ex-q').addEventListener('input', () => draw(sh));
    sh.querySelectorAll('.chip').forEach(c => c.onclick = () => { part = c.dataset.part; draw(sh); });
    sh.querySelector('#ex-new').onclick = () => openNewExercise(sh.querySelector('#ex-q').value.trim());
    draw(sh);
  });
}

function openNewExercise(name = '') {
  openSheet(`
    <h3>新しい種目</h3>
    <label class="field"><span>種目名</span><input type="text" id="nx-name" value="${esc(name)}"></label>
    <label class="field"><span>部位</span><select id="nx-part">${PARTS.map(p => `<option>${p}</option>`).join('')}</select></label>
    <label class="field"><span>種類</span><select id="nx-kind"><option value="strength">筋トレ（重さ×回数）</option><option value="cardio">有酸素（距離・時間）</option></select></label>
    <div class="row"><button class="btn" id="nx-cancel">戻る</button><span class="spacer"></span><button class="btn primary" id="nx-ok">追加</button></div>
  `, sh => {
    sh.querySelector('#nx-part').onchange = e => { if (e.target.value === '有酸素') sh.querySelector('#nx-kind').value = 'cardio'; };
    sh.querySelector('#nx-cancel').onclick = openExercisePicker;
    sh.querySelector('#nx-ok').onclick = () => {
      const n = sh.querySelector('#nx-name').value.trim();
      if (!n) { toast('種目名を入れてください'); return; }
      db.exercises[n] = { part: sh.querySelector('#nx-part').value, kind: sh.querySelector('#nx-kind').value };
      addExerciseToDay(n);
    };
  });
}

function openSetEditor(idx, setIdx, dropIfEmpty = false) {
  const session = db.sessions[state.date];
  const it = session.items[idx];
  const cardio = it.kind === 'cardio';
  const isNew = setIdx == null;
  // 新しいセットの初期値: 同じ日の直前のセット → 前回の同じ番号のセット → 前回の最初のセット
  let base = isNew ? null : it.sets[setIdx];
  if (isNew) {
    const prev = previousSets(it.exercise, state.date);
    base = it.sets[it.sets.length - 1] || prev?.sets[it.sets.length] || prev?.sets[0] || (cardio ? { km: 2, min: 15 } : { w: 20, r: 10 });
    base = { ...base, memo: '' };
  }
  const title = `${esc(it.exercise)} — ${isNew ? `セット${it.sets.length + 1}` : `セット${setIdx + 1}を編集`}`;
  const body = cardio ? `
    <label class="field"><span>距離（km）</span>${stepper('km', base.km ?? '', [-1, -0.1], [0.1, 1])}</label>
    <label class="field"><span>時間（分）</span>${stepper('min', base.min ?? '', [-5, -1], [1, 5])}</label>
    <label class="field"><span>消費カロリー（kcal・任意）</span><input type="number" inputmode="decimal" id="f-kcal" value="${base.kcal ?? ''}"></label>`
    : `
    <label class="field"><span>重さ（kg）</span>${stepper('w', base.w ?? '', [-2.5, -1], [1, 2.5])}</label>
    <label class="field"><span>回数</span>${stepper('r', base.r ?? '', [-5, -1], [1, 5])}</label>
    <div class="muted" id="f-rm" style="text-align:center;margin:-4px 0 10px"></div>`;
  openSheet(`
    <h3>${title}</h3>
    ${body}
    <label class="field"><span>メモ（任意）</span><input type="text" id="f-memo" value="${esc(base.memo || '')}" placeholder="例: 片足、フォーム意識"></label>
    <div class="row">
      ${isNew ? '' : '<button class="btn danger" id="f-del">削除</button>'}
      <span class="spacer"></span>
      <button class="btn" id="f-cancel">キャンセル</button>
      <button class="btn primary" id="f-ok">${isNew ? '追加' : '保存'}</button>
    </div>
  `, sh => {
    const updRm = () => {
      if (cardio) return;
      const w = parseFloat(sh.querySelector('#f-w').value), r = parseInt(sh.querySelector('#f-r').value, 10);
      sh.querySelector('#f-rm').textContent = (w >= 0 && r > 0) ? `RM ${fmt(rm(w, r), 1)} kg・負荷 ${fmt(w * r, 0)} kg` : '';
    };
    bindSteppers(sh, updRm);
    updRm();
    sh.querySelector('#f-cancel').onclick = closeSheet;
    sh.querySelector('#f-del')?.addEventListener('click', () => {
      if (!confirm('このセットを削除しますか？')) return;
      it.sets.splice(setIdx, 1);
      saveDb(); closeSheet(); render();
    });
    sh.querySelector('#f-ok').onclick = () => {
      const memo = sh.querySelector('#f-memo').value.trim();
      let s;
      if (cardio) {
        s = { km: numOrNull(sh.querySelector('#f-km').value), min: numOrNull(sh.querySelector('#f-min').value),
              kcal: numOrNull(sh.querySelector('#f-kcal').value), memo };
      } else {
        const w = numOrNull(sh.querySelector('#f-w').value);
        const r = numOrNull(sh.querySelector('#f-r').value);
        if (w == null && r == null) { toast('重さか回数を入れてください'); return; }
        s = { w, r: r == null ? null : Math.round(r), memo };
      }
      if (isNew) it.sets.push(s); else it.sets[setIdx] = s;
      dropIfEmpty = false;
      saveDb(); closeSheet(); render();
      if (isNew) toast(`セット${it.sets.length}を記録しました`);
    };
  }, () => {
    if (dropIfEmpty && it.sets.length === 0) {
      session.items.splice(session.items.indexOf(it), 1);
      saveDb(); render();
    }
  });
}
const numOrNull = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

function stepper(key, value, minus, plus) {
  return `<div class="stepper">
    <button type="button" data-step="${key}" data-d="${minus[0]}">${minus[0]}</button>
    <button type="button" data-step="${key}" data-d="${minus[1]}">${minus[1]}</button>
    <input type="number" inputmode="decimal" id="f-${key}" value="${value}">
    <button type="button" data-step="${key}" data-d="${plus[0]}">+${plus[0]}</button>
    <button type="button" data-step="${key}" data-d="${plus[1]}">+${plus[1]}</button>
  </div>`;
}
function bindSteppers(root, onChange) {
  root.querySelectorAll('[data-step]').forEach(b => b.onclick = () => {
    const inp = root.querySelector(`#f-${b.dataset.step}`);
    const v = (parseFloat(inp.value) || 0) + parseFloat(b.dataset.d);
    inp.value = String(Math.max(0, Math.round(v * 100) / 100));
    onChange?.();
  });
  root.querySelectorAll('input').forEach(i => i.addEventListener('input', () => onChange?.()));
}

function openExerciseMenu(idx) {
  const session = db.sessions[state.date];
  const it = session.items[idx];
  openSheet(`
    <h3>${esc(it.exercise)}</h3>
    <div class="pick-list">
      <button data-m="up">↑ 上へ移動</button>
      <button data-m="down">↓ 下へ移動</button>
      <button data-m="chart">↗ この種目の推移を見る</button>
      <button data-m="del" style="color:var(--accent)">この日から種目ごと削除（${it.sets.length}セット）</button>
    </div>
    <button class="btn block" id="m-close" style="margin-top:10px">閉じる</button>
  `, sh => {
    sh.querySelector('#m-close').onclick = closeSheet;
    sh.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
      const m = b.dataset.m;
      if (m === 'up' && idx > 0) [session.items[idx - 1], session.items[idx]] = [session.items[idx], session.items[idx - 1]];
      if (m === 'down' && idx < session.items.length - 1) [session.items[idx + 1], session.items[idx]] = [session.items[idx], session.items[idx + 1]];
      if (m === 'del') {
        if (!confirm(`${it.exercise} の${it.sets.length}セットを削除しますか？`)) return;
        session.items.splice(idx, 1);
      }
      if (m === 'chart') { state.an.exercise = it.exercise; closeSheet(); setTab('analysis'); return; }
      saveDb(); closeSheet(); render();
    });
  });
}

/* ── 履歴 ────────────────────────────────────────── */
function renderHistory() {
  $('#title').textContent = '履歴';
  const [y, m] = state.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const today = todayIso();
  let cells = WD.map(w => `<div class="dow">${w}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = isoDate(d);
    const out = d.getMonth() !== m - 1;
    if (i >= 35 && out) break;
    const has = !!db.sessions[iso];
    cells += `<button data-day="${iso}" class="${out ? 'out' : ''} ${has ? 'has' : ''} ${iso === today ? 'today' : ''}">${d.getDate()}</button>`;
  }
  const days = Object.keys(db.sessions).filter(d => d.startsWith(state.month)).sort();
  let sets = 0, volume = 0;
  const list = days.map(d => {
    const s = db.sessions[d]; const sm = daySummary(s);
    sets += sm.sets; volume += sm.volume;
    return `<div class="day" data-day="${d}"><span class="d">${labelDate(d).replace(/（.）/, '')}<small class="muted"> ${WD[parseIso(d).getDay()]}</small></span>
      <span class="x">${s.items.map(i => esc(i.exercise)).join('・')}<br>${sm.sets}セット・${fmt(sm.volume, 0)}kg</span></div>`;
  }).join('');
  $('#view').innerHTML = `
    <div class="card" id="cal-card">
      <div class="cal-head"><button id="m-prev">‹</button><b>${y}年${m}月</b><button id="m-next">›</button></div>
      <div class="cal">${cells}</div>
    </div>
    <div class="stats" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat"><b>${days.length}</b><span>トレーニング日</span></div>
      <div class="stat"><b>${sets}</b><span>セット</span></div>
      <div class="stat"><b>${fmt(volume / 1000, 1)}t</b><span>総負荷</span></div>
    </div>
    <div class="card day-list">${list || '<div class="empty">この月の記録はありません</div>'}</div>`;
  const shift = n => { const d = new Date(y, m - 1 + n, 1); state.month = isoDate(d).slice(0, 7); render(); };
  $('#m-prev').onclick = () => shift(-1);
  $('#m-next').onclick = () => shift(1);
  $('#view').querySelectorAll('[data-day]').forEach(el => el.onclick = () => { state.date = el.dataset.day; setTab('record'); });
  // 左右スワイプで月を移動
  let sx = null;
  const cal = $('#cal-card');
  cal.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  cal.addEventListener('touchend', e => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 50) shift(dx > 0 ? -1 : 1);
  });
}

/* ── 分析 ────────────────────────────────────────── */
const RANGES = { '3m': ['3ヶ月', 92], '6m': ['6ヶ月', 183], '1y': ['1年', 366], all: ['全期間', null] };
const METRICS = {
  maxRm: ['推定1RM（最大）', 'kg'], maxW: ['最大重量', 'kg'], volume: ['総負荷', 'kg'], reps: ['総レップ', '回'], sets: ['セット数', ''],
};
const CARDIO_METRICS = { km: ['距離', 'km'], min: ['時間', '分'], kcal: ['消費カロリー', 'kcal'], sets: ['回数', ''] };
const MONTH_METRICS = { volume: ['総負荷（t）', 't'], days: ['トレーニング日数', '日'], sets: ['セット数', ''] };

function rangeStart(key) {
  const days = RANGES[key][1];
  return days ? addDays(todayIso(), -days) : '0000-00-00';
}

function renderAnalysis() {
  $('#title').textContent = '分析';
  const names = exerciseNamesByRecent().filter(x => x.count > 0);
  if (names.length === 0) { $('#view').innerHTML = '<div class="empty">記録がまだありません。設定からデータを取り込むか、記録を始めてください。</div>'; return; }
  const a = state.an;
  if (!a.exercise || !names.some(x => x.name === a.exercise)) a.exercise = names[0].name;
  const cardio = kindOf(a.exercise) === 'cardio';
  const metrics = cardio ? CARDIO_METRICS : METRICS;
  if (!metrics[a.metric]) a.metric = Object.keys(metrics)[0];

  const hist = exerciseHistory(a.exercise).filter(h => h.date >= rangeStart(a.range));
  const pts = hist.map(h => ({ x: h.date, y: h[a.metric] })).filter(p => p.y != null);

  $('#view').innerHTML = `
    <div class="card">
      <h2>種目別の推移</h2>
      <select id="a-ex">${names.map(x => `<option ${x.name === a.exercise ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <div class="chips" style="margin:8px 0">${Object.entries(metrics).map(([k, v]) => `<button class="chip ${a.metric === k ? 'on' : ''}" data-metric="${k}">${v[0]}</button>`).join('')}</div>
      <div class="row wrap">
        <div class="chips">${Object.entries(RANGES).map(([k, v]) => `<button class="chip ${a.range === k ? 'on' : ''}" data-range="${k}">${v[0]}</button>`).join('')}</div>
        <span class="spacer"></span>
        <div class="chips">${[['line', '折れ線'], ['bar', '棒'], ['dot', '点']].map(([k, v]) => `<button class="chip ${a.type === k ? 'on' : ''}" data-type="${k}">${v}</button>`).join('')}</div>
      </div>
      <div id="a-chart" style="margin-top:8px"></div>
      <div class="chart-tip" id="a-tip">${pts.length ? 'グラフをタップすると値を表示します' : 'この期間の記録はありません'}</div>
    </div>
    <div class="card" id="a-pr"></div>
    <div class="card">
      <h2>月ごとの推移</h2>
      <div class="chips" style="margin-bottom:8px">${Object.entries(MONTH_METRICS).map(([k, v]) => `<button class="chip ${a.monthMetric === k ? 'on' : ''}" data-mmetric="${k}">${v[0]}</button>`).join('')}</div>
      <div class="row wrap">
        <div class="chips">${Object.entries(RANGES).map(([k, v]) => `<button class="chip ${a.monthRange === k ? 'on' : ''}" data-mrange="${k}">${v[0]}</button>`).join('')}</div>
        <span class="spacer"></span>
        <button class="chip ${a.stackParts ? 'on' : ''}" id="a-stack">部位別に色分け</button>
      </div>
      <div id="m-chart" style="margin-top:8px"></div>
      <div class="chart-tip" id="m-tip"></div>
      <div class="legend" id="m-legend"></div>
    </div>
    <div class="card">
      <h2>部位別のセット数（${RANGES[a.monthRange][0]}）</h2>
      <div id="p-bars"></div>
    </div>`;

  $('#a-ex').onchange = e => { a.exercise = e.target.value; render(); };
  $('#view').querySelectorAll('[data-metric]').forEach(b => b.onclick = () => { a.metric = b.dataset.metric; render(); });
  $('#view').querySelectorAll('[data-range]').forEach(b => b.onclick = () => { a.range = b.dataset.range; render(); });
  $('#view').querySelectorAll('[data-type]').forEach(b => b.onclick = () => { a.type = b.dataset.type; render(); });
  $('#view').querySelectorAll('[data-mmetric]').forEach(b => b.onclick = () => { a.monthMetric = b.dataset.mmetric; render(); });
  $('#view').querySelectorAll('[data-mrange]').forEach(b => b.onclick = () => { a.monthRange = b.dataset.mrange; render(); });
  $('#a-stack').onclick = () => { a.stackParts = !a.stackParts; render(); };

  const unit = metrics[a.metric][1];
  if (pts.length) {
    drawSeriesChart($('#a-chart'), pts, a.type, unit, p => {
      const h = hist.find(x => x.date === p.x);
      const detail = h?.raw ? '　' + h.raw.map(s => `${fmt(s.w, 2)}×${s.r ?? '-'}`).join(' / ') : '';
      $('#a-tip').textContent = `${labelDate(p.x)} ${fmt(p.y, 1)}${unit}${detail}`;
    });
  }
  renderPr(a.exercise, cardio);
  renderMonthly();
  renderPartBars();
}

function renderPr(name, cardio) {
  const hist = exerciseHistory(name);
  const el = $('#a-pr');
  if (!hist.length) { el.innerHTML = ''; return; }
  if (cardio) {
    const best = (k) => hist.reduce((b, h) => (h[k] || 0) > (b?.[k] || 0) ? h : b, null);
    const km = best('km'), mn = best('min');
    el.innerHTML = `<h2>自己ベスト（${esc(name)}）</h2><table class="pr-table">
      <tr><td>最長距離</td><td><b>${fmt(km?.km, 2)} km</b></td><td>${km ? labelDateY(km.date) : ''}</td></tr>
      <tr><td>最長時間</td><td><b>${fmt(mn?.min, 1)} 分</b></td><td>${mn ? labelDateY(mn.date) : ''}</td></tr>
      <tr><td>実施回数</td><td><b>${hist.length} 回</b></td><td></td></tr></table>`;
    return;
  }
  const sets = hist.flatMap(h => h.raw.filter(s => s.w != null && s.r != null).map(s => ({ ...s, date: h.date, rm: rm(s.w, s.r) })));
  const top = (arr, f) => arr.reduce((b, x) => f(x) > f(b) ? x : b, arr[0]);
  const maxW = top(sets, s => s.w + s.r / 1000);
  const maxRm = top(sets, s => s.rm);
  const maxVolDay = top(hist, h => h.volume);
  // 回数帯ごとのベスト重量
  const bands = [[1, 5], [6, 10], [11, 15], [16, 999]];
  const bandRows = bands.map(([lo, hi]) => {
    const c = sets.filter(s => s.r >= lo && s.r <= hi);
    if (!c.length) return '';
    const b = top(c, s => s.w + s.r / 1000);
    return `<tr><td>${hi === 999 ? `${lo}回以上` : `${lo}〜${hi}回`}</td><td><b>${fmt(b.w, 2)} kg × ${b.r}</b></td><td>${labelDateY(b.date)}</td></tr>`;
  }).join('');
  el.innerHTML = `<h2>自己ベスト（${esc(name)}）</h2>
    <table class="pr-table">
      <tr><td>最大重量</td><td><b>${fmt(maxW.w, 2)} kg × ${maxW.r}</b></td><td>${labelDateY(maxW.date)}</td></tr>
      <tr><td>推定1RM</td><td><b>${fmt(maxRm.rm, 1)} kg</b>（${fmt(maxRm.w, 2)}×${maxRm.r}）</td><td>${labelDateY(maxRm.date)}</td></tr>
      <tr><td>1日の総負荷</td><td><b>${fmt(maxVolDay.volume, 0)} kg</b></td><td>${labelDateY(maxVolDay.date)}</td></tr>
      ${bandRows}
      <tr><td>実施</td><td><b>${hist.length} 日・${sets.length} セット</b></td><td>${labelDateY(hist[0].date)}〜</td></tr>
    </table>`;
}

function monthlyStats(fromIso) {
  const months = {};
  for (const [d, s] of Object.entries(db.sessions)) {
    if (d < fromIso) continue;
    const m = d.slice(0, 7);
    const ms = months[m] || (months[m] = { days: 0, sets: 0, volume: 0, parts: {} });
    ms.days++;
    for (const it of s.items) {
      const p = partOf(it.exercise);
      const ps = ms.parts[p] || (ms.parts[p] = { days: new Set(), sets: 0, volume: 0 });
      ps.days.add(d);
      for (const st of it.sets) {
        ms.sets++; ps.sets++;
        if (it.kind !== 'cardio') { ms.volume += vol(st); ps.volume += vol(st); }
      }
    }
  }
  // 記録のない月も0として埋める
  const keys = Object.keys(months).sort();
  if (keys.length) {
    const [y0, m0] = keys[0].split('-').map(Number);
    const end = todayIso().slice(0, 7);
    for (let d = new Date(y0, m0 - 1, 1); isoDate(d).slice(0, 7) <= end; d.setMonth(d.getMonth() + 1)) {
      const k = isoDate(d).slice(0, 7);
      months[k] ||= { days: 0, sets: 0, volume: 0, parts: {} };
    }
  }
  return months;
}

function renderMonthly() {
  const a = state.an;
  const months = monthlyStats(rangeStart(a.monthRange).slice(0, 7) + '-01');
  const keys = Object.keys(months).sort();
  if (!keys.length) { $('#m-chart').innerHTML = '<div class="empty">記録がありません</div>'; return; }
  const val = (o) => a.monthMetric === 'volume' ? o.volume / 1000 : a.monthMetric === 'days' ? (o.days instanceof Set ? o.days.size : o.days) : o.sets;
  const unit = MONTH_METRICS[a.monthMetric][1];
  const series = a.stackParts ? PARTS : ['合計'];
  const data = keys.map(k => ({
    x: k,
    stack: a.stackParts ? PARTS.map(p => months[k].parts[p] ? val(months[k].parts[p]) : 0) : [val(months[k])],
    total: val(months[k]),
  }));
  drawStackChart($('#m-chart'), data, series.map((_, i) => cssVar(PART_COLORS[a.stackParts ? i : 0])), unit, p => {
    const parts = a.stackParts ? PARTS.map((n, i) => p.stack[i] ? `${n} ${fmt(p.stack[i], 1)}` : '').filter(Boolean).join('・') : '';
    $('#m-tip').textContent = `${p.x.replace('-', '年')}月 ${fmt(p.total, 1)}${unit}${parts ? '（' + parts + '）' : ''}`;
  });
  $('#m-legend').innerHTML = a.stackParts ? PARTS.map((p, i) => `<span><i style="background:${cssVar(PART_COLORS[i])}"></i>${p}</span>`).join('') : '';
  if (a.stackParts && a.monthMetric === 'days') $('#m-tip').textContent = '部位別の日数は、その部位を行った日の数です（合計とは一致しません）';
}

function renderPartBars() {
  const from = rangeStart(state.an.monthRange);
  const cnt = {};
  for (const [d, s] of Object.entries(db.sessions)) {
    if (d < from) continue;
    for (const it of s.items) cnt[partOf(it.exercise)] = (cnt[partOf(it.exercise)] || 0) + it.sets.length;
  }
  const total = sum(Object.values(cnt));
  const max = Math.max(1, ...Object.values(cnt));
  $('#p-bars').innerHTML = total ? PARTS.filter(p => cnt[p]).sort((x, y) => cnt[y] - cnt[x]).map(p =>
    `<div class="hbar"><span>${p}</span><div class="bar" style="width:${cnt[p] / max * 100}%;background:${cssVar(PART_COLORS[PARTS.indexOf(p)])}"></div><span class="muted">${cnt[p]}（${Math.round(cnt[p] / total * 100)}%）</span></div>`
  ).join('') : '<div class="empty">記録がありません</div>';
}

/* ── グラフ（SVG・ライブラリなし） ───────────────────── */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

// 目盛り4つが切りのいい数字になる表示範囲を求める
function niceRange(lo, hi, padded) {
  if (padded) { const span = (hi - lo) || Math.max(1, hi * 0.1); lo = Math.max(0, lo - span * 0.1); hi += span * 0.1; }
  let step = niceMax((hi - lo) / 4 || 1);
  let min = Math.floor(lo / step) * step;
  while (min + step * 4 < hi) { step = niceMax(step * 1.01); min = Math.floor(lo / step) * step; }
  return [min, min + step * 4];
}

function axisFrame(W, H, pad, yMin, yMax, unit) {
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = yMin + (yMax - yMin) * i / 4;
    const y = H - pad.b - (H - pad.t - pad.b) * i / 4;
    g += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/>`;
    g += `<text x="${pad.l - 4}" y="${y + 3}" text-anchor="end">${fmt(v, v < 10 ? 1 : 0)}</text>`;
  }
  if (unit) g += `<text x="${pad.l - 4}" y="${pad.t - 6}" text-anchor="end">${unit}</text>`;
  return g;
}

// 日付の系列（x は日付。間隔は実際の日数に比例させる）
function drawSeriesChart(el, pts, type, unit, onPick) {
  const W = 340, H = 210, pad = { l: 38, r: 10, t: 16, b: 26 };
  const xs = pts.map(p => parseIso(p.x).getTime());
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const ys = pts.map(p => p.y);
  const [yMin, yMax] = niceRange(type === 'bar' ? 0 : Math.min(...ys), Math.max(...ys), type !== 'bar');
  const X = t => pad.l + (x1 === x0 ? (W - pad.l - pad.r) / 2 : (t - x0) / (x1 - x0) * (W - pad.l - pad.r));
  const Y = v => H - pad.b - (v - yMin) / (yMax - yMin) * (H - pad.t - pad.b);
  const color = cssVar('--chart-1');
  let g = axisFrame(W, H, pad, yMin, yMax, unit);
  // x軸ラベル（最大4つ）
  const n = Math.min(4, pts.length);
  for (let i = 0; i < n; i++) {
    const p = pts[Math.round(i * (pts.length - 1) / Math.max(1, n - 1))];
    const d = parseIso(p.x);
    g += `<text x="${X(d.getTime())}" y="${H - 8}" text-anchor="middle">${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}/${d.getDate()}</text>`;
  }
  if (type === 'line' && pts.length > 1) {
    g += `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${pts.map((p, i) => `${X(xs[i])},${Y(p.y)}`).join(' ')}"/>`;
  }
  const bw = Math.max(2, Math.min(14, (W - pad.l - pad.r) / pts.length * 0.7));
  pts.forEach((p, i) => {
    if (type === 'bar') g += `<rect x="${X(xs[i]) - bw / 2}" y="${Y(p.y)}" width="${bw}" height="${Y(yMin) - Y(p.y)}" rx="2" fill="${color}"/>`;
    else g += `<circle cx="${X(xs[i])}" cy="${Y(p.y)}" r="${type === 'dot' ? 3.5 : 2.5}" fill="${color}"/>`;
  });
  g += `<line id="cursor" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" stroke="${cssVar('--sub')}" stroke-dasharray="3 3" visibility="hidden"/>`;
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg>`;
  const svg = el.querySelector('svg');
  const pick = ev => {
    const r = svg.getBoundingClientRect();
    const cx = ((ev.touches?.[0]?.clientX ?? ev.clientX) - r.left) / r.width * W;
    let best = 0;
    xs.forEach((t, i) => { if (Math.abs(X(t) - cx) < Math.abs(X(xs[best]) - cx)) best = i; });
    const c = svg.querySelector('#cursor');
    c.setAttribute('x1', X(xs[best])); c.setAttribute('x2', X(xs[best])); c.setAttribute('visibility', 'visible');
    onPick(pts[best]);
  };
  svg.addEventListener('click', pick);
  svg.addEventListener('touchmove', pick, { passive: true });
}

// 月ごとの積み上げ棒グラフ
function drawStackChart(el, data, colors, unit, onPick) {
  const W = 340, H = 210, pad = { l: 38, r: 10, t: 16, b: 26 };
  const yMax = niceRange(0, Math.max(...data.map(d => sum(d.stack)), 0.001), false)[1];
  const n = data.length;
  const slot = (W - pad.l - pad.r) / n;
  const bw = Math.max(2, slot * 0.7);
  const Y = v => H - pad.b - v / yMax * (H - pad.t - pad.b);
  let g = axisFrame(W, H, pad, 0, yMax, unit);
  const step = Math.ceil(n / 6);
  data.forEach((d, i) => {
    const x = pad.l + slot * i + (slot - bw) / 2;
    let acc = 0;
    d.stack.forEach((v, k) => {
      if (!v) return;
      g += `<rect x="${x}" y="${Y(acc + v)}" width="${bw}" height="${Y(acc) - Y(acc + v)}" fill="${colors[k]}"/>`;
      acc += v;
    });
    if (i % step === 0) {
      const [yy, mm] = d.x.split('-');
      g += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${mm === '01' || i === 0 ? yy.slice(2) + '/' : ''}${Number(mm)}</text>`;
    }
  });
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg>`;
  const svg = el.querySelector('svg');
  const pick = ev => {
    const r = svg.getBoundingClientRect();
    const cx = ((ev.touches?.[0]?.clientX ?? ev.clientX) - r.left) / r.width * W;
    const i = Math.max(0, Math.min(n - 1, Math.floor((cx - pad.l) / slot)));
    onPick(data[i]);
  };
  svg.addEventListener('click', pick);
  svg.addEventListener('touchmove', pick, { passive: true });
}

/* ── AI出力（JSON） ──────────────────────────────── */
function dayJson(d) {
  const s = db.sessions[d];
  const sm = daySummary(s);
  return {
    date: d,
    weekday: WD[parseIso(d).getDay()],
    summary: { exercises: sm.exercises, sets: sm.sets, reps: sm.reps, volume_kg: round(sm.volume, 1) },
    exercises: s.items.filter(it => it.sets.length).map(it => ({
      name: it.exercise,
      part: partOf(it.exercise),
      sets: it.sets.map(st => it.kind === 'cardio'
        ? clean({ distance_km: st.km, minutes: st.min, kcal: st.kcal, memo: st.memo || undefined })
        : clean({ weight_kg: st.w, reps: st.r, est_1rm_kg: round(rm(st.w, st.r), 1), memo: st.memo || undefined })),
    })),
  };
}
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

function periodJson(from, to, label) {
  const days = Object.keys(db.sessions).filter(d => d >= from && d <= to).sort();
  const byEx = {};
  const byPart = {};
  let sets = 0, reps = 0, volume = 0;
  for (const d of days) {
    for (const it of db.sessions[d].items) {
      const e = byEx[it.exercise] || (byEx[it.exercise] = { name: it.exercise, part: partOf(it.exercise), days: 0, sets: 0, reps: 0, volume_kg: 0, best_weight_kg: null, best_est_1rm_kg: null });
      e.days++;
      byPart[partOf(it.exercise)] = (byPart[partOf(it.exercise)] || 0) + it.sets.length;
      for (const st of it.sets) {
        e.sets++; sets++;
        if (it.kind === 'cardio') continue;
        e.reps += st.r || 0; reps += st.r || 0;
        e.volume_kg += vol(st); volume += vol(st);
        if (st.w != null && (e.best_weight_kg == null || st.w > e.best_weight_kg)) e.best_weight_kg = st.w;
        const r1 = rm(st.w, st.r);
        if (r1 != null && (e.best_est_1rm_kg == null || r1 > e.best_est_1rm_kg)) e.best_est_1rm_kg = r1;
      }
    }
  }
  for (const e of Object.values(byEx)) { e.volume_kg = round(e.volume_kg, 1); e.best_est_1rm_kg = round(e.best_est_1rm_kg, 1); }
  return {
    period: { label, from, to },
    summary: { training_days: days.length, sets, reps, volume_kg: round(volume, 1), sets_by_part: byPart },
    exercises: Object.values(byEx).sort((x, y) => y.sets - x.sets),
    days: days.map(dayJson),
  };
}

function monthsJson(from, to) {
  const months = monthlyStats(from);
  return Object.entries(months).filter(([m]) => m <= to.slice(0, 7)).sort().map(([m, o]) => ({
    month: m, training_days: o.days, sets: o.sets, volume_kg: round(o.volume, 0),
    sets_by_part: Object.fromEntries(Object.entries(o.parts).map(([p, v]) => [p, v.sets])),
  }));
}

function buildExport() {
  const e = state.ex;
  const notes = {
    unit: 'kg', est_1rm: '推定1RM = 重量 × (1 + 回数/40)（筋トレMEMOと同じ式）', volume: '総負荷 = 重量 × 回数 の合計',
  };
  let body;
  if (e.scope === 'day') body = db.sessions[e.date] ? dayJson(e.date) : { date: e.date, exercises: [] };
  else if (e.scope === 'month') {
    const [y, m] = e.month.split('-').map(Number);
    body = periodJson(`${e.month}-01`, isoDate(new Date(y, m, 0)), `${y}年${m}月`);
  } else if (e.scope === 'range') body = periodJson(e.from, e.to, `${e.from}〜${e.to}`);
  else {
    const days = Object.keys(db.sessions).sort();
    body = { all_time: periodJson(days[0] || todayIso(), todayIso(), '全期間'), by_month: monthsJson('0000-00-00', todayIso()) };
    delete body.all_time.days;
    body.note = '全期間は月別の集計のみ。日別の詳細が必要な場合は期間を指定して出力してください。';
  }
  const json = JSON.stringify({ app: '筋トレログ', exported_at: new Date().toISOString(), notes, data: body }, null, 1);
  const prompt = `以下は私の筋トレ記録（JSON）です。内容を読んで、①良い点 ②気になる点（部位の偏り、停滞している種目、回復など）③次の1〜2週間の具体的なメニュー提案 を教えてください。\n\n`;
  return (e.prompt ? prompt : '') + json;
}

function renderExport() {
  $('#title').textContent = 'AI出力';
  const e = state.ex;
  const scopes = [['day', 'その日'], ['month', '月'], ['range', '期間'], ['all', '全期間（月別）']];
  $('#view').innerHTML = `
    <div class="card">
      <h2>AIに相談するためのJSON</h2>
      <div class="chips" style="margin-bottom:10px">${scopes.map(([k, v]) => `<button class="chip ${e.scope === k ? 'on' : ''}" data-scope="${k}">${v}</button>`).join('')}</div>
      ${e.scope === 'day' ? `<label class="field"><span>日付</span><input type="date" id="x-date" value="${e.date}"></label>` : ''}
      ${e.scope === 'month' ? `<label class="field"><span>月</span><input type="month" id="x-month" value="${e.month}" style="border:1px solid var(--line);border-radius:10px;padding:9px 10px;width:100%;background:var(--card)"></label>` : ''}
      ${e.scope === 'range' ? `<div class="row"><label class="field" style="flex:1"><span>開始</span><input type="date" id="x-from" value="${e.from}"></label><label class="field" style="flex:1"><span>終了</span><input type="date" id="x-to" value="${e.to}"></label></div>` : ''}
      <label class="row" style="margin:4px 0 10px"><input type="checkbox" id="x-prompt" ${e.prompt ? 'checked' : ''}> <span>相談用の依頼文を先頭に付ける</span></label>
      <div class="row">
        <button class="btn primary" id="x-copy" style="flex:1">コピー</button>
        <button class="btn" id="x-share" style="flex:1">共有・保存</button>
      </div>
      <pre class="json" id="x-pre"></pre>
      <div class="muted" id="x-size"></div>
    </div>`;
  const text = buildExport();
  $('#x-pre').textContent = text.length > 6000 ? text.slice(0, 6000) + '\n…（以下省略。コピーすると全文が入ります）' : text;
  $('#x-size').textContent = `${text.length.toLocaleString()} 文字`;
  $('#view').querySelectorAll('[data-scope]').forEach(b => b.onclick = () => { e.scope = b.dataset.scope; render(); });
  $('#x-date')?.addEventListener('change', ev => { e.date = ev.target.value; render(); });
  $('#x-month')?.addEventListener('change', ev => { e.month = ev.target.value; render(); });
  $('#x-from')?.addEventListener('change', ev => { e.from = ev.target.value; render(); });
  $('#x-to')?.addEventListener('change', ev => { e.to = ev.target.value; render(); });
  $('#x-prompt').onchange = ev => { e.prompt = ev.target.checked; render(); };
  $('#x-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast('コピーしました。AIのチャットに貼り付けてください'); }
    catch { fallbackCopy(text); }
  };
  $('#x-share').onclick = () => shareText(text, `kintore-${e.scope}-${todayIso()}.json`);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('コピーしました'); } catch { toast('コピーできませんでした'); }
  ta.remove();
}

async function shareText(text, filename) {
  const file = new File([text], filename, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ── 設定 ────────────────────────────────────────── */
function renderSettings() {
  $('#title').textContent = '設定';
  const days = Object.keys(db.sessions).sort();
  const nSets = sum(Object.values(db.sessions).map(s => daySummary(s).sets));
  const bytes = (localStorage.getItem(STORE_KEY) || '').length;
  const last = db.meta.lastBackup ? new Date(db.meta.lastBackup).toLocaleString('ja-JP') : 'まだありません';
  $('#view').innerHTML = `
    <div class="card">
      <h2>データ</h2>
      <div class="muted">${days.length} 日・${nSets} セット・種目 ${Object.keys(db.exercises).length}${days.length ? `（${days[0]} 〜 ${days[days.length - 1]}）` : ''}<br>
      保存先: この端末のみ（約 ${Math.round(bytes / 1024)} KB）<br>最後のバックアップ: ${last}</div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="s-backup" style="flex:1">バックアップ</button>
        <button class="btn" id="s-import" style="flex:1">取り込み</button>
      </div>
      <input type="file" id="s-file" accept=".json,.csv,application/json,text/csv" class="hidden">
      <p class="muted" style="margin:10px 0 0">データはこのiPhoneの中にだけ保存されます。機種変更やSafariのデータ削除に備えて、ときどき「バックアップを保存」でファイルに書き出してください（ファイルAppやiCloud Driveに保存できます）。</p>
    </div>
    <div class="card">
      <h2>種目の管理</h2>
      <div class="muted" style="margin-bottom:8px">名前の変更、部位の設定、同じ種目の統合ができます。</div>
      <div class="pick-list" id="s-ex"></div>
    </div>
    <div class="card">
      <h2>このアプリについて</h2>
      <div class="muted">筋トレログ v${APP_VERSION}<br>オフラインで動作します。記録はサーバーに送信されません。</div>
      <button class="btn danger block" id="s-wipe" style="margin-top:12px">すべての記録を削除</button>
    </div>`;
  $('#s-ex').innerHTML = exerciseNamesByRecent().map(x =>
    `<button data-ex="${esc(x.name)}"><span>${esc(x.name)}</span><span class="sub">${esc(partOf(x.name))}・${x.count}セット</span></button>`).join('')
    || '<div class="empty">種目がありません</div>';
  $('#s-ex').querySelectorAll('[data-ex]').forEach(b => b.onclick = () => openExerciseEditor(b.dataset.ex));
  $('#s-backup').onclick = () => {
    db.meta.lastBackup = new Date().toISOString(); saveDb();
    shareText(JSON.stringify(db), `kintore-backup-${todayIso()}.json`);
    setTimeout(render, 500);
  };
  $('#s-import').onclick = () => $('#s-file').click();
  $('#s-file').onchange = ev => { const f = ev.target.files[0]; if (f) importFile(f); ev.target.value = ''; };
  $('#s-wipe').onclick = () => {
    if (!confirm('すべての記録を削除します。元に戻せません。先にバックアップを保存しましたか？')) return;
    if (!confirm('本当に削除しますか？')) return;
    db = emptyDb(); saveDb(); render(); toast('削除しました');
  };
}

function openExerciseEditor(name) {
  const info = db.exercises[name] || { part: 'その他', kind: 'strength' };
  const others = exerciseNamesByRecent().map(x => x.name).filter(n => n !== name);
  openSheet(`
    <h3>${esc(name)}</h3>
    <label class="field"><span>名前</span><input type="text" id="e-name" value="${esc(name)}"></label>
    <label class="field"><span>部位</span><select id="e-part">${PARTS.map(p => `<option ${p === info.part ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
    <label class="field"><span>別の種目に統合（記録をすべて移す）</span>
      <select id="e-merge"><option value="">統合しない</option>${others.map(n => `<option>${esc(n)}</option>`).join('')}</select></label>
    <div class="row"><button class="btn" id="e-cancel">キャンセル</button><span class="spacer"></span><button class="btn primary" id="e-ok">保存</button></div>
  `, sh => {
    sh.querySelector('#e-cancel').onclick = closeSheet;
    sh.querySelector('#e-ok').onclick = () => {
      const newName = sh.querySelector('#e-name').value.trim();
      const merge = sh.querySelector('#e-merge').value;
      const part = sh.querySelector('#e-part').value;
      const target = merge || newName;
      if (!target) { toast('名前を入れてください'); return; }
      if (merge && !confirm(`「${name}」の記録をすべて「${merge}」に移します。よろしいですか？`)) return;
      if (!merge && target !== name && db.exercises[target] && !confirm(`「${target}」はすでにあります。統合しますか？`)) return;
      renameExercise(name, target);
      db.exercises[target] = { ...(db.exercises[target] || info), part: merge ? (db.exercises[target]?.part || part) : part };
      saveDb(); closeSheet(); render(); toast('保存しました');
    };
  });
}

function renameExercise(from, to) {
  if (from === to) return;
  for (const s of Object.values(db.sessions)) {
    const src = s.items.find(i => i.exercise === from);
    if (!src) continue;
    const dst = s.items.find(i => i.exercise === to);
    if (dst) { dst.sets.push(...src.sets); s.items.splice(s.items.indexOf(src), 1); }
    else src.exercise = to;
  }
  if (!db.exercises[to]) db.exercises[to] = db.exercises[from];
  delete db.exercises[from];
}

async function importFile(file) {
  const text = await file.text();
  let incoming;
  try {
    incoming = file.name.toLowerCase().endsWith('.csv') ? csvToDb(text) : normalizeDb(JSON.parse(text));
  } catch (e) {
    toast('読み込めませんでした: ' + e.message); return;
  }
  const inDays = Object.keys(incoming.sessions);
  if (!inDays.length) { toast('記録が見つかりませんでした'); return; }
  const overlap = inDays.filter(d => db.sessions[d]).length;
  const hasData = Object.keys(db.sessions).length > 0;
  let mode = 'merge';
  if (hasData) {
    const replaceAll = confirm(`${inDays.length}日分の記録があります（いまのデータと重なる日: ${overlap}日）。\n\nOK: いまのデータを全部置き換える\nキャンセル: 追加する（重なる日は取り込む側で上書き）`);
    mode = replaceAll ? 'replace' : 'merge';
  }
  if (mode === 'replace') db = emptyDb();
  Object.assign(db.sessions, incoming.sessions);
  for (const [n, v] of Object.entries(incoming.exercises)) db.exercises[n] = db.exercises[n] || v;
  // 種目情報が無い種目は記録から補う
  for (const s of Object.values(db.sessions)) for (const it of s.items) db.exercises[it.exercise] ||= { part: 'その他', kind: it.kind || 'strength' };
  saveDb(); render();
  toast(`${inDays.length}日分を取り込みました`);
}

// 筋トレMEMOから書き出したCSV（日付,種目,セット,重量kg,回数,RMkg,メモ）を取り込む
function parseCsv(text) {
  // ダブルクォートで囲まれた値（カンマ・改行を含む）に対応した最小限のCSVパーサ
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(Boolean));
}

function csvToDb(text) {
  const lines = parseCsv(text.replace(/^﻿/, ''));
  const head = lines.shift();
  const col = n => head.indexOf(n);
  if (col('日付') < 0 || col('種目') < 0) throw new Error('「日付」「種目」の列がありません');
  const out = emptyDb();
  for (const c of lines) {
    const d = c[col('日付')], ex = c[col('種目')], memo = c[col('メモ')] || '';
    if (!d || !ex) continue;
    const day = out.sessions[d] || (out.sessions[d] = { items: [] });
    const cardio = memo.startsWith('有酸素:');
    let it = day.items.find(i => i.exercise === ex);
    if (!it) { it = { exercise: ex, kind: cardio ? 'cardio' : 'strength', sets: [] }; day.items.push(it); }
    if (cardio) {
      const g = re => { const m = memo.match(re); return m ? parseFloat(m[1]) : null; };
      it.sets.push({ km: g(/([\d.]+)km/), min: g(/([\d.]+)分/), kcal: g(/([\d.]+)kcal/), memo: '' });
    } else {
      it.sets.push({ w: numOrNull(c[col('重量kg')]), r: numOrNull(c[col('回数')]), memo: memo === '回数の記録なし' ? '' : memo });
    }
    out.exercises[ex] ||= { part: 'その他', kind: it.kind };
  }
  return out;
}

/* ── 起動 ────────────────────────────────────────── */
render();
navigator.storage?.persist?.();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW登録失敗', e));
}
