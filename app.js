/* 筋トレログ — iPhoneのホーム画面に追加して使う、オフライン対応の筋トレ記録アプリ
 * 記録の流れと種目は「筋トレMEMO」に合わせている。
 * データは端末内（localStorage）にだけ保存する。サーバーには送らない。
 */
'use strict';

const STORE_KEY = 'kintore-log-v1';
const APP_VERSION = '1.1.0';
const PARTS = ['腕', '胸', '背中', '肩', '脚', '腹筋', '有酸素', 'その他'];
const PART_LABEL = { '有酸素': '有酸素運動' };
const PART_COLORS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8'];

// 筋トレMEMOに登録されている種目（部位ごと・アプリの表示順）
const MASTER = {
  '腕': ['握力グリップ', 'リストカール', 'アームカール（ワンハンド）', 'アームカール', 'ハンマーカール', 'スカルクラッシャー', 'バーベルカール', 'ケーブルプレスダウン'],
  '胸': ['ダンベルプレス（ディクライン）', 'ダンベルプレス', 'ダンベルプレス（フラット）', 'ダンベルフライ', 'ベンチプレス', 'ケーブルクロスオーバー', '腕立て伏せ', 'インクラインダンベルプレス'],
  '背中': ['斜め懸垂', 'インクラインダンベルロウ', 'ベントオーバーロー', 'ワンハンドローイング', 'デッドリフト', 'チンニング（懸垂）'],
  '肩': ['太智アップ', '太智袋入れマッスルマッスル', 'ダンベルローイング', 'ショルダープレス', 'アーノルドプレス', 'バタフライ', 'スミスバックプレス', 'サイドレイズ', 'フロントレイズ', 'ダンベルショルダープレス', 'ケーブルフェイスプル'],
  '脚': ['カーフレイズ', 'スクワット', 'スミスマシン・バーベルスクワット', 'レッグプレス', 'レッグエクステンション', 'レッグカール'],
  '腹筋': ['クランチ', 'レッグレイズ', 'アブローラー', 'プランク', '上体起こし'],
  '有酸素': ['自転車', 'ランニング'],
};
// 過去の記録にあるが、いまの筋トレMEMOの一覧にはない種目
const LEGACY = {
  'プーリーロー': '背中', 'ラットプルダウン': '背中', 'ビュアロウ': '背中', 'アップライトロウ': '肩',
  '肩7分トレ': '肩', 'ケーブルクロス': '胸', 'フレンチプレス': '腕',
};
const MASTER_VERSION = 1;

/* ── データ ──────────────────────────────────────────────
 * db = {
 *   sessions: { 'YYYY-MM-DD': { items: [ { exercise, kind: 'strength'|'cardio', sets: [...] } ] } },
 *   exercises: { 名前: { part, kind } },
 *   meta: { lastBackup, master }
 * }
 * 筋トレのセット: { w: 重量kg, r: 回数, memo, assist }   有酸素のセット: { km, min, kcal, memo }
 */
let db = loadDb();

function emptyDb() {
  return { app: 'kintore-log', version: 1, sessions: {}, exercises: {}, meta: {} };
}
function loadDb() {
  let d = emptyDb();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) d = normalizeDb(JSON.parse(raw));
  } catch (e) { console.error(e); }
  return applyMaster(d);
}
function normalizeDb(d) {
  const out = emptyDb();
  out.sessions = d.sessions || {};
  out.exercises = d.exercises || {};
  out.meta = d.meta || {};
  return out;
}
// 種目一覧を筋トレMEMOに合わせる（初回だけ部位を上書きし、その後はユーザーの変更を尊重する）
function applyMaster(d) {
  const first = (d.meta.master || 0) < MASTER_VERSION;
  for (const [part, names] of Object.entries(MASTER)) {
    for (const n of names) {
      const kind = part === '有酸素' ? 'cardio' : 'strength';
      if (!d.exercises[n] || first) d.exercises[n] = { ...(d.exercises[n] || {}), part, kind };
    }
  }
  for (const [n, part] of Object.entries(LEGACY)) {
    if (d.exercises[n] && first) d.exercises[n].part = part;
  }
  for (const s of Object.values(d.sessions)) {
    for (const it of s.items) d.exercises[it.exercise] ||= { part: 'その他', kind: it.kind || 'strength' };
  }
  d.meta.master = MASTER_VERSION;
  return d;
}
let saveTimer;
function saveDb(now = true) {
  clearTimeout(saveTimer);
  const write = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
    catch (e) { toast('保存できませんでした（容量不足の可能性）'); console.error(e); }
  };
  if (now) write(); else saveTimer = setTimeout(write, 300);
}
// 入力途中の空のセット・空の種目・空の日を取り除く
function cleanupDay(date) {
  const s = db.sessions[date];
  if (!s) return;
  for (const it of s.items) it.sets = it.sets.filter(st => !isEmptySet(st, it.kind));
  s.items = s.items.filter(it => it.sets.length);
  if (!s.items.length) delete db.sessions[date];
  saveDb();
}
const isEmptySet = (s, kind) => kind === 'cardio'
  ? s.km == null && s.min == null && s.kcal == null && !s.memo
  : s.w == null && s.r == null && !s.memo;

/* ── 計算 ─────────────────────────────────────────── */
// RM（推定1RM）は筋トレMEMOと同じ式: 重量 × (1 + 回数/40)
const rm = (w, r) => (w != null && r != null && r > 0) ? w * (1 + r / 40) : null;
const vol = s => (s.w != null && s.r != null) ? s.w * s.r : 0;
const round = (v, n = 1) => v == null ? null : Math.round(v * 10 ** n) / 10 ** n;
const fmt = (v, n = 1) => v == null ? '-' : (Math.round(v * 10 ** n) / 10 ** n).toLocaleString('ja-JP', { maximumFractionDigits: n });
const fmtFixed = (v, n = 1) => v == null ? '' : (Math.round(v * 10 ** n) / 10 ** n).toFixed(n);
const sum = a => a.reduce((x, y) => x + (y || 0), 0);
const kindOf = name => db.exercises[name]?.kind || 'strength';
const partOf = name => db.exercises[name]?.part || 'その他';
const partLabel = p => PART_LABEL[p] || p;

function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
const todayIso = () => isoDate(new Date());
function parseIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseIso(s); d.setDate(d.getDate() + n); return isoDate(d); }
const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);
const WD = ['日', '月', '火', '水', '木', '金', '土'];
function labelDate(s) { const d = parseIso(s); return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; }
function labelDateY(s) { const d = parseIso(s); return `${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}/${d.getDate()}`; }
const slashDate = s => s.replaceAll('-', '/');

function daySummary(session) {
  let sets = 0, reps = 0, volume = 0;
  for (const it of session?.items || []) {
    for (const s of it.sets) {
      if (isEmptySet(s, it.kind)) continue;
      sets++;
      if (it.kind !== 'cardio') { reps += s.r || 0; volume += vol(s); }
    }
  }
  return { exercises: (session?.items || []).filter(it => it.sets.some(s => !isEmptySet(s, it.kind))).length, sets, reps, volume };
}
// fromIso 以降（含む）の総負荷量（kg）
function volumeSince(fromIso, toIso = '9999-12-31') {
  let v = 0;
  for (const [d, s] of Object.entries(db.sessions)) if (d >= fromIso && d <= toIso) v += daySummary(s).volume;
  return v;
}

// 種目ごとの日別集計（分析で使う）
function exerciseHistory(name) {
  const out = [];
  for (const [d, s] of Object.entries(db.sessions).sort()) {
    for (const it of s.items) {
      if (it.exercise !== name) continue;
      if (it.kind === 'cardio') {
        out.push({ date: d, km: sum(it.sets.map(x => x.km)), min: sum(it.sets.map(x => x.min)),
                   kcal: sum(it.sets.map(x => x.kcal)), sets: it.sets.length, raw: it.sets, cardio: true });
        continue;
      }
      const st = it.sets.filter(x => x.w != null && x.r != null);
      out.push({
        date: d,
        maxW: st.length ? Math.max(...st.map(x => x.w)) : null,
        maxRm: st.length ? Math.max(...st.map(x => rm(x.w, x.r))) : null,
        volume: sum(st.map(vol)), reps: sum(st.map(x => x.r)), sets: it.sets.length, raw: it.sets,
      });
    }
  }
  return out;
}

// 種目ごとの最後に行った日と回数
function exerciseUsage() {
  const last = {}, count = {};
  for (const [d, s] of Object.entries(db.sessions)) {
    for (const it of s.items) {
      if (!last[it.exercise] || last[it.exercise] < d) last[it.exercise] = d;
      count[it.exercise] = (count[it.exercise] || 0) + it.sets.length;
    }
  }
  return { last, count };
}
function exerciseNamesByRecent() {
  const { last, count } = exerciseUsage();
  return Object.keys(db.exercises).map(n => ({ name: n, last: last[n] || '', count: count[n] || 0 }))
    .sort((a, b) => b.last.localeCompare(a.last) || b.count - a.count);
}
// 部位の中の種目を、最近行った順（行っていない種目は筋トレMEMOの並び順）で返す
function exercisesOfPart(part) {
  const { last } = exerciseUsage();
  const master = MASTER[part] || [];
  return Object.keys(db.exercises).filter(n => partOf(n) === part && !db.exercises[n].hidden)
    .sort((a, b) => (last[b] || '').localeCompare(last[a] || '') ||
      ((master.indexOf(a) + 1 || 999) - (master.indexOf(b) + 1 || 999)) || a.localeCompare(b));
}

function previousRecord(name, beforeDate) {
  const dates = Object.keys(db.sessions).filter(d => d < beforeDate).sort().reverse();
  for (const d of dates) {
    const it = db.sessions[d].items.find(i => i.exercise === name && i.sets.length);
    if (it) return { date: d, sets: it.sets, kind: it.kind };
  }
  return null;
}

/* ── UI共通 ──────────────────────────────────────── */
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const numOrNull = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

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

/* ── 画面遷移 ─────────────────────────────────────
 * タブの最初の画面の上に、日・種目選択・種目（セット入力）の画面を積み重ねる。
 */
const state = {
  tab: 'home',
  view: { name: 'home' },
  stack: [],
  histMonth: todayIso().slice(0, 7),
  homeMonth: todayIso().slice(0, 7),
  an: { exercise: null, metric: 'maxRm', range: '1y', type: 'line', monthMetric: 'volume', monthRange: '1y', stackParts: true },
  ex: { scope: 'month', date: todayIso(), month: todayIso().slice(0, 7), from: addDays(todayIso(), -27), to: todayIso(), prompt: true },
  pickerOpen: {},
};

function leaveView() {
  stopTimer();
  const v = state.view;
  if (v.date && (v.name === 'exercise' || v.name === 'day')) cleanupDay(v.date);
}
function go(view, replace = false) {
  leaveView();
  if (!replace) state.stack.push(state.view);
  state.view = view;
  render();
  window.scrollTo(0, 0);
}
function back() {
  leaveView();
  state.view = state.stack.pop() || { name: state.tab };
  render();
}
function setTab(tab) {
  leaveView();
  state.tab = tab;
  state.stack = [];
  state.view = { name: tab };
  for (const b of document.querySelectorAll('#tabbar button')) b.classList.toggle('active', b.dataset.tab === tab);
  render();
  window.scrollTo(0, 0);
}
document.querySelectorAll('#tabbar button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#tb-back').addEventListener('click', back);

function render() {
  const views = {
    home: renderHome, day: renderDay, picker: renderPicker, exercise: renderExercise,
    history: renderHistory, analysis: renderAnalysis, export: renderExport, settings: renderSettings,
  };
  $('#topbar-actions').innerHTML = '';
  const prev = state.stack[state.stack.length - 1];
  $('#tb-back').classList.toggle('hidden', !prev);
  $('#tb-back-label').textContent = prev ? backLabel(prev) : '';
  document.body.classList.toggle('with-fab', ['day', 'exercise'].includes(state.view.name));
  views[state.view.name]();
}
function backLabel(v) {
  if (v.name === 'day') return slashDate(v.date);
  if (v.name === 'picker') return '種目を選択';
  return { home: 'ホーム', history: '履歴', analysis: '分析', export: 'AI出力', settings: '設定' }[v.name] || '戻る';
}

/* ── ホーム ──────────────────────────────────────── */
const EQUIV = [  // 負荷量のたとえ（筋トレMEMOのアイコン表示にならう）
  { ico: '🚗', label: '乗用車', t: 1.5 }, { ico: '🚌', label: 'バス', t: 14 }, { ico: '✈️', label: 'ジャンボ機', t: 350 },
];
function renderHome() {
  $('#title').textContent = '筋トレログ';
  const today = todayIso();
  const [y, m] = state.homeMonth.split('-').map(Number);
  const v7 = volumeSince(addDays(today, -7)) / 1000;
  const v28 = volumeSince(addDays(today, -28)) / 1000;
  const vAll = volumeSince('0000-00-00') / 1000;
  // 週ごとの負荷量（今週＝日曜はじまり）
  const wd = parseIso(today).getDay();
  const weekStart = addDays(today, -wd);
  const weeks = [0, 1, 2, 3, 4].map(i => {
    const from = addDays(weekStart, -7 * i), to = addDays(from, 6);
    return { label: i === 0 ? '今週' : `${i}週前`, v: volumeSince(from, to) };
  });
  const wmax = Math.max(1, ...weeks.map(w => w.v));
  const monthDays = Object.keys(db.sessions).filter(d => d.startsWith(state.homeMonth)).length;
  const totalDays = Object.keys(db.sessions).length;
  const monthName = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' });

  // カレンダー（記録日は白丸、今日は枠）
  const first = new Date(y, m - 1, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  let cal = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(w => `<span class="dow">${w}</span>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = isoDate(d);
    const out = d.getMonth() !== m - 1;
    if (i >= 35 && out) break;
    cal += `<button data-day="${iso}" class="${out ? 'out' : ''} ${db.sessions[iso] ? 'has' : ''} ${iso === today ? 'today' : ''}">${d.getDate()}</button>`;
  }
  const eq = (t, e) => `<span class="equiv">${e.ico} × ${fmtFixed(t / e.t, 1)}</span>`;
  $('#view').innerHTML = `
    <section class="home-hero">
      <div class="home-cal">
        <div class="hc-title"><button id="hm-prev" aria-label="前の月">‹</button><b>${monthName} ${y}</b><button id="hm-next" aria-label="次の月">›</button></div>
        <div class="hc-grid">${cal}</div>
        <div class="archive">
          <div><small>MONTHLY<br>ARCHIVE</small></div>
          <div class="arc-num"><b>${monthDays}</b> days</div>
          <div class="arc-total"><small>TOTAL</small><b>${totalDays} days</b></div>
        </div>
      </div>
      <div class="home-panels">
        <div class="panel">
          <div class="p-head">合計負荷量 / 7日間</div>
          <div class="p-val"><b>${fmtFixed(v7, 1)} t</b>${eq(v7, EQUIV[0])}</div>
          <div class="weeks">${weeks.map(w => `<div class="wk"><span>${w.label}</span><i style="width:${w.v / wmax * 100}%"></i><em>${fmtFixed(w.v / 1000, 1)}</em></div>`).join('')}</div>
        </div>
        <div class="panel">
          <div class="p-head">合計負荷量 / 28日間</div>
          <div class="p-val"><b>${fmtFixed(v28, 2)} t</b>${eq(v28, EQUIV[1])}</div>
        </div>
        <div class="panel">
          <div class="p-head">総合計負荷量</div>
          <div class="p-val"><b>${fmtFixed(vAll, 2)} t</b>${eq(vAll, EQUIV[2])}</div>
        </div>
      </div>
    </section>
    <div class="home-actions">
      <button class="btn big primary" id="h-today">⊕ 今日のトレーニング追加</button>
      <button class="btn big outline" id="h-rm">RM計算</button>
    </div>
    <div class="card">
      <h2>期間を指定して合計負荷量を見る</h2>
      <div class="chips" id="h-range">${[7, 14, 28, 90, 180, 365].map(n => `<button class="chip" data-n="${n}">${n}日</button>`).join('')}</div>
      <div class="row" style="margin-top:8px">
        <input type="date" id="h-from" value="${addDays(today, -28)}"><span>〜</span><input type="date" id="h-to" value="${today}">
      </div>
      <div class="range-result" id="h-result"></div>
    </div>
    ${totalDays === 0 ? importCardHtml() : ''}`;

  $('#view').querySelectorAll('[data-day]').forEach(b => b.onclick = () => go({ name: 'day', date: b.dataset.day }));
  const shift = n => { const d = new Date(y, m - 1 + n, 1); state.homeMonth = isoDate(d).slice(0, 7); render(); };
  $('#hm-prev').onclick = () => shift(-1);
  $('#hm-next').onclick = () => shift(1);
  $('#h-today').onclick = () => go({ name: 'day', date: todayIso() });
  $('#h-rm').onclick = openRmCalc;
  const showRange = () => {
    const from = $('#h-from').value, to = $('#h-to').value;
    if (!from || !to) return;
    const days = Object.keys(db.sessions).filter(d => d >= from && d <= to);
    const v = volumeSince(from, to);
    $('#h-result').innerHTML = `<b>${fmtFixed(v / 1000, 2)} t</b><span class="muted">（${fmt(v, 0)} kg・${days.length}日・${daysBetween(from, to) + 1}日間）</span>`;
  };
  $('#h-range').querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
    // 筋トレMEMOと同じく「今日を含めて n+1 日前から」で数える（28日間 → 28日前〜今日）
    $('#h-from').value = addDays(todayIso(), -Number(b.dataset.n)); $('#h-to').value = todayIso();
    $('#h-range').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
    showRange();
  });
  $('#h-from').onchange = showRange;
  $('#h-to').onchange = showRange;
  showRange();
  bindImportCard();
}

function importCardHtml() {
  return `
    <div class="card">
      <h2>これまでの記録を取り込む</h2>
      <div class="muted">筋トレMEMOから移した記録ファイル（kintore_initial.json または CSV）を選ぶと、過去の記録が表示されます。ファイルは先にAirDropなどで「ファイル」Appに保存しておいてください。</div>
      <button class="btn primary block" id="first-import" style="margin-top:10px">ファイルを選んで取り込む</button>
      <input type="file" id="first-file" accept=".json,.csv,application/json,text/csv" class="hidden">
    </div>`;
}
function bindImportCard() {
  $('#first-import')?.addEventListener('click', () => $('#first-file').click());
  $('#first-file')?.addEventListener('change', ev => { const f = ev.target.files[0]; if (f) importFile(f); });
}

function openRmCalc() {
  openSheet(`
    <h3>RM計算</h3>
    <div class="row">
      <label class="field" style="flex:1"><span>重さ（kg）</span><input type="text" inputmode="decimal" id="rc-w" value="60"></label>
      <label class="field" style="flex:1"><span>回数</span><input type="text" inputmode="numeric" id="rc-r" value="10"></label>
    </div>
    <div class="rm-big" id="rc-out"></div>
    <table class="pr-table" id="rc-table"></table>
    <p class="muted">推定1RM ＝ 重さ ×（1 ＋ 回数 ÷ 40）。筋トレMEMOと同じ式です。</p>
    <button class="btn block" id="rc-close">閉じる</button>
  `, sh => {
    const upd = () => {
      const w = numOrNull(sh.querySelector('#rc-w').value), r = numOrNull(sh.querySelector('#rc-r').value);
      const one = rm(w, r);
      sh.querySelector('#rc-out').innerHTML = one ? `1RM <b>${fmt(one, 1)} kg</b>` : '';
      sh.querySelector('#rc-table').innerHTML = one ? [1, 3, 5, 8, 10, 12, 15, 20].map(n =>
        `<tr><td>${n}回できる重さ</td><td><b>${fmt(one / (1 + n / 40), 1)} kg</b></td><td>${Math.round(100 / (1 + n / 40))}%</td></tr>`).join('') : '';
    };
    sh.querySelectorAll('input').forEach(i => i.addEventListener('input', upd));
    sh.querySelector('#rc-close').onclick = closeSheet;
    upd();
  });
}

/* ── 日（その日の記録一覧） ─────────────────────────── */
function renderDay() {
  const date = state.view.date;
  $('#title').textContent = slashDate(date);
  $('#topbar-actions').innerHTML = '<button id="d-menu" aria-label="メニュー">⋮</button>';
  $('#d-menu').onclick = () => openDayMenu(date);
  const session = db.sessions[date];
  const sm = daySummary(session);
  let html = `
    <div class="day-nav">
      <button id="d-prev">‹ 前の日</button>
      <span>${labelDate(date)}</span>
      <button id="d-next">次の日 ›</button>
    </div>
    <div class="totals">
      <div><span>合計種目数</span><b>${sm.exercises}</b></div>
      <div><span>合計セット数</span><b>${sm.sets}</b></div>
      <div><span>合計レップ数</span><b>${fmt(sm.reps, 0)}</b></div>
      <div><span>合計負荷量</span><b>${fmt(sm.volume, 0)}</b></div>
    </div>`;
  if (!session || !session.items.length) {
    html += `<button class="day-empty" id="d-empty"><span class="big-ico">💪</span>タップしてトレーニング記録を追加</button>`;
    const prev = Object.keys(db.sessions).filter(d => d < date).sort().pop();
    if (prev) html += `<button class="btn ghost block" id="d-copy">${labelDate(prev)} のメニューをコピー</button>`;
  } else {
    session.items.forEach((it, idx) => { html += dayCard(it, idx, session.items.length); });
  }
  html += `<button class="fab" id="d-add" aria-label="種目を追加">＋</button>`;
  $('#view').innerHTML = html;

  $('#d-prev').onclick = () => go({ name: 'day', date: addDays(date, -1) }, true);
  $('#d-next').onclick = () => go({ name: 'day', date: addDays(date, 1) }, true);
  $('#d-add').onclick = () => go({ name: 'picker', date });
  $('#d-empty')?.addEventListener('click', () => go({ name: 'picker', date }));
  $('#d-copy')?.addEventListener('click', () => copyMenu(Object.keys(db.sessions).filter(d => d < date).sort().pop(), date));
  $('#view').querySelectorAll('[data-open]').forEach(el => el.onclick = () => go({ name: 'exercise', date, idx: Number(el.dataset.open) }));
  $('#view').querySelectorAll('[data-move]').forEach(el => el.onclick = ev => {
    ev.stopPropagation();
    const i = Number(el.dataset.i), j = i + Number(el.dataset.move);
    [session.items[i], session.items[j]] = [session.items[j], session.items[i]];
    saveDb(); render();
  });
  $('#view').querySelectorAll('[data-del]').forEach(el => el.onclick = ev => {
    ev.stopPropagation();
    const [i, s] = el.dataset.del.split(':').map(Number);
    const it = session.items[i];
    if (!confirm(`${it.exercise} のセット${s + 1}を削除しますか？`)) return;
    it.sets.splice(s, 1);
    cleanupDay(date); render();
  });
}

function dayCard(it, idx, n) {
  const cardio = it.kind === 'cardio';
  const head = cardio
    ? '<tr><th>セット</th><th>距離</th><th>時間</th><th>カロリー</th><th></th></tr>'
    : '<tr><th>セット</th><th>重さ</th><th>回数</th><th>RM</th><th></th></tr>';
  const rows = it.sets.map((s, i) => {
    const main = cardio
      ? `<td><b>${fmt(s.km, 2)}</b> <small>km</small></td><td><b>${fmt(s.min, 2)}</b> <small>min</small></td><td><small>${s.kcal != null ? fmt(s.kcal, 1) + 'kcal' : ''}</small></td>`
      : `<td><b>${s.w != null ? fmtFixed(s.w, 1) : '-'}</b> <small>Kg</small> <small class="lbs">${s.w != null ? fmtFixed(s.w * 2.20462, 2) + 'Lbs' : ''}</small></td>
         <td><b>${s.r ?? '-'}</b> <small>回</small></td><td><small>${rm(s.w, s.r) != null ? fmt(rm(s.w, s.r), 2) + 'Kg' : '-'}</small></td>`;
    return `<tr data-open="${idx}"><td class="no">${i + 1}${s.assist ? '<small class="assist">補</small>' : ''}</td>${main}<td><button class="trash" data-del="${idx}:${i}" aria-label="削除">🗑</button></td></tr>` +
      (s.memo ? `<tr class="memo" data-open="${idx}"><td></td><td colspan="4">${esc(s.memo)}</td></tr>` : '');
  }).join('');
  return `
  <div class="ex-card">
    <div class="ex-head" data-open="${idx}">
      <span class="name">${esc(it.exercise)}</span>
      <button data-move="-1" data-i="${idx}" ${idx === 0 ? 'disabled' : ''} aria-label="上へ"><svg width="16" height="10" viewBox="0 0 16 10"><path d="M2 8 L8 2 L14 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button data-move="1" data-i="${idx}" ${idx === n - 1 ? 'disabled' : ''} aria-label="下へ"><svg width="16" height="10" viewBox="0 0 16 10"><path d="M2 2 L8 8 L14 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>
    <table class="sets">${head}${rows}</table>
    <button class="add-set" data-open="${idx}" aria-label="セットを追加">＋</button>
  </div>`;
}

function copyMenu(from, to) {
  if (!from) return;
  const session = db.sessions[to] || (db.sessions[to] = { items: [] });
  for (const it of db.sessions[from].items) {
    if (session.items.some(x => x.exercise === it.exercise)) continue;
    session.items.push({ exercise: it.exercise, kind: it.kind, sets: it.sets.map(s => ({ ...s })) });
  }
  saveDb(); render();
  toast(`${labelDate(from)} の内容をコピーしました`);
}

function openDayMenu(date) {
  const isToday = date === todayIso();
  openSheet(`
    <h3>${slashDate(date)}</h3>
    <div class="pick-list">
      ${!isToday && db.sessions[date] ? '<button data-m="copy-today">本日にコピーする</button>' : ''}
      <button data-m="ai">この日をAI出力（JSON）</button>
      ${db.sessions[date] ? '<button data-m="del" style="color:var(--accent)">この日の記録をすべて削除</button>' : ''}
    </div>
    <button class="btn block" id="m-close" style="margin-top:10px">閉じる</button>
  `, sh => {
    sh.querySelector('#m-close').onclick = closeSheet;
    sh.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
      const m = b.dataset.m;
      closeSheet();
      if (m === 'copy-today') { copyMenu(date, todayIso()); go({ name: 'day', date: todayIso() }, true); }
      if (m === 'ai') { state.ex.scope = 'day'; state.ex.date = date; setTab('export'); }
      if (m === 'del' && confirm(`${slashDate(date)} の記録をすべて削除しますか？`)) { delete db.sessions[date]; saveDb(); render(); }
    });
  });
}

/* ── 種目を選択 ───────────────────────────────────── */
function renderPicker() {
  const date = state.view.date;
  $('#title').textContent = '種目を選択';
  const { last } = exerciseUsage();
  // 部位ごとに最後に行った日
  const partLast = {};
  for (const [n, d] of Object.entries(last)) {
    const p = partOf(n);
    if (!partLast[p] || partLast[p] < d) partLast[p] = d;
  }
  const today = todayIso();
  let html = `<div class="picker-top"><button class="btn small outline" id="pk-new">部位・種目を追加</button></div>`;
  for (const p of PARTS) {
    const names = exercisesOfPart(p);
    if (!names.length && p !== 'その他') continue;
    const open = state.pickerOpen[p];
    const shown = open ? names : names.slice(0, 3);
    const ago = partLast[p] ? (partLast[p] === today ? '今日' : `${daysBetween(partLast[p], today)}日前`) : '';
    html += `
      <div class="pk-group">
        <div class="pk-head">${partLabel(p)}${ago ? ` - ${ago}` : ''}</div>
        ${shown.map(n => `<button class="pk-item" data-ex="${esc(n)}"><span>${esc(n)}</span>${last[n] ? `<small>${labelDateY(last[n])}</small>` : ''}</button>`).join('')}
        <div class="pk-foot">
          <button data-addpart="${p}">種目を追加</button>
          ${names.length > 3 ? `<button data-toggle="${p}">${open ? '閉じる' : 'すべて表示'}</button>` : ''}
        </div>
      </div>`;
  }
  $('#view').innerHTML = html;
  $('#pk-new').onclick = () => openNewExercise('', 'その他', date);
  $('#view').querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => { state.pickerOpen[b.dataset.toggle] = !state.pickerOpen[b.dataset.toggle]; render(); });
  $('#view').querySelectorAll('[data-addpart]').forEach(b => b.onclick = () => openNewExercise('', b.dataset.addpart, date));
  $('#view').querySelectorAll('[data-ex]').forEach(b => b.onclick = () => startExercise(date, b.dataset.ex));
}

// 種目を選んだら、その日に追加してセット入力画面へ（種目選択画面は履歴に残さない）
function startExercise(date, name) {
  const session = db.sessions[date] || (db.sessions[date] = { items: [] });
  let idx = session.items.findIndex(i => i.exercise === name);
  if (idx < 0) {
    const kind = kindOf(name);
    session.items.push({ exercise: name, kind, sets: [kind === 'cardio' ? { km: null, min: null, kcal: null, memo: '' } : { w: null, r: null, memo: '' }] });
    idx = session.items.length - 1;
    saveDb();
  }
  go({ name: 'exercise', date, idx }, true);
}

function openNewExercise(name, part, date) {
  openSheet(`
    <h3>種目を追加</h3>
    <label class="field"><span>種目名</span><input type="text" id="nx-name" value="${esc(name)}" placeholder="例: レッグプレス"></label>
    <label class="field"><span>部位</span><select id="nx-part">${PARTS.map(p => `<option value="${p}" ${p === part ? 'selected' : ''}>${partLabel(p)}</option>`).join('')}</select></label>
    <label class="field"><span>種類</span><select id="nx-kind"><option value="strength">筋トレ（重さ×回数）</option><option value="cardio" ${part === '有酸素' ? 'selected' : ''}>有酸素（距離・時間）</option></select></label>
    <div class="row"><button class="btn" id="nx-cancel">キャンセル</button><span class="spacer"></span><button class="btn primary" id="nx-ok">追加</button></div>
  `, sh => {
    sh.querySelector('#nx-part').onchange = e => { sh.querySelector('#nx-kind').value = e.target.value === '有酸素' ? 'cardio' : 'strength'; };
    sh.querySelector('#nx-cancel').onclick = closeSheet;
    sh.querySelector('#nx-ok').onclick = () => {
      const n = sh.querySelector('#nx-name').value.trim();
      if (!n) { toast('種目名を入れてください'); return; }
      if (db.exercises[n] && !db.exercises[n].hidden) { toast('同じ名前の種目があります'); return; }
      db.exercises[n] = { part: sh.querySelector('#nx-part').value, kind: sh.querySelector('#nx-kind').value };
      saveDb(); closeSheet();
      startExercise(date, n);
    };
  });
  setTimeout(() => $('#nx-name')?.focus(), 50);
}

/* ── 種目（セット入力） ────────────────────────────── */
let timer = { left: 0, id: null };
function stopTimer() { clearInterval(timer.id); timer.id = null; }

function renderExercise() {
  const { date, idx } = state.view;
  const session = db.sessions[date];
  const it = session?.items[idx];
  if (!it) { back(); return; }
  const cardio = it.kind === 'cardio';
  $('#title').textContent = it.exercise;
  const prev = previousRecord(it.exercise, date);
  const restSec = db.meta.rest ?? 120;

  let last = '<div class="last-rec empty">前回の記録はありません</div>';
  if (prev) {
    const lines = prev.sets.map((s, i) => cardio
      ? `<li><span>${i + 1}</span><span>${fmt(s.km, 2)} km</span><span>${fmt(s.min, 2)} min</span></li>`
      : `<li><span>${i + 1}</span><span>${s.w != null ? fmtFixed(s.w, 1) : '-'} kg ×</span><span>${s.r ?? '-'} reps</span></li>`).join('');
    last = `
      <div class="last-rec">
        <div class="lr-head">Last Record : ${slashDate(prev.date)} <button id="ex-hist">履歴</button><span class="spacer"></span><button id="ex-copy" aria-label="前回の記録をコピー">⧉ コピー</button></div>
        <ol>${lines}</ol>
      </div>`;
  }
  const rows = it.sets.map((s, i) => setRowHtml(s, i, cardio)).join('');
  $('#view').innerHTML = `
    <div class="ex-tools">
      <button class="trophy" id="ex-pr" aria-label="自己ベスト">🏆</button>
      <div class="timer">
        <span>⏱</span><input type="text" inputmode="numeric" id="t-sec" value="${timer.id ? timer.left : restSec}">
        <button id="t-start">${timer.id ? 'STOP' : 'START'}</button>
      </div>
    </div>
    ${last}
    <div class="set-list ${cardio ? 'cardio' : ''}">
      <div class="set-head">${cardio ? '<span>セット</span><span>距離</span><span>時間</span><span>kcal</span>' : '<span>セット</span><span>重さ</span><span>回数</span><span>RM</span><span>補助</span>'}</div>
      ${rows}
    </div>
    <button class="fab" id="ex-add" aria-label="セットを追加">＋</button>`;

  const list = $('#view').querySelector('.set-list');
  list.addEventListener('input', ev => onSetInput(ev, it, cardio));
  list.addEventListener('click', ev => onSetClick(ev, it, cardio, date));
  $('#ex-add').onclick = () => {
    const lastSet = it.sets[it.sets.length - 1];
    it.sets.push(lastSet ? { ...lastSet, memo: '', assist: false } : (cardio ? { km: null, min: null, kcal: null, memo: '' } : { w: null, r: null, memo: '' }));
    saveDb(); render();
    window.scrollTo(0, document.body.scrollHeight);
  };
  $('#ex-copy')?.addEventListener('click', () => {
    const filled = it.sets.filter(s => !isEmptySet(s, it.kind));
    if (filled.length && !confirm('入力済みのセットを、前回の記録で置き換えますか？')) return;
    it.sets = prev.sets.map(s => ({ ...s, memo: '' }));
    saveDb(); render(); toast('前回の記録をコピーしました');
  });
  $('#ex-hist')?.addEventListener('click', () => openExerciseHistory(it.exercise));
  $('#ex-pr').onclick = () => openPrSheet(it.exercise);
  $('#t-start').onclick = () => {
    if (timer.id) { stopTimer(); render(); return; }
    const sec = Math.max(1, Math.round(numOrNull($('#t-sec').value) || restSec));
    db.meta.rest = sec; saveDb();
    timer.left = sec;
    timer.id = setInterval(() => {
      timer.left--;
      const el = $('#t-sec');
      if (el) el.value = timer.left;
      if (timer.left <= 0) {
        stopTimer();
        navigator.vibrate?.([300, 100, 300]);
        toast('休憩終了！次のセットへ');
        if (state.view.name === 'exercise') render();
      }
    }, 1000);
    $('#t-start').textContent = 'STOP';
  };
}

function setRowHtml(s, i, cardio) {
  const copyBtn = (field) => `<button class="cp" data-cp="${field}" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上のセットと同じにする">↪</button>`;
  const inp = (field, val, mode, unit) => `
    <span class="inp">${copyBtn(field)}<input type="text" inputmode="${mode}" data-f="${field}" data-i="${i}" value="${val ?? ''}" placeholder="-"><button class="clr" data-clr="${field}" data-i="${i}" aria-label="消す">×</button><small>${unit}</small></span>`;
  const main = cardio
    ? `${inp('km', s.km, 'decimal', 'km')}${inp('min', s.min, 'decimal', '分')}${inp('kcal', s.kcal, 'decimal', 'kcal')}`
    : `${inp('w', s.w != null ? fmtFixed(s.w, 1) : null, 'decimal', 'kg')}${inp('r', s.r, 'numeric', '回')}
       <span class="rm" data-rm="${i}">${rm(s.w, s.r) != null ? fmt(rm(s.w, s.r), 2) + ' kg' : '-'}</span>
       <button class="assist ${s.assist ? 'on' : ''}" data-assist="${i}" aria-label="補助">✓</button>`;
  return `
    <div class="set-row" data-row="${i}">
      <div class="sr-main"><span class="no">${i + 1}</span>${main}</div>
      <div class="sr-memo">${copyBtn('memo')}<input type="text" data-f="memo" data-i="${i}" value="${esc(s.memo || '')}" placeholder="メモ"><button class="del" data-delset="${i}" aria-label="このセットを削除">🗑</button></div>
    </div>`;
}

function onSetInput(ev, it, cardio) {
  const el = ev.target;
  if (!el.dataset.f) return;
  const s = it.sets[Number(el.dataset.i)];
  const f = el.dataset.f;
  if (f === 'memo') s.memo = el.value;
  else {
    const v = numOrNull(el.value);
    s[f] = f === 'r' && v != null ? Math.round(v) : v;
  }
  if (!cardio) {
    const out = $(`[data-rm="${el.dataset.i}"]`);
    if (out) out.textContent = rm(s.w, s.r) != null ? fmt(rm(s.w, s.r), 2) + ' kg' : '-';
  }
  saveDb(false);
}

function onSetClick(ev, it, cardio, date) {
  const b = ev.target.closest('button');
  if (!b) return;
  const i = Number(b.dataset.i ?? b.dataset.assist ?? b.dataset.delset);
  const s = it.sets[i];
  if (b.dataset.cp) {
    const f = b.dataset.cp;
    s[f] = it.sets[i - 1]?.[f] ?? s[f];
  } else if (b.dataset.clr) {
    s[b.dataset.clr] = null;
  } else if (b.dataset.assist != null) {
    s.assist = !s.assist;
  } else if (b.dataset.delset != null) {
    if (!isEmptySet(s, it.kind) && !confirm(`セット${i + 1}を削除しますか？`)) return;
    it.sets.splice(i, 1);
    if (!it.sets.length) {
      db.sessions[date].items.splice(db.sessions[date].items.indexOf(it), 1);
      cleanupDay(date); back(); return;
    }
  } else return;
  saveDb(); render();
}

function openExerciseHistory(name) {
  const hist = exerciseHistory(name).reverse();
  openSheet(`
    <h3>${esc(name)} の履歴（${hist.length}日）</h3>
    <div class="hist-list">${hist.map(h => `
      <div class="hl-day"><b>${slashDate(h.date)}</b>
        <div>${h.raw.map(s => h.cardio ? `${fmt(s.km, 2)}km/${fmt(s.min, 1)}分` : `${s.w != null ? fmtFixed(s.w, 1) : '-'}×${s.r ?? '-'}`).join('　')}</div></div>`).join('')}
    </div>
    <button class="btn block" id="h-close" style="margin-top:10px">閉じる</button>
  `, sh => { sh.querySelector('#h-close').onclick = closeSheet; });
}

function openPrSheet(name) {
  openSheet(`<div id="pr-box"></div><button class="btn block" id="pr-close" style="margin-top:10px">閉じる</button>`, sh => {
    sh.querySelector('#pr-close').onclick = closeSheet;
    renderPr(name, kindOf(name) === 'cardio', sh.querySelector('#pr-box'));
  });
}

/* ── 履歴 ────────────────────────────────────────── */
function renderHistory() {
  $('#title').textContent = '履歴';
  const [y, m] = state.histMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const today = todayIso();
  let cells = WD.map(w => `<div class="dow">${w}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = isoDate(d);
    const out = d.getMonth() !== m - 1;
    if (i >= 35 && out) break;
    cells += `<button data-day="${iso}" class="${out ? 'out' : ''} ${db.sessions[iso] ? 'has' : ''} ${iso === today ? 'today' : ''}">${d.getDate()}</button>`;
  }
  const days = Object.keys(db.sessions).filter(d => d.startsWith(state.histMonth)).sort();
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
      <div class="stat"><b>${fmt(volume / 1000, 2)}t</b><span>総負荷</span></div>
    </div>
    <div class="card day-list">${list || '<div class="empty">この月の記録はありません</div>'}</div>`;
  const shift = n => { const d = new Date(y, m - 1 + n, 1); state.histMonth = isoDate(d).slice(0, 7); render(); };
  $('#m-prev').onclick = () => shift(-1);
  $('#m-next').onclick = () => shift(1);
  $('#view').querySelectorAll('[data-day]').forEach(el => el.onclick = () => go({ name: 'day', date: el.dataset.day }));
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
  if (names.length === 0) { $('#view').innerHTML = '<div class="empty">記録がまだありません。ホームからデータを取り込むか、記録を始めてください。</div>'; return; }
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
      <select id="a-ex">${PARTS.map(p => {
        const opts = names.filter(x => partOf(x.name) === p);
        return opts.length ? `<optgroup label="${partLabel(p)}">${opts.map(x => `<option ${x.name === a.exercise ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>` : '';
      }).join('')}</select>
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
      const detail = h?.raw && !h.cardio ? '　' + h.raw.map(s => `${fmt(s.w, 2)}×${s.r ?? '-'}`).join(' / ') : '';
      $('#a-tip').textContent = `${labelDate(p.x)} ${fmt(p.y, 1)}${unit}${detail}`;
    });
  }
  renderPr(a.exercise, cardio, $('#a-pr'));
  renderMonthly();
  renderPartBars();
}

function renderPr(name, cardio, el) {
  const hist = exerciseHistory(name);
  if (!hist.length) { el.innerHTML = `<h2>${esc(name)}</h2><div class="empty">まだ記録がありません</div>`; return; }
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
  if (!sets.length) { el.innerHTML = `<h2>${esc(name)}</h2><div class="empty">まだ記録がありません</div>`; return; }
  const top = (arr, f) => arr.reduce((b, x) => f(x) > f(b) ? x : b, arr[0]);
  const maxW = top(sets, s => s.w + s.r / 1000);
  const maxRm = top(sets, s => s.rm);
  const maxVolDay = top(hist, h => h.volume);
  const bands = [[1, 5], [6, 10], [11, 15], [16, 999]];
  const bandRows = bands.map(([lo, hi]) => {
    const c = sets.filter(s => s.r >= lo && s.r <= hi);
    if (!c.length) return '';
    const b = top(c, s => s.w + s.r / 1000);
    return `<tr><td>${hi === 999 ? `${lo}回以上` : `${lo}〜${hi}回`}</td><td><b>${fmt(b.w, 2)} kg × ${b.r}</b></td><td>${labelDateY(b.date)}</td></tr>`;
  }).join('');
  el.innerHTML = `<h2>🏆 自己ベスト（${esc(name)}）</h2>
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
  const keys = Object.keys(months).sort();
  if (keys.length) {
    const [y0, m0] = keys[0].split('-').map(Number);
    const end = todayIso().slice(0, 7);
    for (let d = new Date(y0, m0 - 1, 1); isoDate(d).slice(0, 7) <= end; d.setMonth(d.getMonth() + 1)) {
      months[isoDate(d).slice(0, 7)] ||= { days: 0, sets: 0, volume: 0, parts: {} };
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
    const parts = a.stackParts ? PARTS.map((n, i) => p.stack[i] ? `${partLabel(n)} ${fmt(p.stack[i], 1)}` : '').filter(Boolean).join('・') : '';
    $('#m-tip').textContent = `${p.x.replace('-', '年')}月 ${fmt(p.total, 1)}${unit}${parts ? '（' + parts + '）' : ''}`;
  });
  $('#m-legend').innerHTML = a.stackParts ? PARTS.map((p, i) => `<span><i style="background:${cssVar(PART_COLORS[i])}"></i>${partLabel(p)}</span>`).join('') : '';
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
    `<div class="hbar"><span>${partLabel(p)}</span><div class="bar" style="width:${cnt[p] / max * 100}%;background:${cssVar(PART_COLORS[PARTS.indexOf(p)])}"></div><span class="muted">${cnt[p]}（${Math.round(cnt[p] / total * 100)}%）</span></div>`
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
    onPick(data[Math.max(0, Math.min(n - 1, Math.floor((cx - pad.l) / slot)))]);
  };
  svg.addEventListener('click', pick);
  svg.addEventListener('touchmove', pick, { passive: true });
}

/* ── AI出力（JSON） ──────────────────────────────── */
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
function dayJson(d) {
  const s = db.sessions[d];
  const sm = daySummary(s);
  return {
    date: d,
    weekday: WD[parseIso(d).getDay()],
    summary: { exercises: sm.exercises, sets: sm.sets, reps: sm.reps, volume_kg: round(sm.volume, 1) },
    exercises: s.items.filter(it => it.sets.length).map(it => ({
      name: it.exercise,
      part: partLabel(partOf(it.exercise)),
      sets: it.sets.map(st => it.kind === 'cardio'
        ? clean({ distance_km: st.km, minutes: st.min, kcal: st.kcal, memo: st.memo || undefined })
        : clean({ weight_kg: st.w, reps: st.r, est_1rm_kg: round(rm(st.w, st.r), 1), assisted: st.assist || undefined, memo: st.memo || undefined })),
    })),
  };
}
function periodJson(from, to, label) {
  const days = Object.keys(db.sessions).filter(d => d >= from && d <= to).sort();
  const byEx = {}, byPart = {};
  let sets = 0, reps = 0, volume = 0;
  for (const d of days) {
    for (const it of db.sessions[d].items) {
      const e = byEx[it.exercise] || (byEx[it.exercise] = { name: it.exercise, part: partLabel(partOf(it.exercise)), days: 0, sets: 0, reps: 0, volume_kg: 0, best_weight_kg: null, best_est_1rm_kg: null });
      e.days++;
      const pl = partLabel(partOf(it.exercise));
      byPart[pl] = (byPart[pl] || 0) + it.sets.length;
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
  return Object.entries(monthlyStats(from)).filter(([m]) => m <= to.slice(0, 7)).sort().map(([m, o]) => ({
    month: m, training_days: o.days, sets: o.sets, volume_kg: round(o.volume, 0),
    sets_by_part: Object.fromEntries(Object.entries(o.parts).map(([p, v]) => [partLabel(p), v.sets])),
  }));
}
function buildExport() {
  const e = state.ex;
  const today = todayIso();
  const notes = {
    unit: 'kg', est_1rm: '推定1RM = 重量 × (1 + 回数/40)（筋トレMEMOと同じ式）', volume: '総負荷 = 重量 × 回数 の合計',
    recent_volume_kg: { last_7_days: round(volumeSince(addDays(today, -7)), 0), last_28_days: round(volumeSince(addDays(today, -28)), 0), all_time: round(volumeSince('0000-00-00'), 0) },
  };
  let body;
  if (e.scope === 'day') body = db.sessions[e.date] ? dayJson(e.date) : { date: e.date, exercises: [] };
  else if (e.scope === 'month') {
    const [y, m] = e.month.split('-').map(Number);
    body = periodJson(`${e.month}-01`, isoDate(new Date(y, m, 0)), `${y}年${m}月`);
  } else if (e.scope === 'range') body = periodJson(e.from, e.to, `${e.from}〜${e.to}`);
  else {
    const days = Object.keys(db.sessions).sort();
    body = { all_time: periodJson(days[0] || today, today, '全期間'), by_month: monthsJson('0000-00-00', today) };
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
      ${e.scope === 'month' ? `<label class="field"><span>月</span><input type="month" id="x-month" value="${e.month}"></label>` : ''}
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
      <div class="muted">${days.length} 日・${nSets} セット${days.length ? `（${days[0]} 〜 ${days[days.length - 1]}）` : ''}<br>
      保存先: この端末のみ（約 ${Math.round(bytes / 1024)} KB）<br>最後のバックアップ: ${last}</div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="s-backup" style="flex:1">バックアップ</button>
        <button class="btn" id="s-import" style="flex:1">取り込み</button>
      </div>
      <input type="file" id="s-file" accept=".json,.csv,application/json,text/csv" class="hidden">
      <p class="muted" style="margin:10px 0 0">データはこのiPhoneの中にだけ保存されます。機種変更やSafariのデータ削除に備えて、ときどき「バックアップ」でファイルに書き出してください（ファイルAppやiCloud Driveに保存できます）。</p>
    </div>
    <div class="card">
      <h2>種目の管理</h2>
      <div class="muted" style="margin-bottom:8px">名前の変更、部位の変更、同じ種目の統合、一覧からの非表示ができます。</div>
      <div id="s-ex"></div>
    </div>
    <div class="card">
      <h2>このアプリについて</h2>
      <div class="muted">筋トレログ v${APP_VERSION}<br>オフラインで動作します。記録はサーバーに送信されません。</div>
      <button class="btn danger block" id="s-wipe" style="margin-top:12px">すべての記録を削除</button>
    </div>`;
  const { count } = exerciseUsage();
  $('#s-ex').innerHTML = PARTS.map(p => {
    const names = Object.keys(db.exercises).filter(n => partOf(n) === p);
    if (!names.length) return '';
    return `<div class="pk-group"><div class="pk-head">${partLabel(p)}</div>${names.map(n =>
      `<button class="pk-item" data-ex="${esc(n)}"><span>${esc(n)}${db.exercises[n].hidden ? '（非表示）' : ''}</span><small>${count[n] || 0}セット</small></button>`).join('')}</div>`;
  }).join('');
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
    db = applyMaster(emptyDb()); saveDb(); render(); toast('削除しました');
  };
}

function openExerciseEditor(name) {
  const info = db.exercises[name] || { part: 'その他', kind: 'strength' };
  const others = Object.keys(db.exercises).filter(n => n !== name);
  openSheet(`
    <h3>${esc(name)}</h3>
    <label class="field"><span>名前</span><input type="text" id="e-name" value="${esc(name)}"></label>
    <label class="field"><span>部位</span><select id="e-part">${PARTS.map(p => `<option value="${p}" ${p === info.part ? 'selected' : ''}>${partLabel(p)}</option>`).join('')}</select></label>
    <label class="field"><span>別の種目に統合（記録をすべて移す）</span>
      <select id="e-merge"><option value="">統合しない</option>${others.map(n => `<option>${esc(n)}</option>`).join('')}</select></label>
    <label class="row" style="margin-bottom:12px"><input type="checkbox" id="e-hidden" ${info.hidden ? 'checked' : ''}> <span>種目選択の一覧に表示しない</span></label>
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
      db.exercises[target] = { ...(db.exercises[target] || info), part: merge ? (db.exercises[target]?.part || part) : part,
                               hidden: sh.querySelector('#e-hidden').checked || undefined };
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
  if (hasData) {
    const replaceAll = confirm(`${inDays.length}日分の記録があります（いまのデータと重なる日: ${overlap}日）。\n\nOK: いまのデータを全部置き換える\nキャンセル: 追加する（重なる日は取り込む側で上書き）`);
    if (replaceAll) db = emptyDb();
  }
  Object.assign(db.sessions, incoming.sessions);
  for (const [n, v] of Object.entries(incoming.exercises)) db.exercises[n] = db.exercises[n] || v;
  db.meta.master = 0;  // 取り込んだ種目の部位も筋トレMEMOに合わせ直す
  db = applyMaster(db);
  saveDb(); render();
  toast(`${inDays.length}日分を取り込みました`);
}

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
// 筋トレMEMOから書き出したCSV（日付,種目,セット,重量kg,回数,RMkg,メモ）を取り込む
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
saveDb();
render();
navigator.storage?.persist?.();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW登録失敗', e));
}
