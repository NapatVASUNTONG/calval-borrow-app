/* สมุดยืมอุปกรณ์ · Equipment Lending Log — app v4 */
(function(){
'use strict';
const VERSION = '4.1.0';
const NEED_BACKEND = 4.1;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const DAY = 86400000;
const LS = {
  get(k, d){ try { const v = localStorage.getItem('lend.' + k); return v == null ? d : JSON.parse(v); } catch (e){ return d; } },
  set(k, v){ try { localStorage.setItem('lend.' + k, JSON.stringify(v)); return true; } catch (e){ return false; } },
  del(k){ try { localStorage.removeItem('lend.' + k); } catch (e){} }
};

/* ---------- language (ข้อความเขียนเป็นภาษาไทย แปลด้วย i18n-en.js) ---------- */
const EN = window.EN || {};
let LANG = LS.get('lang', '') === 'en' ? 'en' : 'th';
function t(s, v){
  let out = LANG === 'en' && EN[s] != null ? EN[s] : s;
  if (out === s){ const bar = s.indexOf('|'); if (bar > 0) out = s.slice(0, bar); }   // 'ข้อความ|บริบท' → แสดงเฉพาะข้อความ
  if (v) out = out.replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? v[k] : m);
  return out;
}
const isEn = () => LANG === 'en';
const LOC = () => isEn() ? 'en-GB' : 'th-TH';
const nDays = n => isEn() ? n + (n == 1 ? ' day' : ' days') : n + ' วัน';
const nPcs = n => isEn() ? n + (n == 1 ? ' piece' : ' pieces') : n + ' ชิ้น';
function applyStatic(){
  document.documentElement.lang = LANG;
  document.title = t('สมุดยืมอุปกรณ์');
  $$('[data-t]').forEach(el => { if (el.dataset.th == null) el.dataset.th = el.dataset.t || el.textContent.trim(); el.textContent = t(el.dataset.th); });
  $$('[data-tp]').forEach(el => { el.placeholder = t(el.dataset.tp); });
  $$('[data-ta]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.ta)); });
  $$('[data-lang-toggle]').forEach(b => { b.textContent = isEn() ? 'ภาษาไทย' : 'English'; b.lang = isEn() ? 'th' : 'en'; });
  $$('[data-set-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.setLang === LANG)));
  $('#camStrip').dataset.empty = t('ยังไม่มีรูป กดปุ่มกลมเพื่อถ่าย');
}

/* ---------- dates (ไทย = พ.ศ. · English = en-GB) ---------- */
const startOfDay = ms => { const d = new Date(ms); d.setHours(0,0,0,0); return d.getTime(); };
const endOfDay = ms => { const d = new Date(ms); d.setHours(23,59,59,0); return d.getTime(); };
const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
const dayDiff = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);
const fmtDate = ms => new Date(ms).toLocaleDateString(LOC(), {day:'numeric', month:'short', year:'2-digit'});
const fmtDateLong = ms => new Date(ms).toLocaleDateString(LOC(), {weekday:'long', day:'numeric', month:'long', year:'numeric'});
const fmtTime = ms => new Date(ms).toLocaleTimeString(LOC(), {hour:'2-digit', minute:'2-digit'}) + (isEn() ? '' : ' น.');
const fmtWhen = ms => {
  const d = dayDiff(ms, Date.now());
  return (d === 0 ? t('วันนี้') : d === 1 ? t('เมื่อวาน') : fmtDate(ms)) + ' ' + fmtTime(ms);
};

/* ---------- state ---------- */
const S = {
  api: '', info: null, token: '', me: null, pending: false, pendingMsg: '',
  data: null, loading: false, again: false, lastSync: 0, error: '', offline: !navigator.onLine,
  tab: 'items', authMode: 'login', resetEmail: '',
  cat: 'all', own: 'all', onlyFree: false, qItems: '', qLoans: '', qHist: '', loanFilter: 'all',
  confirm: null, installEvt: null, gReady: '', seenNotif: LS.get('seenNotif', '')
};
const TH = LS.get('thumbs', {});          // imageId → รูปย่อของอุปกรณ์ (data URL)
const IMGS = new Map();                   // 'f:'/'t:' + fileId → รูปเต็ม / รูปย่อ (ในหน่วยความจำ)
const ICONS = ['💻','🖥️','📽️','📷','🎤','🎧','🔌','🔋','🔧','🪛','✂️','✏️','📐','📚','📦','🧪','🪑','🛰️','📡','🧭'];
const CFG0 = {photos: {minB: 0, minR: 1, max: 6}, org: {org: 'GISTDA', team: 'Cal/Val'}, scoreMin: 0, scoreMax: 100, gainCap: 0};

const D = () => S.data || {cats: [], items: [], loans: [], users: [], notifs: [], unread: 0, cfg: CFG0, policy: {th: '', en: '', at: 0}, myScore: null};
const cfg = () => (S.data && S.data.cfg) || CFG0;
const catByName = n => D().cats.find(c => c.name === n);
const catOf = it => it ? catByName(it.category) : null;
const catLabel = c => c ? c.name : t('ไม่มีหมวด');
const catIcon = c => (c && c.icon) || '📦';
const itemById = id => D().items.find(i => i.id === id);
const loanById = id => D().loans.find(l => l.id === id);
const isOpen = l => l.status === 'active' || l.status === 'review' || l.status === 'pending' || l.status === 'permanent';
const isPerm = l => l.kind === 'perm';
const hasDue = l => !isPerm(l) && !!l.dueAt;
const isOver = (l, now) => l.status === 'active' && hasDue(l) && (now || Date.now()) > l.dueAt;
const openLoans = () => D().loans.filter(isOpen);
const openFor = id => openLoans().filter(l => l.itemId === id);
const borrowedOf = it => openFor(it.id).reduce((s, l) => s + (l.qty || 1), 0);
const availableOf = it => Math.max(0, (it.qty || 1) - borrowedOf(it));
const loanItemName = l => { const it = itemById(l.itemId); return it ? it.name : (l.itemName || t('อุปกรณ์ที่ถูกลบ')); };
const sortedCats = () => D().cats.slice().sort((a, b) => (a.order || 999) - (b.order || 999) || a.name.localeCompare(b.name, 'th'));
const isAdmin = () => !!(S.data && S.data.isAdmin);
const isMine = l => !!l.mine;
const visibleLoans = () => D().loans.filter(l => !l.other);          // สมาชิกได้รับเฉพาะของตัวเอง (และของที่ตัวเองเป็นเจ้าของ) แบบเต็ม
const initial = n => (String(n || '?').trim().replace(/^[\u0E40-\u0E44]+/, '').charAt(0) || '?').toUpperCase();   // ข้ามสระหน้า เ แ โ ใ ไ
const methodLabel = m => !m || m === 'อีเมล' ? t('อีเมล') : m;
const thumbOf = it => (it && it.imageId && TH[it.imageId]) || '';
const backendOld = () => { const v = (S.data && S.data.version) || (S.info && S.info.version) || 0; return !!S.token && !!(S.data || S.info) && v < NEED_BACKEND; };
const policyText = () => { const p = D().policy || {}; return (isEn() ? (p.en || p.th) : (p.th || p.en)) || ''; };
const hasPolicy = () => { const p = D().policy || {}; return !!(p.th || p.en); };
const myScore = () => { const m = D().myScore; return m ? m.score : cfg().scoreMax; };
/* คะแนน → หน้า emoji 5 ระดับ ไล่สีจากเขียวเข้ม (ดีมาก) ไปแดง (ต่ำมาก) */
function scoreMood(s){
  const max = cfg().scoreMax || 100, min = cfg().scoreMin || 0, r = s / max;
  if (min && s < min) return {lv: 5, emoji: '😠', label: t('ต่ำกว่าเกณฑ์ ยืมไม่ได้ชั่วคราว')};
  if (r >= 0.9) return {lv: 1, emoji: '😄', label: t('ดีมาก')};
  if (r >= 0.75) return {lv: 2, emoji: '🙂', label: t('ดี')};
  if (r >= 0.6) return {lv: 3, emoji: '😐', label: t('พอใช้')};
  if (r >= 0.4) return {lv: 4, emoji: '🙁', label: t('ควรปรับปรุง')};
  return {lv: 5, emoji: '😠', label: t('ต่ำมาก')};
}
/** ป้ายคะแนนเล็ก เช่น 😄 92 */
function scorePill(s, title){
  const m = scoreMood(s);
  return '<span class="spill lvl-' + m.lv + '" title="' + esc(title || m.label) + '"><span aria-hidden="true">' + m.emoji + '</span> ' + s + '</span>';
}
const scoreBlocked = () => !isAdmin() && cfg().scoreMin > 0 && myScore() < cfg().scoreMin;
const coordRe = /(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/;
function useAtHtml(s){
  if (!s) return '';
  const m = coordRe.exec(s);
  return esc(s) + (m ? ' <a class="maplink" href="https://www.google.com/maps?q=' + m[1] + ',' + m[2] + '" target="_blank" rel="noopener">' + esc(t('แผนที่')) + ' ↗</a>' : '');
}

/* ประเภทครุภัณฑ์: สำนักงาน (เลขครุภัณฑ์) / ส่วนตัว (ชื่อเจ้าของ) */
function ownText(it){
  const o = cfg().org;
  return it.ownType === 'personal'
    ? t('ส่วนตัว ({team})', {team: o.team}) + (it.owner ? ' · ' + it.owner : '')
    : t('ครุภัณฑ์ {org}', {org: o.org}) + (it.assetNo ? ' · ' + it.assetNo : '');
}
function ownPill(it){ return '<span class="own ' + (it.ownType === 'personal' ? 'personal' : 'office') + '">' + (it.ownType === 'personal' ? '👤 ' : '🏢 ') + esc(ownText(it)) + '</span>'; }
const locHtml = it => it && it.location ? '<span class="loc">📍 ' + esc(it.location) + '</span>' : '';

function loanState(l, now){
  if (l.status === 'pending') return {k:'pending', cls:'warn', text:t('รออนุมัติยืมถาวร')};
  if (l.status === 'rejected') return {k:'rejected', cls:'off', text:t('ไม่อนุมัติยืมถาวร')};
  if (l.status === 'cancelled') return {k:'cancelled', cls:'off', text:t('ยกเลิกคำขอ')};
  if (l.status === 'returned' || l.status === 'problem'){
    const late = hasDue(l) && l.returnedAt ? dayDiff(l.dueAt, l.returnedAt) : 0;
    if (l.status === 'problem') return {k:'problem', cls:'warn', text:t('คืนแล้ว (มีปัญหา)') + (late > 0 ? ' · ' + t('ช้า {d} วัน', {d: late}) : '')};
    if (!hasDue(l)) return {k:'returned', cls:'ok', text:t('คืนแล้ว')};
    return late > 0 ? {k:'late', cls:'warn', text:t('คืนช้า {d} วัน', {d: late})} : {k:'returned', cls:'ok', text:t('คืนตรงเวลา')};
  }
  if (l.status === 'review') return {k:'review', cls:'info', text:t('อยู่ระหว่างตรวจสอบ')};
  if (l.status === 'permanent' || !hasDue(l)) return {k:'perm', cls:'ok', text:t('ใช้ได้จนกว่าจะแจ้งคืน')};
  if (now > l.dueAt){ const d = dayDiff(l.dueAt, now); return {k:'overdue', cls:'bad', text:t('เกินกำหนด {d} วัน', {d}), days: d}; }
  const left = dayDiff(now, l.dueAt);
  if (left <= 0) return {k:'today', cls:'warn', text:t('ต้องคืนวันนี้')};
  if (left === 1) return {k:'soon', cls:'warn', text:t('ต้องคืนพรุ่งนี้')};
  return {k:'ok', cls:'ok', text:t('เหลืออีก {d} วัน', {d: left})};
}

/* ---------- toast ---------- */
let toastT = null;
function toast(msg, kind){
  const el = $('#toast'); el.textContent = msg; el.className = 'toast' + (kind ? ' ' + kind : ''); el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3800);
}
function vibrate(ms){ try { navigator.vibrate && navigator.vibrate(ms); } catch (e){} }
function busy(btn, on, label){
  if (!btn) return;
  if (on){ btn.dataset.label = btn.dataset.label || btn.textContent; btn.disabled = true; btn.textContent = label || t('กำลังบันทึก…'); }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; btn.dataset.label = ''; }
}

/* ---------- API ---------- */
class ApiError extends Error { constructor(msg, code){ super(msg); this.code = code || 'ERR'; } }
/** ลิงก์ที่คัดลอกตอนล็อกอินหลายบัญชีจะมี /u/1/ ซึ่งใช้ไม่ได้ ตัดออกให้อัตโนมัติ */
function normApi(u){ return String(u || '').trim().replace(/\/macros\/u\/\d+\/s\//, '/macros/s/').replace(/[?#].*$/, ''); }
function validApi(u){ return /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(u || ''); }
async function call(body, apiOverride, timeoutMs){
  const api = apiOverride || S.api;
  if (!api) throw new ApiError(t('ยังไม่ได้ใส่ลิงก์เว็บแอป'), 'NOAPI');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 40000);
  try {
    const payload = Object.assign({token: S.token, lang: LANG}, body);
    if (S.token && !('haveThumbs' in payload) && body.action !== 'image') payload.haveThumbs = Object.keys(TH);
    const res = await fetch(api, {method: 'POST', body: JSON.stringify(payload), headers: {'Content-Type': 'text/plain;charset=utf-8'}, signal: ctrl.signal, redirect: 'follow'});
    const txt = await res.text();
    let j;
    try { j = JSON.parse(txt); }
    catch (e){ throw new ApiError(/<html/i.test(txt) ? t('ลิงก์นี้ไม่ใช่หลังบ้านของสมุดยืม หรือยังไม่ได้ตั้งสิทธิ์เป็น “ทุกคน”') : t('อ่านข้อมูลจากหลังบ้านไม่ได้'), 'BADJSON'); }
    if (!j.ok){
      if (/ไม่รู้จักคำสั่ง|Unknown command/i.test(j.error || '')) throw new ApiError(t('หลังบ้านยังเป็นเวอร์ชันเก่า ผู้ดูแลต้องอัปเดต Code.gs ก่อน (ดูคู่มือหัวข้อ “อัปเดตแอป”)'), 'OLDBACKEND');
      throw new ApiError(j.error || t('เกิดข้อผิดพลาด'), j.code);
    }
    return j;
  } catch (e){
    if (e instanceof ApiError) throw e;
    if (e && e.name === 'AbortError') throw new ApiError(t('หลังบ้านตอบช้าเกินไป ลองใหม่อีกครั้ง'), 'TIMEOUT');
    throw new ApiError(navigator.onLine ? t('เชื่อมต่อหลังบ้านไม่ได้ ตรวจว่าลิงก์ถูกต้องและตั้งสิทธิ์เว็บแอปเป็น “ทุกคน”') : t('ไม่มีอินเทอร์เน็ต'), 'NETWORK');
  } finally { clearTimeout(timer); }
}
function handleAuthError(e){
  if (e.code === 'AUTH' || e.code === 'SUSPENDED'){ logout(true); toast(e.message, 'bad'); return true; }
  if (e.code === 'PENDING'){ logout(true); S.pending = true; S.pendingMsg = e.message; render(); return true; }
  return false;
}
function saveThumbs(items){
  let changed = false;
  const used = new Set();
  items.forEach(it => {
    if (it.imageId) used.add(it.imageId);
    if (it.thumb){ TH[it.imageId] = it.thumb; changed = true; delete it.thumb; }
  });
  Object.keys(TH).forEach(k => { if (!used.has(k)){ delete TH[k]; changed = true; } });
  if (changed && !LS.set('thumbs', TH)) LS.del('thumbs');
}
function applyData(j){
  if (j.token){ S.token = j.token; LS.set('token', j.token); }
  if (j.me) S.me = j.me;
  const items = j.items || [];
  saveThumbs(items);
  const prevTop = S.data && S.data.notifs && S.data.notifs[0] ? S.data.notifs[0].id : S.seenNotif;
  S.data = {version: j.version || 2, roomName: j.roomName || '', isAdmin: !!j.isAdmin, sheetUrl: j.sheetUrl || '', settings: j.settings || null,
    cats: j.cats || [], items, loans: j.loans || [], users: j.users || [], notifs: j.notifs || [], unread: j.unread || 0,
    cfg: j.cfg || CFG0, policy: j.policy || {th: '', en: '', at: 0}, myScore: j.myScore || null};
  S.lastSync = Date.now(); S.error = '';
  LS.set('cache', {at: S.lastSync, api: S.api, me: S.me, data: S.data});
  // ภาษา: ถ้ายังไม่เคยเลือกในเครื่องนี้ ใช้ภาษาที่ตั้งไว้ในบัญชี
  if (!LS.get('lang', '') && S.me && S.me.lang && S.me.lang !== LANG){ LANG = S.me.lang === 'en' ? 'en' : 'th'; applyStatic(); }
  const top = S.data.notifs[0];
  if (top && !top.read && prevTop && top.id !== prevTop){ toast('🔔 ' + top.title, top.kind === 'bad' ? 'bad' : (top.kind === 'ok' ? 'ok' : '')); vibrate([60, 80, 60]); }
  if (top){ S.seenNotif = top.id; LS.set('seenNotif', top.id); }
}
async function loadInfo(){
  try { S.info = await call({action: 'info'}); LS.set('info', S.info); }
  catch (e){ S.info = S.info || LS.get('info', null); if (!S.info) S.error = e.message; }
}
async function refresh(silent){
  if (!S.api || !S.token) return;
  if (S.loading){ if (!silent) S.again = true; return; }
  S.loading = true; if (!silent) renderHeader();
  try { applyData(await call({action: 'all'})); }
  catch (e){ if (!handleAuthError(e)){ S.error = e.message; if (!silent) toast(e.message, 'bad'); } }
  finally {
    S.loading = false; render();
    if (S.again){ S.again = false; setTimeout(() => refresh(true), 30); }
  }
}
/** ส่งคำสั่งบันทึก เมื่อสำเร็จหลังบ้านจะส่งข้อมูลล่าสุดกลับมา */
async function write(body, btn, label, quiet){
  busy(btn, true, label);
  try {
    const heavy = (body.photos && body.photos.length) || (body.item && body.item.image);
    const j = await call(body, null, heavy ? 150000 : 40000);
    applyData(j); render();
    if (j.message && !quiet) toast(j.message, 'ok');
    return j;
  } catch (e){
    if (!handleAuthError(e)) toast(e.message, 'bad');
    return null;
  } finally { busy(btn, false); }
}

/* ---------- รูปจาก Google Drive (ส่งผ่านหลังบ้านแบบส่วนตัว) ---------- */
const imgQueue = [], PEND = new Map(); let imgActive = 0;
function loadImg(fileId, thumb){
  if (!fileId) return Promise.reject(new Error('no id'));
  const full = IMGS.get('f:' + fileId); if (full) return Promise.resolve(full);
  const key = (thumb ? 't:' : 'f:') + fileId;
  if (IMGS.has(key)) return Promise.resolve(IMGS.get(key));
  if (PEND.has(key)) return PEND.get(key);
  const p = new Promise((resolve, reject) => { imgQueue.push({fileId, thumb: !!thumb, key, resolve, reject}); pumpImgs(); });
  PEND.set(key, p);
  p.then(() => PEND.delete(key), () => PEND.delete(key));
  return p;
}
function pumpImgs(){
  while (imgActive < 3 && imgQueue.length){
    const job = imgQueue.shift();
    const hit = IMGS.get('f:' + job.fileId) || IMGS.get(job.key);
    if (hit){ job.resolve(hit); continue; }
    imgActive++;
    call({action: 'image', fileId: job.fileId, thumb: job.thumb}, null, 60000)
      .then(j => { IMGS.set(job.key, j.dataUrl); job.resolve(j.dataUrl); })
      .catch(job.reject)
      .finally(() => { imgActive--; pumpImgs(); });
  }
}
function srcAttr(id, thumb){
  const hit = IMGS.get('f:' + id) || (thumb && IMGS.get('t:' + id));
  return hit ? 'src="' + hit + '"' : 'data-file="' + esc(id) + '"' + (thumb ? ' data-thumb="1"' : '');
}
/** <img data-file="ID"> → โหลดรูปมาใส่ */
function hydrate(root){
  (root || document).querySelectorAll('img[data-file]').forEach(img => {
    const id = img.dataset.file; if (!id || img.dataset.loaded) return;
    img.dataset.loaded = '1';
    const tag = img.parentElement && img.parentElement.querySelector('.loading-tag');
    loadImg(id, img.dataset.thumb === '1').then(src => { img.src = src; if (tag) tag.remove(); })
      .catch(() => { if (tag) tag.textContent = t('โหลดรูปไม่สำเร็จ'); delete img.dataset.loaded; });
  });
}
function heroImg(fileId, thumb, caption){
  if (!fileId) return '';
  const have = IMGS.get('f:' + fileId);
  return '<button type="button" class="hero-img" data-photo="' + esc(fileId) + '" data-cap="' + esc(caption || '') + '" aria-label="' + esc(t('ดูรูปขนาดใหญ่')) + '">' +
    '<img alt="" ' + (have ? 'src="' + have + '"' : (thumb ? 'src="' + thumb + '" ' : '') + 'data-file="' + esc(fileId) + '"') + '>' +
    (have ? '' : '<span class="loading-tag">' + esc(t('กำลังโหลดรูป…')) + '</span>') + '</button>';
}
/** ตารางรูปจากหลังบ้าน (แตะเพื่อดูทีละรูป) */
function photoGrid(ids, cap, faceFirst){
  if (!ids || !ids.length) return '';
  const gal = ids.join(',');
  return '<div class="pgrid">' + ids.map((id, i) => '<button type="button" class="ptile' + (faceFirst && i === 0 ? ' face' : '') + '" data-gal="' + esc(gal) + '" data-gi="' + i + '" data-cap="' + esc(cap || '') + '" aria-label="' + esc(t('ดูรูปที่ {n}', {n: i + 1})) + '">' +
    '<img alt="" ' + srcAttr(id, true) + '><span class="n">' + (i + 1) + '</span>' + (faceFirst && i === 0 ? '<span class="face-tag">' + esc(t('หน้า')) + '</span>' : '') + '</button>').join('') + '</div>';
}
function iconHtml(it, c){
  const th = thumbOf(it);
  return th ? '<span class="cat-ic img"><img src="' + th + '" alt=""></span>' : '<span class="cat-ic">' + esc(catIcon(c || catOf(it))) + '</span>';
}
/* ดูรูปทีละรูป เลื่อนซ้าย-ขวาได้ */
const GAL = {ids: [], i: 0, cap: '', local: null};
function openGallery(ids, i, cap, local){
  GAL.ids = ids || []; GAL.i = clamp(i || 0, 0, Math.max(0, GAL.ids.length - 1)); GAL.cap = cap || ''; GAL.local = local || null;
  showGal(); openDlg($('#dlgPhoto'));
}
function showGal(){
  const n = GAL.ids.length, img = $('#phImg');
  $('#phCap').textContent = (n > 1 ? (GAL.i + 1) + '/' + n + ' · ' : '') + GAL.cap;
  $('#phPrev').hidden = GAL.i <= 0; $('#phNext').hidden = GAL.i >= n - 1;
  if (GAL.local){ img.src = GAL.local[GAL.i]; return; }
  const id = GAL.ids[GAL.i];
  const pre = IMGS.get('f:' + id) || IMGS.get('t:' + id);
  if (pre) img.src = pre; else img.removeAttribute('src');
  loadImg(id, false).then(src => { if (GAL.ids[GAL.i] === id) img.src = src; })
    .catch(() => { if (GAL.ids[GAL.i] === id) $('#phCap').textContent = t('โหลดรูปไม่สำเร็จ'); });
}
function galStep(d){ const n = GAL.ids.length; if (!n) return; GAL.i = clamp(GAL.i + d, 0, n - 1); showGal(); }

/* ---------- ย่อรูป + ประทับเวลา ---------- */
function drawToJpeg(src, sw, sh, max, q, stamp){
  const scale = Math.min(1, max / Math.max(sw, sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, w, h);
  if (stamp){
    const fs = Math.max(14, Math.round(Math.min(w, h) * 0.035));
    const lines = [stamp, new Date().toLocaleString(LOC(), {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}) + (isEn() ? '' : ' น.')];
    const band = fs * 1.35 * lines.length + fs * 0.8;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, h - band, w, band);
    g.fillStyle = '#fff'; g.font = '600 ' + fs + 'px "IBM Plex Sans Thai", Tahoma, sans-serif'; g.textBaseline = 'top';
    lines.forEach((s, i) => g.fillText(s, fs * 0.6, h - band + fs * 0.4 + i * fs * 1.35, w - fs * 1.2));
  }
  const full = c.toDataURL('image/jpeg', q);
  const ts = Math.min(1, 240 / Math.max(w, h));
  const tc = document.createElement('canvas'); tc.width = Math.round(w * ts); tc.height = Math.round(h * ts);
  tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
  return {full, thumb: tc.toDataURL('image/jpeg', 0.72)};
}
function processFile(file){
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error(t('ไฟล์นี้ไม่ใช่รูปภาพ')));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { try { resolve(drawToJpeg(img, img.naturalWidth, img.naturalHeight, 1280, 0.85)); } catch (e){ reject(e); } finally { URL.revokeObjectURL(url); } };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('เปิดรูปนี้ไม่ได้ ลองรูปอื่น'))); };
    img.src = url;
  });
}

/* ---------- กล้องในแอป (ถ่ายสดเท่านั้น เลือกจากคลังรูปไม่ได้) ---------- */
const CAM = {stream: null, facing: 'environment', resolve: null, opts: {}, shot: null, shots: [], multi: false};
const needFace = () => CAM.multi && !!CAM.opts.faceFirst && !CAM.shots.some(s => s.face);
/** ถ่าย 1 รูป (มีหน้าดูรูปก่อนใช้) */
function takePhoto(opts){
  return new Promise(resolve => {
    Object.assign(CAM, {resolve, opts: opts || {}, multi: false, shot: null, shots: []});
    CAM.facing = CAM.opts.facing || 'environment';
    camSetup(); openDlg($('#dlgCam')); startCam();
  });
}
/** ถ่ายหลายมุมต่อเนื่อง คืนรายการรูปทั้งหมด (ปิดกล้อง = null) */
function takePhotos(opts, existing){
  return new Promise(resolve => {
    Object.assign(CAM, {resolve, opts: opts || {}, multi: true, shot: null, shots: (existing || []).slice()});
    CAM.facing = needFace() ? 'user' : (CAM.opts.facing || 'environment');
    camSetup(); openDlg($('#dlgCam')); startCam();
  });
}
function camSetup(){
  $('#camTitle').textContent = CAM.opts.title || t('ถ่ายรูป');
  $('#camStrip').hidden = !CAM.multi;
  $('#btnCamDone').hidden = !CAM.multi;
  $('#camSpacer').hidden = CAM.multi;
  camLiveMode();
}
function camLiveMode(){
  $('#camVideo').hidden = false; $('#camShot').hidden = true;
  $('#camLive').hidden = false; $('#camReview').hidden = true;
  if (!CAM.multi){ $('#camHint').textContent = CAM.opts.hint || ''; $('#camGuide').hidden = CAM.opts.guide !== 'face'; $('#camCount').hidden = true; }
  else camMultiUi();
}
function camMultiUi(){
  const n = CAM.shots.length, min = CAM.opts.min || 0, max = CAM.opts.max || 6, face = needFace();
  $('#camGuide').hidden = !face;
  $('#camHint').textContent = n >= max ? t('ครบ {n} รูปแล้ว กด “เสร็จ”', {n: max}) : (face ? (CAM.opts.faceHint || '') : (CAM.opts.hint || ''));
  const cnt = $('#camCount'); cnt.hidden = false; cnt.textContent = n + '/' + max;
  $('#camStrip').innerHTML = CAM.shots.map((s, i) => '<div class="cam-thumb"><img src="' + s.thumb + '" alt=""><span class="n">' + (s.face ? esc(t('หน้า')) : (i + 1)) + '</span>' +
    '<button type="button" data-cam-del="' + i + '" aria-label="' + esc(t('ลบรูปที่ {n}', {n: i + 1})) + '">×</button></div>').join('');
  const done = $('#btnCamDone');
  const ok = n >= Math.max(1, min) && !face;
  done.disabled = !ok;
  done.textContent = face && n ? t('ยังขาดรูปหน้า') : (n < min ? t('อีก {n} รูป', {n: min - n}) : t('เสร็จ ({n})', {n}));
  updateShutter();
}
function updateShutter(){ $('#btnShutter').disabled = !CAM.stream || (CAM.multi && CAM.shots.length >= (CAM.opts.max || 6)); }
function camErr(msg){ const e = $('#camErr'); e.textContent = msg || ''; e.hidden = !msg; }
async function startCam(){
  stopCam(); camErr(''); updateShutter();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    camErr(location.protocol !== 'https:' && location.hostname !== 'localhost' ? t('ต้องเปิดแอปผ่าน https จึงจะใช้กล้องได้') : t('เบราว์เซอร์นี้เปิดกล้องไม่ได้ ลองใช้ Chrome (Android) หรือ Safari (iPhone)'));
    return;
  }
  try {
    const s = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: CAM.facing}, width: {ideal: 1280}, height: {ideal: 960}}, audio: false});
    if (!$('#dlgCam').open){ s.getTracks().forEach(tr => tr.stop()); return; }
    CAM.stream = s;
    const v = $('#camVideo');
    v.srcObject = s; v.classList.toggle('mirror', CAM.facing === 'user');
    try { await v.play(); } catch (e){}
    updateShutter();
  } catch (e){ camErr(camErrText(e)); }
}
function stopCam(){
  if (CAM.stream){ CAM.stream.getTracks().forEach(tr => tr.stop()); CAM.stream = null; }
  const v = $('#camVideo'); if (v) v.srcObject = null;
}
function snap(){
  const v = $('#camVideo');
  if (!v.videoWidth){ camErr(t('กล้องยังไม่พร้อม รอสักครู่แล้วกดอีกครั้ง')); return; }
  if (!CAM.multi){
    CAM.shot = drawToJpeg(v, v.videoWidth, v.videoHeight, 1280, 0.82, CAM.opts.stamp);
    const img = $('#camShot'); img.src = CAM.shot.full; img.hidden = false;
    v.hidden = true; $('#camGuide').hidden = true;
    $('#camLive').hidden = true; $('#camReview').hidden = false;
    vibrate(40); stopCam();
    return;
  }
  if (CAM.shots.length >= (CAM.opts.max || 6)) return;
  const face = needFace();
  const shot = drawToJpeg(v, v.videoWidth, v.videoHeight, 1280, 0.8, (face ? (CAM.opts.faceStamp || CAM.opts.stamp) : CAM.opts.stamp));
  shot.face = face;
  if (face) CAM.shots.unshift(shot); else CAM.shots.push(shot);
  vibrate(30);
  const f = $('#camFlash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  camMultiUi();
  const strip = $('#camStrip'); strip.scrollLeft = face ? 0 : strip.scrollWidth;
  if (face && CAM.facing === 'user'){ CAM.facing = CAM.opts.facing || 'environment'; startCam(); }
}
function camDelete(i){
  if (!CAM.multi || !CAM.shots[i]) return;
  CAM.shots.splice(i, 1);
  camMultiUi();
  if (needFace() && CAM.facing !== 'user'){ CAM.facing = 'user'; startCam(); }
}
function finishCam(result){
  stopCam(); if ($('#dlgCam').open) rawClose($('#dlgCam'));
  const r = CAM.resolve; CAM.resolve = null;
  if (r) r(result || null);
}
/** กล่องรูปในฟอร์ม (ยืม/คืน): รูปที่ถ่ายแล้ว + ปุ่มเปิดกล้อง */
function shotsBox(shots, key, min, max, faceFirst){
  const n = shots.length;
  const tiles = n ? '<div class="pgrid">' + shots.map((s, i) => '<div class="ptile' + (s.face ? ' face' : '') + '"><img src="' + s.thumb + '" alt="" data-local="' + key + '" data-li="' + i + '"><span class="n">' + (i + 1) + '</span>' +
    (s.face ? '<span class="face-tag">' + esc(t('หน้า')) + '</span>' : '') +
    '<button type="button" class="rm" data-rm-shot="' + key + '" data-ri="' + i + '" aria-label="' + esc(t('ลบรูปที่ {n}', {n: i + 1})) + '">×</button></div>').join('') + '</div>' : '';
  const needF = faceFirst && n && !shots.some(s => s.face);
  const ok = n >= min && !needF;
  const count = '<span class="photo-count ' + (ok ? 'ok' : 'need') + '">' + esc(
    needF ? t('ยังไม่มีรูปที่เห็นหน้าคุณคู่กับอุปกรณ์') :
    (min ? t('ถ่ายแล้ว {n} จากที่ต้องมีอย่างน้อย {m} รูป', {n, m: min}) : t('ถ่ายแล้ว {n} รูป', {n}))) + (ok && n ? ' ✓' : '') + '</span>';
  const btn = n >= max ? '' : '<button type="button" class="btn ' + (n ? '' : 'primary big') + '" data-shoot="' + key + '">' + esc(n ? t('📷 ถ่ายเพิ่ม') : t('📷 เปิดกล้องถ่ายรูป')) + '</button>';
  return tiles + count + '<div class="photo-actions">' + btn + '</div>';
}

/* ---------- session ---------- */
function setSession(j){
  S.token = j.token; LS.set('token', j.token);
  S.me = j.me || null; S.pending = false; S.data = null;
  ['lPw','regPw','f2Pw','f2Code'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  toast(j.message || t('เข้าสู่ระบบแล้ว'), 'ok');
  S.tab = 'items';
  // ภาษาที่เลือกในหน้าเข้าสู่ระบบ → บันทึกลงบัญชี (ใช้กับอีเมลแจ้งเตือน)
  const chosen = LS.get('lang', '');
  if (chosen && S.me && S.me.lang !== chosen){ call({action: 'setLang', value: chosen}).then(() => { if (S.me) S.me.lang = chosen; }).catch(() => {}); }
  else if (!chosen && S.me && S.me.lang && S.me.lang !== LANG){ LANG = S.me.lang === 'en' ? 'en' : 'th'; applyStatic(); }
  render(); refresh(false);
}
function logout(quiet){
  S.token = ''; S.me = null; S.data = null; S.confirm = null;
  LS.del('token'); LS.del('cache');
  try { window.google && google.accounts && google.accounts.id.disableAutoSelect(); } catch (e){}
  closeAll(); S.authMode = 'login'; render();
  if (!quiet) toast(t('ออกจากระบบแล้ว'));
}
async function setLang(lang, fromUser){
  lang = lang === 'en' ? 'en' : 'th';
  if (fromUser) LS.set('lang', lang);
  const changed = lang !== LANG;
  LANG = lang; applyStatic();
  if (changed){
    render();
    if ($('#dlgAccount').open) openAccount();
    if ($('#dlgPolicy').open) fillPolicy();
  }
  if (fromUser && S.token && S.api && !S.offline && S.me && S.me.lang !== lang){
    try { applyData(await call({action: 'setLang', value: lang})); render(); if ($('#dlgAccount').open) openAccount(); } catch (e){ handleAuthError(e); }
  }
}

/* ---------- header / nav ---------- */
function currentView(){
  if (!S.api) return 'setup';
  if (S.pending) return 'pending';
  if (!S.token) return 'auth';
  return S.tab;
}
const reviewCounts = () => {
  if (!isAdmin()) return {review: 0, pending: 0, all: 0};
  const r = D().loans.filter(l => l.status === 'review').length, p = D().loans.filter(l => l.status === 'pending').length;
  return {review: r, pending: p, all: r + p};
};
function renderHeader(){
  const rl = $('#roomLine'), view = currentView();
  const room = (S.data && S.data.roomName) || (S.info && S.info.roomName) || '';
  let dot = 'ok', txt;
  if (!S.api){ dot = 'wait'; txt = t('ยังไม่ได้เชื่อมต่อ'); }
  else if (!S.token){ dot = S.error ? 'off' : 'wait'; txt = room || t('ยังไม่ได้เข้าสู่ระบบ'); }
  else if (S.loading && !S.data){ dot = 'wait'; txt = t('กำลังโหลดข้อมูล…'); }
  else if (S.error || S.offline){ dot = 'off'; txt = (S.offline ? t('ออฟไลน์') : t('เชื่อมต่อไม่ได้')) + (S.lastSync ? ' · ' + t('ข้อมูลเมื่อ {t}', {t: fmtTime(S.lastSync)}) : ''); }
  else { txt = (room ? room + ' · ' : '') + t('อัปเดต {t}', {t: fmtTime(S.lastSync || Date.now())}); }
  rl.innerHTML = '<span class="sync-dot ' + dot + '"></span>' + esc(txt);
  $('#btnRefresh').classList.toggle('spin', S.loading);
  $('#btnRefresh').hidden = !S.token;
  const av = $('#btnAccount'); av.hidden = !(S.token && S.me);
  if (S.me){
    const mood = S.data && S.data.myScore ? scoreMood(S.data.myScore.score) : null;
    av.innerHTML = esc(initial(S.me.name)) + (mood ? '<span class="mood lvl-' + mood.lv + '" aria-hidden="true">' + mood.emoji + '</span>' : '');
    av.setAttribute('aria-label', t('บัญชีของฉัน') + (mood ? ' · ' + t('คะแนน') + ' ' + S.data.myScore.score + ' (' + mood.label + ')' : ''));
  }
  $('#btnBell').hidden = !(S.token && S.me);
  $('#bellDot').textContent = D().unread ? (D().unread > 9 ? '9+' : D().unread) : '';
  document.body.classList.toggle('no-nav', ['setup','auth','pending'].includes(view));
  const now = Date.now(), mineOpen = isAdmin() ? openLoans() : openLoans().filter(isMine);
  const over = mineOpen.filter(l => isOver(l, now)).length, rev = reviewCounts().all;
  const b = $('#badgeLoans');
  if (rev){ b.textContent = rev; b.className = 'dot bad'; }
  else { b.textContent = mineOpen.length ? mineOpen.length : ''; b.className = 'dot' + (over ? ' bad' : ''); }
  const pend = isAdmin() ? (D().users || []).filter(u => u.status === 'pending').length : 0;
  $('#badgeManage').textContent = pend ? pend : '';
  $$('.nb[data-tab]').forEach(n => { if (n.dataset.tab === S.tab) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); });
  const bn = $('#banner');
  let msg = '', cls = '';
  if (backendOld()){ msg = isAdmin() ? t('หลังบ้านยังเป็นเวอร์ชันเก่า กรุณาอัปเดต Code.gs และรัน setup ตามคู่มือหัวข้อ “อัปเดตแอป” ก่อนใช้งานฟีเจอร์ใหม่') : t('ระบบกำลังอัปเดต บางเมนูอาจยังใช้ไม่ได้ชั่วคราว'); cls = 'bad'; }
  else if (S.token && S.data && S.error){ msg = t('ซิงก์ข้อมูลไม่ได้: {e}', {e: S.error}); cls = 'bad'; }
  else if (S.offline && S.data){ msg = t('ไม่มีอินเทอร์เน็ต กำลังแสดงข้อมูลล่าสุดที่มี (ยืม-คืนไม่ได้จนกว่าจะออนไลน์)'); }
  else if (!S.token && S.api && S.error && !S.info){ msg = S.error; cls = 'bad'; }
  else if (S.token && S.data && scoreBlocked() && ['items','loans'].includes(view)){ msg = t('คะแนนของคุณ ({s}) ต่ำกว่าเกณฑ์ที่ยืมได้ ({m}) จึงยืมไม่ได้ชั่วคราว ติดต่อผู้ดูแล', {s: myScore(), m: cfg().scoreMin}); cls = 'bad'; }
  bn.textContent = msg; bn.className = 'banner ' + cls; bn.hidden = !msg;
}
function setTab(tb){
  if (!['items','loans','history','manage'].includes(tb)) tb = 'items';
  S.tab = tb; S.confirm = null; LS.set('tab', tb);
  render(); window.scrollTo({top: 0});
}
function render(){
  renderHeader();
  const current = currentView();
  ['setup','auth','pending','items','loans','history','manage'].forEach(v => { $('#view-' + v).hidden = v !== current; });
  if (current === 'setup') return;
  if (current === 'auth') return renderAuth();
  if (current === 'pending'){ $('#pendingMsg').textContent = S.pendingMsg || t('สมัครเรียบร้อยแล้ว เมื่อผู้ดูแลอนุมัติ ให้กลับมาเข้าสู่ระบบอีกครั้ง'); return; }
  if (current === 'items') renderItems();
  else if (current === 'loans') renderLoans();
  else if (current === 'history') renderHistory();
  else renderManage();
  if ($('#dlgNotifs').open) renderNotifs();
}
const notReady = el => {
  if (S.data) return false;
  el.innerHTML = S.error
    ? '<div class="empty"><h3>' + esc(t('เชื่อมต่อหลังบ้านไม่ได้')) + '</h3><p>' + esc(S.error) + '</p><button class="btn primary" type="button" data-refresh>' + esc(t('ลองใหม่')) + '</button><button class="btn" type="button" data-open-settings>' + esc(t('ตรวจลิงก์ในหน้าตั้งค่า')) + '</button></div>'
    : '<div class="loading">' + esc(t('กำลังโหลดข้อมูลจาก Google Sheets…')) + '</div>';
  return true;
};

/* ---------- auth screen ---------- */
function renderAuth(){
  const info = S.info || {};
  $('#authRoom').textContent = info.roomName || t('สมุดยืมอุปกรณ์');
  const mode = S.authMode;
  $('#authTabs').hidden = !(mode === 'login' || mode === 'register');
  $$('#authTabs [data-auth]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.auth === mode)));
  $('#fLogin').hidden = mode !== 'login';
  $('#fRegister').hidden = mode !== 'register';
  $('#fReset1').hidden = mode !== 'reset1';
  $('#fReset2').hidden = mode !== 'reset2';
  const reg = info.registration;
  const parts = [];
  if (reg === 'closed') parts.push(t('ตอนนี้ปิดรับสมัครสมาชิกใหม่ ติดต่อผู้ดูแลของห้อง'));
  else {
    if (reg === 'approve') parts.push(t('สมัครแล้วต้องรอผู้ดูแลอนุมัติก่อนจึงจะเข้าใช้ได้'));
    if (info.domain) parts.push(t('ใช้ได้เฉพาะอีเมล @{d}', {d: info.domain}));
  }
  $('#regNote').textContent = parts.join(' · '); $('#regNote').hidden = !parts.length;
  $('#f2Note').textContent = t('ส่งรหัสไปที่ {e} แล้ว (ดูในจดหมายขยะด้วย) รหัสใช้ได้ 15 นาที', {e: S.resetEmail || t('อีเมลของคุณ')});
  const showG = !!info.googleClientId && (mode === 'login' || mode === 'register');
  $('#gWrap').hidden = !showG;
  if (showG) renderGoogle(info.googleClientId);
}
function loadScript(src){
  return new Promise((res, rej) => {
    const old = document.querySelector('script[data-src="' + src + '"]');
    if (old){ if (old.dataset.loaded) return res(); old.addEventListener('load', () => res()); old.addEventListener('error', () => rej(new Error('load'))); return; }
    const s = document.createElement('script'); s.src = src; s.async = true; s.dataset.src = src;
    s.onload = () => { s.dataset.loaded = '1'; res(); }; s.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(s);
  });
}
async function renderGoogle(clientId){
  const box = $('#gBtn');
  try { await loadScript('https://accounts.google.com/gsi/client'); }
  catch (e){ box.innerHTML = ''; showErr($('#gErr'), t('โหลดปุ่ม Google ไม่สำเร็จ ใช้อีเมลแทนได้')); return; }
  if (!window.google || !google.accounts || !google.accounts.id) return;
  if (S.gReady !== clientId){
    google.accounts.id.initialize({client_id: clientId, callback: onGoogleCredential, auto_select: false, cancel_on_tap_outside: true, ux_mode: 'popup'});
    S.gReady = clientId;
  }
  box.innerHTML = '';
  const w = Math.min(380, Math.max(220, Math.floor(box.clientWidth || 320)));
  google.accounts.id.renderButton(box, {theme: 'outline', size: 'large', shape: 'pill', text: S.authMode === 'register' ? 'signup_with' : 'signin_with', logo_alignment: 'center', width: w, locale: LANG});
}
async function onGoogleCredential(resp){
  showErr($('#gErr'), '');
  try { afterLogin(await call({action: 'googleLogin', credential: resp && resp.credential})); }
  catch (e){
    if (e.code === 'PENDING'){ S.pending = true; S.pendingMsg = e.message; render(); return; }
    showErr($('#gErr'), e.message);
  }
}
function afterLogin(j){
  if (j.pending){ S.pending = true; S.pendingMsg = j.message; render(); return; }
  setSession(j);
}
async function submitLogin(e){
  e.preventDefault();
  const email = $('#lEmail').value.trim(), pw = $('#lPw').value;
  if (!email || !pw){ showErr($('#lErr'), t('กรุณาใส่อีเมลและรหัสผ่าน')); return; }
  showErr($('#lErr'), ''); busy($('#lSubmit'), true, t('กำลังเข้าสู่ระบบ…'));
  try { afterLogin(await call({action: 'login', email, password: pw})); }
  catch (e2){ if (e2.code === 'PENDING'){ S.pending = true; S.pendingMsg = e2.message; render(); } else showErr($('#lErr'), e2.message); }
  finally { busy($('#lSubmit'), false); }
}
async function submitRegister(e){
  e.preventDefault();
  const name = $('#regName').value.trim(), email = $('#regEmail').value.trim(), pw = $('#regPw').value;
  if (!name){ showErr($('#regErr'), t('กรุณาใส่ชื่อของคุณ')); $('#regName').focus(); return; }
  if (!email){ showErr($('#regErr'), t('กรุณาใส่อีเมล')); $('#regEmail').focus(); return; }
  if (pw.length < 6){ showErr($('#regErr'), t('รหัสผ่านต้องยาวอย่างน้อย 6 ตัว')); $('#regPw').focus(); return; }
  showErr($('#regErr'), ''); busy($('#regSubmit'), true, t('กำลังสมัคร…'));
  try { afterLogin(await call({action: 'register', name, group: $('#regGroup').value.trim(), email, password: pw})); }
  catch (e2){ showErr($('#regErr'), e2.message); }
  finally { busy($('#regSubmit'), false); }
}
async function submitReset1(e){
  e.preventDefault();
  const email = $('#f1Email').value.trim();
  if (!email){ showErr($('#f1Err'), t('กรุณาใส่อีเมล')); return; }
  showErr($('#f1Err'), ''); busy($('#f1Submit'), true, t('กำลังส่ง…'));
  try { await call({action: 'requestReset', email}); S.resetEmail = email; S.authMode = 'reset2'; render(); setTimeout(() => $('#f2Code').focus(), 60); }
  catch (e2){ showErr($('#f1Err'), e2.message); }
  finally { busy($('#f1Submit'), false); }
}
async function submitReset2(e){
  e.preventDefault();
  const code = $('#f2Code').value.trim(), pw = $('#f2Pw').value;
  if (!/^\d{6}$/.test(code)){ showErr($('#f2Err'), t('ใส่รหัส 6 หลักจากอีเมล')); return; }
  if (pw.length < 6){ showErr($('#f2Err'), t('รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัว')); return; }
  showErr($('#f2Err'), ''); busy($('#f2Submit'), true);
  try {
    const j = await call({action: 'resetPassword', email: S.resetEmail, code, password: pw});
    if (j.token) setSession(j);
    else { S.authMode = 'login'; $('#lEmail').value = S.resetEmail; if (j.pending){ S.pending = true; S.pendingMsg = t('ตั้งรหัสผ่านใหม่แล้ว บัญชียังรอผู้ดูแลอนุมัติ'); } render(); toast(j.message || t('ตั้งรหัสผ่านใหม่แล้ว'), 'ok'); }
  } catch (e2){ showErr($('#f2Err'), e2.message); }
  finally { busy($('#f2Submit'), false); }
}

/* ---------- items ---------- */
function renderItems(){
  const d = D(), now = Date.now();
  let total = 0, free = 0;
  d.items.forEach(it => { total += it.qty || 1; if (it.status === 'lendable') free += availableOf(it); });
  const open = openLoans(), borrowed = open.reduce((s, l) => s + (l.qty || 1), 0);
  const mine = open.filter(isMine), over = (isAdmin() ? open : mine).filter(l => isOver(l, now)).length;
  $('#stats').innerHTML = S.data ? '<span class="stat">' + esc(t('ทั้งหมด|stat')) + ' <b>' + total + '</b> ' + esc(t('ชิ้น')) + '</span><span class="stat">' + esc(t('ว่าง')) + ' <b>' + free + '</b></span><span class="stat">' + esc(t('ถูกยืม')) + ' <b>' + borrowed + '</b></span>' +
    (mine.length ? '<button type="button" class="stat" data-goto-mine>' + esc(t('ฉันยืมอยู่')) + ' <b>' + mine.length + '</b></button>' : '') +
    (over ? '<button type="button" class="stat is-bad" data-goto-overdue>' + esc(t('เกินกำหนด')) + ' <b>' + over + '</b></button>' : '') +
    (d.myScore ? (m => '<button type="button" class="stat lvl-' + m.lv + '" data-open-account aria-label="' + esc(t('คะแนนของฉัน') + ' ' + d.myScore.score + ' · ' + m.label) + '"><span aria-hidden="true">' + m.emoji + '</span> ' + esc(t('คะแนน')) + ' <b>' + d.myScore.score + '</b></button>')(scoreMood(d.myScore.score)) : '') : '';
  const rc = reviewCounts(), strip = $('#reviewStrip');
  strip.hidden = !rc.all;
  if (rc.all){
    const parts = [];
    if (rc.review) parts.push(t('📷 รอตรวจสอบการคืน {n} รายการ', {n: rc.review}));
    if (rc.pending) parts.push(t('📝 คำขอยืมถาวร {n} รายการ', {n: rc.pending}));
    strip.innerHTML = '<span>' + esc(parts.join(' · ')) + '</span><b>' + esc(t('ตรวจเลย ›')) + '</b>';
  }
  // ประเภทครุภัณฑ์
  const o = cfg().org, oc = {all: d.items.length, office: 0, personal: 0, mine: 0};
  d.items.forEach(it => { oc[it.ownType === 'personal' ? 'personal' : 'office']++; if (it.ownedByMe) oc.mine++; });
  if (S.own === 'mine' && !oc.mine) S.own = 'all';
  const ownChips = [['all', t('ทุกประเภท')], ['office', '🏢 ' + t('ครุภัณฑ์ {org}', {org: o.org})], ['personal', '👤 ' + t('ส่วนตัว ({team})', {team: o.team})]];
  if (oc.mine) ownChips.push(['mine', t('ของของฉัน')]);
  $('#ownChips').innerHTML = ownChips.map(([k, label]) => '<button type="button" class="chip" data-own="' + k + '" aria-pressed="' + (S.own === k) + '">' + esc(label) + ' <span class="n">' + oc[k] + '</span></button>').join('');
  $('#ownChips').hidden = !(oc.office && oc.personal) && !oc.mine;
  // หมวดหมู่
  const cats = sortedCats(), counts = {all: d.items.length};
  d.items.forEach(it => { const k = catOf(it) ? it.category : '_none'; counts[k] = (counts[k] || 0) + 1; });
  if (S.cat !== 'all' && S.cat !== '_none' && !catByName(S.cat)) S.cat = 'all';
  let chips = '<button type="button" class="chip" data-cat="all" aria-pressed="' + (S.cat === 'all') + '">' + esc(t('ทุกหมวด')) + ' <span class="n">' + counts.all + '</span></button>';
  cats.forEach(c => { if (counts[c.name]) chips += '<button type="button" class="chip" data-cat="' + esc(c.name) + '" aria-pressed="' + (S.cat === c.name) + '">' + esc(catIcon(c)) + ' ' + esc(c.name) + ' <span class="n">' + counts[c.name] + '</span></button>'; });
  if (counts._none) chips += '<button type="button" class="chip" data-cat="_none" aria-pressed="' + (S.cat === '_none') + '">' + esc(t('ไม่มีหมวด')) + ' <span class="n">' + counts._none + '</span></button>';
  $('#catChips').innerHTML = chips; $('#catChips').hidden = !d.items.length;

  const box = $('#itemList');
  if (notReady(box)) return;
  if (!d.items.length){
    box.innerHTML = isAdmin()
      ? '<div class="empty"><h3>' + esc(t('ยังไม่มีอุปกรณ์ในสมุด')) + '</h3><p>' + esc(t('เพิ่มอุปกรณ์ที่แท็บ “จัดการ” แล้วพิมพ์ป้าย QR ไปติดที่ของ จากนั้นทุกคนกด “สแกน” เพื่อยืม-คืนได้เลย')) + '</p><button class="btn primary" type="button" data-goto="manage">' + esc(t('ไปที่จัดการ')) + '</button></div>'
      : '<div class="empty"><h3>' + esc(t('ยังไม่มีอุปกรณ์ในสมุด')) + '</h3><p>' + esc(t('ผู้ดูแลยังไม่ได้เพิ่มอุปกรณ์ เมื่อเพิ่มแล้วจะขึ้นที่นี่')) + '</p></div>';
    return;
  }
  const q = S.qItems.trim().toLowerCase(), order = {};
  cats.forEach((c, i) => order[c.name] = i);
  const list = d.items.filter(it => {
    if (S.cat === '_none' && catOf(it)) return false;
    if (S.cat !== 'all' && S.cat !== '_none' && it.category !== S.cat) return false;
    if (S.own === 'office' && it.ownType === 'personal') return false;
    if (S.own === 'personal' && it.ownType !== 'personal') return false;
    if (S.own === 'mine' && !it.ownedByMe) return false;
    if (S.onlyFree && !(it.status === 'lendable' && availableOf(it) > 0)) return false;
    if (q && ![it.name, it.code, it.note, it.category, it.assetNo, it.owner, it.location].join(' ').toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (order[a.category] ?? 999) - (order[b.category] ?? 999) || a.name.localeCompare(b.name, 'th'));
  if (!list.length){ box.innerHTML = '<div class="empty"><h3>' + esc(t('ไม่พบอุปกรณ์')) + '</h3><p>' + esc(t('ลองเปลี่ยนคำค้นหา หรือเลือก “ทั้งหมด”')) + '</p></div>'; return; }
  box.innerHTML = list.map(it => itemCard(it, now)).join('');
}
function itemStatus(it){
  const qty = it.qty || 1, avail = availableOf(it), open = openFor(it.id);
  if (it.status === 'locked') return {pill: '<span class="pill off">' + esc(t('ห้ามยืมออก · ใช้ในห้องเท่านั้น')) + '</span>', ok: false, reason: t('อุปกรณ์นี้ใช้ได้ในห้องเท่านั้น')};
  if (it.status === 'repair') return {pill: '<span class="pill bad">' + esc(t('ชำรุด / ส่งซ่อม')) + '</span>', ok: false, reason: t('ยืมไม่ได้จนกว่าจะซ่อมเสร็จ')};
  if (avail > 0) return {pill: '<span class="pill ok">' + esc(t('ว่าง {a} จาก {q} ชิ้น', {a: avail, q: qty})) + '</span>', ok: true, reason: ''};
  const dated = open.filter(hasDue).sort((a, b) => a.dueAt - b.dueAt);
  return {pill: '<span class="pill warn">' + esc(t('ถูกยืมหมดแล้ว')) + '</span>', ok: false,
    reason: dated.length ? t('จะว่างเร็วสุด {d}', {d: fmtDate(dated[0].dueAt)}) : (open.some(l => l.status === 'permanent' || l.status === 'pending') ? t('ถูกยืมถาวรอยู่') : t('ไม่มีชิ้นที่ว่าง'))};
}
function loanShort(l, now){
  if (l.status === 'review') return '<span>' + esc(t('รอตรวจคืน')) + '</span>';
  if (l.status === 'pending') return '<span>' + esc(t('รออนุมัติยืมถาวร')) + '</span>';
  if (!hasDue(l)) return '<span>' + esc(t('ยืมถาวร')) + '</span>';
  if (now > l.dueAt) return '<span class="late">' + esc(t('เกินกำหนด')) + '</span>';
  return esc(t('คืน {d}', {d: fmtDate(l.dueAt)}));
}
const meTag = l => isMine(l) ? '<span class="tag">' + esc(t('ฉัน')) + '</span>' : (l.ownerView ? '<span class="tag">' + esc(t('ของของคุณ')) + '</span>' : '');
function whoList(it, now, max){
  const open = openFor(it.id).sort((a, b) => (a.dueAt || 9e15) - (b.dueAt || 9e15));
  if (!open.length) return '';
  const shown = open.filter(l => !l.other);
  const others = open.filter(l => l.other).reduce((s, l) => s + (l.qty || 1), 0);
  const row = l => '<li><b>' + esc(l.borrower) + '</b>' + meTag(l) + ((l.qty || 1) > 1 ? ' ×' + l.qty : '') + ' · ' + loanShort(l, now) + '</li>';
  return '<ul class="who">' + shown.slice(0, max).map(row).join('') +
    (shown.length > max ? '<li class="muted">' + esc(t('และอีก {n} รายการ', {n: shown.length - max})) + '</li>' : '') +
    (others ? '<li class="muted">' + esc(t('คนอื่นกำลังยืมอยู่ {n} ชิ้น', {n: others})) + '</li>' : '') + '</ul>';
}
function itemCard(it, now){
  const c = catOf(it), st = itemStatus(it), canGo = st.ok && !S.offline && !scoreBlocked();
  return '<article class="card"><div class="card-head">' + iconHtml(it, c) + '<div class="txt">' +
    '<button type="button" class="linkish" data-detail="' + esc(it.id) + '"><h3>' + esc(it.name) + '</h3></button>' +
    '<div class="meta">' + (it.code ? '<span class="code">' + esc(it.code) + '</span>' : '') + '<span>' + esc(catLabel(c)) + '</span>' +
      (it.status === 'lendable' ? '<span>' + esc(t('ยืมได้ {d}', {d: nDays(it.maxDays)})) + '</span>' : '') + '</div>' +
    '<div class="facts">' + ownPill(it) + locHtml(it) + '</div>' +
    st.pill + '</div></div>' + whoList(it, now, 2) +
    '<button type="button" class="btn primary big" data-borrow="' + esc(it.id) + '"' + (canGo ? '' : ' disabled') + '>' + esc(t('ยืม')) + '</button>' +
    (st.reason ? '<p class="reason">' + esc(st.reason) + '</p>' : '') + '</article>';
}

/* ---------- loans ---------- */
function returnButton(l){
  const dis = S.offline ? ' disabled' : '';
  if (isAdmin()){
    if (l.status === 'review') return '<button type="button" class="btn primary" data-review="' + esc(l.id) + '"' + dis + '>' + esc(t('📷 ตรวจสอบการคืน')) + '</button>';
    if (l.status === 'pending') return '<button type="button" class="btn primary" data-review="' + esc(l.id) + '"' + dis + '>' + esc(t('📝 พิจารณาคำขอ')) + '</button>';
    return '<button type="button" class="btn ok" data-review="' + esc(l.id) + '"' + dis + '>' + esc(t('รับคืน')) + '</button>';
  }
  if (!isMine(l)) return '';
  if (l.status === 'review') return '<button type="button" class="btn" disabled>' + esc(t('อยู่ระหว่างตรวจสอบ')) + '</button>';
  if (l.status === 'pending'){
    const key = 'cancel:' + l.id;
    if (S.confirm === key) return '<div class="row"><button type="button" class="btn small danger solid" data-do-del="' + esc(key) + '"' + dis + '>' + esc(t('ยกเลิกคำขอเลย')) + '</button><button type="button" class="btn small" data-cancel-del>' + esc(t('ไม่ยกเลิก')) + '</button></div>';
    return '<button type="button" class="btn" data-ask-del="' + esc(key) + '"' + dis + '>' + esc(t('ยกเลิกคำขอ')) + '</button>';
  }
  return '<button type="button" class="btn ok" data-return="' + esc(l.id) + '"' + dis + '>' + esc(t('📷 แจ้งคืน')) + '</button>';
}
function adminMsgHtml(l){
  if (!l.adminNote) return '';
  const open = l.status === 'active' || l.status === 'permanent';
  const redo = open && l.reviewedAt && (!l.approvedAt || l.reviewedAt >= l.approvedAt);
  let cls = '', head = t('ข้อความจากผู้ดูแล');
  if (redo){ cls = 'bad'; head = t('การคืนยังไม่ผ่าน · ข้อความจากผู้ดูแล'); }
  else if (l.status === 'rejected'){ cls = 'bad'; head = t('เหตุผลที่ไม่อนุมัติ'); }
  else if (l.status === 'returned' || l.status === 'permanent') cls = 'ok';
  return '<p class="admin-msg ' + cls + '"><b>' + esc(head) + ':</b> ' + esc(l.adminNote) + '</p>';
}
function stampHtml(l, s){
  if (l.status === 'pending') return '<div class="stamp warn perm"><span class="stamp-k">' + esc(t('คำขอยืมถาวร')) + '</span><span class="stamp-d">' + esc(t('รออนุมัติ')) + '</span></div>';
  if (!hasDue(l)) return '<div class="stamp perm"><span class="stamp-k">' + esc(t('ไม่มีกำหนดคืน')) + '</span><span class="stamp-d">' + esc(t('ยืมถาวร')) + '</span></div>';
  const cls = s.k === 'review' ? '' : s.cls;
  return '<div class="stamp ' + cls + '"><span class="stamp-k">' + esc(t('กำหนดคืน')) + '</span><span class="stamp-d">' + esc(fmtDate(l.dueAt)) + '</span></div>';
}
function photoBtns(l){
  const name = loanItemName(l) + ' · ' + l.borrower;
  const b = l.borrowPhotoIds || [], r = l.returnPhotoIds || [];
  return (b.length ? '<button type="button" class="ph-btn" data-gal="' + esc(b.join(',')) + '" data-gi="0" data-cap="' + esc(t('รูปตอนยืม') + ' · ' + name) + '">' + esc(t('📷 รูปตอนยืม ({n})', {n: b.length})) + '</button> ' : '') +
    (r.length ? '<button type="button" class="ph-btn" data-gal="' + esc(r.join(',')) + '" data-gi="0" data-cap="' + esc(t('รูปตอนคืน') + ' · ' + name) + '">' + esc(t('📷 รูปตอนคืน ({n})', {n: r.length})) + '</button>' : '');
}
function renderLoans(){
  const now = Date.now(), admin = isAdmin();
  const act = visibleLoans().filter(isOpen);
  const isSoon = l => l.status === 'active' && hasDue(l) && !isOver(l, now) && dayDiff(now, l.dueAt) <= 1;
  const n = {all: act.length, review: act.filter(l => l.status === 'review').length, pending: act.filter(l => l.status === 'pending').length,
    overdue: act.filter(l => isOver(l, now)).length, soon: act.filter(isSoon).length, perm: act.filter(l => l.status === 'permanent').length};
  const anyOwner = act.some(l => l.ownerView);
  const chips = [['all', admin || anyOwner ? t('ทั้งหมด') : t('ของที่ฉันยืม')], ['review', admin ? t('รอตรวจสอบ') : t('รอตรวจคืน')], ['pending', t('รออนุมัติยืมถาวร')], ['overdue', t('เกินกำหนด')], ['soon', t('ต้องคืนวันนี้–พรุ่งนี้')], ['perm', t('ยืมถาวร')]];
  if (!chips.some(c => c[0] === S.loanFilter)) S.loanFilter = 'all';
  $('#loanChips').innerHTML = chips.filter(([k]) => k === 'all' || n[k] || S.loanFilter === k).map(([k, label]) =>
    '<button type="button" class="chip" data-loanf="' + k + '" aria-pressed="' + (S.loanFilter === k) + '">' + esc(label) + ' <span class="n">' + n[k] + '</span></button>').join('');
  const box = $('#loanList');
  if (notReady(box)) return;
  if (!act.length){
    box.innerHTML = admin ? '<div class="empty"><h3>' + esc(t('ตอนนี้ไม่มีใครยืมของอยู่')) + '</h3><p>' + esc(t('อุปกรณ์อยู่ครบทุกชิ้น เมื่อมีคนยืม รายการจะขึ้นที่นี่พร้อมวันกำหนดคืน')) + '</p></div>'
      : '<div class="empty"><h3>' + esc(t('คุณไม่ได้ยืมอะไรอยู่')) + '</h3><p>' + esc(t('เมื่อยืมของ รายการของคุณจะขึ้นที่นี่ ตอนคืนให้กด “แจ้งคืน” แล้วถ่ายรูปคู่กับอุปกรณ์')) + '</p></div>';
    return;
  }
  const q = S.qLoans.trim().toLowerCase();
  const rank = l => l.status === 'review' ? 0 : l.status === 'pending' ? 1 : isOver(l, now) ? 2 : hasDue(l) ? 3 : 4;
  const list = act.filter(l => {
    const f = S.loanFilter;
    if (f === 'review' && l.status !== 'review') return false;
    if (f === 'pending' && l.status !== 'pending') return false;
    if (f === 'overdue' && !isOver(l, now)) return false;
    if (f === 'soon' && !isSoon(l)) return false;
    if (f === 'perm' && l.status !== 'permanent') return false;
    if (q && ![l.borrower, l.group, loanItemName(l), l.code, l.note, l.useAt, l.permReason].join(' ').toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => rank(a) - rank(b) || (a.dueAt || 0) - (b.dueAt || 0) || b.borrowedAt - a.borrowedAt);
  if (!list.length){ box.innerHTML = '<div class="empty"><h3>' + esc(t('ไม่พบรายการ')) + '</h3><p>' + esc(t('ลองเปลี่ยนคำค้นหา หรือกด “{a}”', {a: chips[0][1]})) + '</p></div>'; return; }
  box.innerHTML = list.map(l => {
    const s = loanState(l, now), it = itemById(l.itemId), c = it ? catOf(it) : null;
    const kv = [[t('ยืมเมื่อ'), fmtDate(l.borrowedAt) + ' · ' + fmtTime(l.borrowedAt)]];
    if (hasDue(l)) kv.push([t('จำนวนวันที่ยืม'), nDays(l.days)]);
    else kv.push([t('ประเภท'), l.status === 'pending' ? t('ขอยืมถาวร') : t('ยืมถาวร')]);
    if (l.status === 'review' && l.returnReqAt) kv.push([t('ส่งหลักฐานคืนเมื่อ'), fmtWhen(l.returnReqAt)]);
    return '<article class="slip' + (s.k === 'overdue' ? ' is-bad' : '') + '"><div class="slip-main">' +
      '<div class="slip-item">' + (thumbOf(it) ? '<span class="cat-ic img" style="width:40px;height:40px"><img src="' + thumbOf(it) + '" alt=""></span>' : '<span>' + esc(catIcon(c)) + '</span>') + '<span>' + esc(loanItemName(l)) + '</span>' + ((l.qty || 1) > 1 ? '<span class="qty">×' + esc(nPcs(l.qty)) + '</span>' : '') + '</div>' +
      (it ? '<div class="facts">' + ownPill(it) + locHtml(it) + '</div>' : '') +
      '<div class="slip-who"><span class="lbl">' + esc(t('คนยืม')) + '</span><b>' + esc(l.borrower) + '</b>' + meTag(l) + (l.group ? ' <span class="muted">· ' + esc(l.group) + '</span>' : '') + '</div>' +
      '<dl class="kv">' + kv.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>' +
      (l.useAt ? '<p class="note">' + esc(t('นำไปใช้ที่')) + ': ' + useAtHtml(l.useAt) + '</p>' : '') +
      (l.permReason ? '<p class="note">' + esc(t('เหตุผลที่ขอยืมถาวร')) + ': ' + esc(l.permReason) + '</p>' : '') +
      (l.note ? '<p class="note">' + esc(t('หมายเหตุ')) + ': ' + esc(l.note) + '</p>' : '') +
      adminMsgHtml(l) + '<div>' + photoBtns(l) + '</div></div>' +
      '<div class="slip-side">' + stampHtml(l, s) +
      '<p class="state ' + (s.cls === 'info' ? '' : s.cls) + '">' + esc(s.text) + '</p>' + returnButton(l) + '</div></article>';
  }).join('');
}

/* ---------- history ---------- */
function renderHistory(){
  const box = $('#histList'), admin = isAdmin();
  $('#histNote').textContent = admin ? t('ผู้ดูแลเห็นประวัติของทุกคน') : t('แสดงเฉพาะประวัติการยืมของคุณ (และของอุปกรณ์ที่คุณเป็นเจ้าของ)');
  if (notReady(box)) return;
  const now = Date.now(), q = S.qHist.trim().toLowerCase();
  const all = visibleLoans().slice().sort((a, b) => b.borrowedAt - a.borrowedAt);
  if (!all.length){ box.innerHTML = '<div class="empty"><h3>' + esc(t('ยังไม่มีประวัติการยืม')) + '</h3><p>' + esc(admin ? t('ทุกครั้งที่ยืมและคืน จะบันทึกลง Google Sheets และแสดงที่นี่') : t('เมื่อคุณยืมและคืนของ ประวัติจะแสดงที่นี่')) + '</p></div>'; return; }
  const list = all.filter(l => !q || [l.borrower, l.group, loanItemName(l), l.code, l.note, l.returnNote, l.adminNote, l.useAt, l.permReason].join(' ').toLowerCase().includes(q));
  if (!list.length){ box.innerHTML = '<div class="empty"><h3>' + esc(t('ไม่พบรายการ')) + '</h3><p>' + esc(t('ลองใช้คำค้นหาอื่น')) + '</p></div>'; return; }
  box.innerHTML = list.slice(0, 300).map(l => {
    const s0 = loanState(l, now);
    let s = s0;
    if (l.status === 'active') s = {cls: s0.k === 'overdue' ? 'bad' : 'off', text: s0.k === 'overdue' ? t('ยังไม่คืน') + ' · ' + s0.text : t('ยังไม่คืน')};
    else if (l.status === 'permanent') s = {cls: 'ok', text: t('ยืมถาวร')};
    const key = 'loan:' + l.id;
    const del = !admin || S.offline ? '' : (S.confirm === key
      ? '<div class="row"><span class="err grow">' + esc(t('ลบรายการนี้ใช่ไหม?')) + '</span><button type="button" class="btn small danger solid" data-do-del="' + esc(key) + '">' + esc(t('ลบเลย')) + '</button><button type="button" class="btn small" data-cancel-del>' + esc(t('ไม่ลบ')) + '</button></div>'
      : '<div class="row"><button type="button" class="btn small" data-ask-del="' + esc(key) + '">' + esc(t('ลบ (บันทึกผิด)')) + '</button></div>');
    const dates = [t('ยืม {d}', {d: fmtDate(l.borrowedAt) + ' ' + fmtTime(l.borrowedAt)})];
    if (hasDue(l)) dates.push(nDays(l.days), t('กำหนดคืน {d}', {d: fmtDate(l.dueAt)}));
    else dates.push(l.approvedAt ? t('ยืมถาวร (อนุมัติ {d})', {d: fmtDate(l.approvedAt)}) : t('ขอยืมถาวร'));
    if (l.returnedAt) dates.push(t('คืนเมื่อ {d}', {d: fmtDate(l.returnedAt) + ' ' + fmtTime(l.returnedAt)}));
    return '<div class="hrow"><div class="hrow-top"><div><b>' + esc(loanItemName(l) + ((l.qty || 1) > 1 ? ' ×' + l.qty : '')) + '</b>' + (isPerm(l) ? ' <span class="tag">' + esc(t('ถาวร')) + '</span>' : '') +
      '<div class="muted">' + esc(l.borrower) + (admin ? meTag(l) : (l.ownerView ? meTag(l) : '')) + (l.group ? ' · ' + esc(l.group) : '') + '</div></div>' +
      '<span class="pill ' + s.cls + '">' + esc(s.text) + '</span></div>' +
      '<div class="dates">' + esc(dates.join(' · ')) + '</div>' +
      (l.useAt ? '<p class="note">' + esc(t('นำไปใช้ที่')) + ': ' + useAtHtml(l.useAt) + '</p>' : '') +
      (l.permReason ? '<p class="note">' + esc(t('เหตุผลที่ขอยืมถาวร')) + ': ' + esc(l.permReason) + '</p>' : '') +
      (l.returnNote ? '<p class="note">' + esc(t('ผู้ยืมแจ้งสภาพ')) + ': ' + esc(l.returnNote) + '</p>' : '') +
      adminMsgHtml(l) + '<div>' + photoBtns(l) + '</div>' + del + '</div>';
  }).join('') + '<p class="help">' + esc(t('แสดงล่าสุด {n} รายการ', {n: Math.min(list.length, 300)})) + (admin ? ' · ' + esc(t('ประวัติทั้งหมดอยู่ในชีต “การยืม”')) : '') + '</p>';
  hydrate(box);
}

/* ---------- manage ---------- */
function renderManage(){
  const gate = $('#manageGate'), body = $('#manageBody');
  if (!S.data){ gate.hidden = true; body.hidden = false; ['#manageItems','#manageCats','#manageUsers'].forEach(s => { $(s).innerHTML = ''; }); notReady($('#manageItems')); return; }
  const admin = isAdmin();
  gate.hidden = admin; body.hidden = !admin;
  if (!admin) return;
  const lnk = $('#lnkSheet'); lnk.href = S.data.sheetUrl || '#'; lnk.hidden = !S.data.sheetUrl;
  $('#btnInstall').hidden = !S.installEvt;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('#installHint').textContent = standalone ? t('ติดตั้งเป็นแอปในเครื่องนี้แล้ว') :
    (/iphone|ipad|ipod/i.test(navigator.userAgent) ? t('iPhone/iPad: เปิดใน Safari → กดปุ่มแชร์ → “เพิ่มไปยังหน้าจอโฮม”') : (S.installEvt ? '' : t('Android: เปิดใน Chrome → เมนู ⋮ → “ติดตั้งแอป” หรือ “เพิ่มลงในหน้าจอหลัก”')));
  const cats = sortedCats(), order = {};
  cats.forEach((c, i) => order[c.name] = i);
  const items = D().items.slice().sort((a, b) => (order[a.category] ?? 999) - (order[b.category] ?? 999) || a.name.localeCompare(b.name, 'th'));
  const dis = S.offline ? ' disabled' : '';
  const confirmRow = (key, text) => '<div class="mrow confirm"><span class="ask">' + esc(text) + '</span><div class="mrow-act"><button type="button" class="btn small danger solid" data-do-del="' + esc(key) + '">' + esc(t('ลบเลย')) + '</button><button type="button" class="btn small" data-cancel-del>' + esc(t('ไม่ลบ')) + '</button></div></div>';
  $('#manageItems').innerHTML = !items.length ? '<div class="mrow"><div class="mrow-main"><b>' + esc(t('ยังไม่มีอุปกรณ์')) + '</b><span>' + esc(t('กด “+ เพิ่มอุปกรณ์” เพื่อเริ่ม')) + '</span></div></div>' : items.map(it => {
    const key = 'item:' + it.id, out = borrowedOf(it);
    if (S.confirm === key) return confirmRow(key, t('ลบ “{n}” ใช่ไหม? (รูปของอุปกรณ์จะถูกย้ายไปถังขยะใน Drive)', {n: it.name}));
    const pill = it.status === 'locked' ? '<span class="pill off">' + esc(t('ห้ามยืมออก')) + '</span>' : it.status === 'repair' ? '<span class="pill bad">' + esc(t('ส่งซ่อม')) + '</span>' : '<span class="pill ok">' + esc(t('ให้ยืมได้')) + '</span>';
    const line = [it.code, catLabel(catOf(it)), t('มี {n}', {n: nPcs(it.qty)}) + (out ? ' ' + t('(ถูกยืม {n})', {n: out}) : ''), t('ยืมได้ {d}', {d: nDays(it.maxDays)})].filter(Boolean).join(' · ');
    return '<div class="mrow">' + iconHtml(it) + '<div class="mrow-main"><b>' + esc(it.name) + '</b><span>' + esc(line) + '</span><div class="facts">' + ownPill(it) + locHtml(it) + '</div></div>' + pill +
      '<div class="mrow-act"><button type="button" class="btn small" data-edit-item="' + esc(it.id) + '"' + dis + '>' + esc(t('แก้ไข')) + '</button><button type="button" class="btn small danger" data-ask-del="' + esc(key) + '"' + dis + '>' + esc(t('ลบ')) + '</button></div></div>';
  }).join('');
  const defPrefix = (S.data.settings && S.data.settings.codePrefix) || 'EQ';
  $('#manageCats').innerHTML = !cats.length ? '<div class="mrow"><div class="mrow-main"><b>' + esc(t('ยังไม่มีหมวดหมู่')) + '</b></div></div>' : cats.map(c => {
    const key = 'cat:' + c.id, n = D().items.filter(i => i.category === c.name).length;
    if (S.confirm === key) return confirmRow(key, t('ลบหมวด “{n}” ใช่ไหม?', {n: c.name}));
    return '<div class="mrow"><span class="cat-ic">' + esc(catIcon(c)) + '</span><div class="mrow-main"><b>' + esc(c.name) + '</b><span>' + esc(t('{n} รายการ', {n})) + ' · ' + esc(t('รหัสขึ้นต้น')) + ' <span class="code">' + esc((c.prefix || defPrefix) + '-') + '</span></span></div>' +
      '<div class="mrow-act"><button type="button" class="btn small" data-edit-cat="' + esc(c.id) + '"' + dis + '>' + esc(t('แก้ไข')) + '</button><button type="button" class="btn small danger" data-ask-del="' + esc(key) + '"' + dis + '>' + esc(t('ลบ')) + '</button></div></div>';
  }).join('');
  renderUsers(dis);
  $$('#manageBody [data-add-item],#manageBody [data-add-cat],#btnPolicyEdit').forEach(b => { b.disabled = S.offline; });
}
function renderUsers(dis){
  const users = (D().users || []).slice();
  const rank = u => (u.status === 'pending' ? 0 : u.status === 'active' ? (u.role === 'admin' ? 1 : 2) : 3);
  users.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'th'));
  const pend = users.filter(u => u.status === 'pending').length;
  $('#pendTag').textContent = pend ? t('รออนุมัติ {n}', {n: pend}) : ''; $('#pendTag').hidden = !pend;
  $('#boxUsers').style.order = pend ? '-1' : '';
  const st = S.data.settings || {};
  const mode = {open: t('เปิด|reg'), approve: t('ต้องอนุมัติ'), closed: t('ปิด|reg')}[st.registration] || '-';
  $('#regMode').textContent = t('การสมัคร: {m}', {m: mode}) + (st.domain ? ' · @' + st.domain : '') + ' ' + t('(แก้ได้ในชีต “ตั้งค่า”)');
  $('#manageUsers').innerHTML = !users.length ? '<div class="mrow"><div class="mrow-main"><b>' + esc(t('ยังไม่มีสมาชิก')) + '</b></div></div>' : users.map(u => {
    const me = S.me && u.id === S.me.id;
    const rolePill = u.role === 'admin' ? '<span class="pill ok">' + esc(t('ผู้ดูแล')) + '</span>' : '';
    const statPill = u.status === 'pending' ? '<span class="pill warn">' + esc(t('รออนุมัติ')) + '</span>' : u.status === 'suspended' ? '<span class="pill bad">' + esc(t('ระงับ|state')) + '</span>' : '';
    const cap = (st.score && st.score.cap) || 0;
    const sc = typeof u.score === 'number' ? scorePill(u.score, scoreMood(u.score).label + (cap ? ' · ' + t('เดือนนี้ได้คะแนนเพิ่ม {g}/{c} ครั้ง', {g: u.monthGains || 0, c: cap}) : '')) : '';
    let acts = '';
    if (u.status === 'pending') acts = '<button type="button" class="btn small primary" data-uset="' + esc(u.id) + '" data-status="active"' + dis + '>' + esc(t('อนุมัติ')) + '</button><button type="button" class="btn small danger" data-uset="' + esc(u.id) + '" data-status="suspended"' + dis + '>' + esc(t('ไม่อนุมัติ')) + '</button>';
    else if (u.status === 'suspended') acts = '<button type="button" class="btn small" data-uset="' + esc(u.id) + '" data-status="active"' + dis + '>' + esc(t('เปิดใช้งาน')) + '</button>';
    else {
      acts = '<button type="button" class="btn small" data-score-user="' + esc(u.id) + '"' + dis + '>' + esc(t('ปรับคะแนน')) + '</button>';
      if (!me) acts += '<button type="button" class="btn small" data-uset="' + esc(u.id) + '" data-role="' + (u.role === 'admin' ? 'member' : 'admin') + '"' + dis + '>' + esc(u.role === 'admin' ? t('เป็นสมาชิก') : t('ตั้งเป็นผู้ดูแล')) + '</button>' +
        '<button type="button" class="btn small" data-ureset="' + esc(u.id) + '"' + dis + '>' + esc(t('รีเซ็ตรหัสผ่าน')) + '</button>' +
        '<button type="button" class="btn small danger" data-uset="' + esc(u.id) + '" data-status="suspended"' + dis + '>' + esc(t('ระงับ')) + '</button>';
    }
    return '<div class="mrow"><span class="avatar" style="cursor:default;width:38px;height:38px;font-size:16px">' + esc(initial(u.name)) + '</span><div class="mrow-main"><b>' + esc(u.name) + (me ? '<span class="tag">' + esc(t('คุณ')) + '</span>' : '') + '</b><span>' + esc(u.email) + (u.group ? ' · ' + esc(u.group) : '') + ' · ' + esc(methodLabel(u.method)) + '</span></div>' +
      sc + rolePill + statPill + (acts ? '<div class="mrow-act">' + acts + '</div>' : '') + '</div>';
  }).join('');
}

/* ---------- notifications ---------- */
function renderNotifs(){
  const list = D().notifs || [];
  const icon = k => k === 'ok' ? '✅' : k === 'bad' ? '↩️' : k === 'warn' ? '⚠️' : '🔔';
  $('#nList').innerHTML = !list.length ? '<div class="empty"><h3>' + esc(t('ยังไม่มีการแจ้งเตือน')) + '</h3><p>' + esc(t('เมื่อผู้ดูแลตรวจการคืนหรืออนุมัติคำขอของคุณ ผลจะแจ้งที่นี่และทางอีเมล')) + '</p></div>'
    : list.map(n => '<div class="nitem' + (n.read ? '' : ' unread') + '"><span class="ic">' + icon(n.kind) + '</span><div><b>' + esc(n.title) + '</b><p>' + esc(n.msg) + '</p><time>' + (n.time ? esc(fmtWhen(n.time)) : '') + '</time></div></div>').join('');
}
async function openNotifs(){
  renderNotifs(); openDlg($('#dlgNotifs'));
  if (D().unread && !S.offline){
    try { applyData(await call({action: 'readNotifs'})); renderHeader(); } catch (e){ handleAuthError(e); }
  }
}

/* ---------- dialogs ---------- */
function openDlg(d){ if (d.open) return; try { d.showModal(); } catch (e){ d.setAttribute('open', ''); } }
function rawClose(d){ try { d.close(); } catch (e){ d.removeAttribute('open'); } }
function closeDlg(d){ if (!d) return; if (d.id === 'dlgCam'){ finishCam(null); return; } rawClose(d); }
function closeAll(){ $$('dialog[open]').forEach(d => { if (d.id === 'dlgScan') closeScanner(); else closeDlg(d); }); }
function showErr(el, msg){ el.textContent = msg || ''; el.hidden = !msg; }

/* detail */
let DET = null;
function openDetail(id){
  const it = itemById(id); if (!it) return toast(t('ไม่พบอุปกรณ์นี้'), 'bad');
  DET = id; fillDetail(); openDlg($('#dlgDetail'));
}
function fillDetail(){
  const it = itemById(DET); if (!it){ closeDlg($('#dlgDetail')); return; }
  const c = catOf(it), st = itemStatus(it), now = Date.now();
  const open = openFor(it.id).sort((a, b) => (a.dueAt || 9e15) - (b.dueAt || 9e15));
  const shown = open.filter(l => !l.other), others = open.filter(l => l.other);
  const label = isAdmin() ? t('กำลังถูกยืม') : (shown.some(l => l.ownerView) ? t('คนที่กำลังยืม') : t('ที่คุณยืมอยู่'));
  $('#dBody').innerHTML = heroImg(it.imageId, thumbOf(it), it.name + (it.code ? ' · ' + it.code : '')) +
    '<div class="detail-head">' + (it.imageId ? '' : '<span class="cat-ic">' + esc(catIcon(c)) + '</span>') + '<div><h3>' + esc(it.name) + '</h3><div class="muted">' +
      (it.code ? '<span class="code">' + esc(it.code) + '</span> ' : '') + esc(catLabel(c)) + '</div></div></div>' +
    '<div class="facts">' + ownPill(it) + locHtml(it) + '</div>' + st.pill +
    (it.status === 'lendable' ? '<p class="muted">' + esc(t('ยืมได้นานสุด {d} · มีทั้งหมด {q}', {d: nDays(it.maxDays), q: nPcs(it.qty)})) + (it.allowPerm ? ' · ' + esc(t('ขอยืมถาวรได้')) : '') + '</p>' : '') +
    (it.note ? '<p class="note">' + esc(it.note) + '</p>' : '') +
    (shown.length ? '<div class="field"><span class="lbl">' + esc(label) + '</span>' + shown.map(l => {
      const s = loanState(l, now);
      return '<div class="loanrow"><div class="t"><b>' + esc(l.borrower) + (isAdmin() || l.ownerView ? meTag(l) : '') + ((l.qty || 1) > 1 ? ' ×' + l.qty : '') + '</b><span class="' + (s.k === 'overdue' ? 'late' : '') + '">' +
        esc(hasDue(l) ? t('คืน {d}', {d: fmtDate(l.dueAt)}) + ' · ' + s.text : s.text) + '</span></div>' +
        returnButton(l).replace(/class="btn /g, 'class="btn small ') + '</div>';
    }).join('') + '</div>' : '') +
    (others.length ? '<p class="muted">' + esc(t('คนอื่นกำลังยืมอยู่ {n} ชิ้น', {n: others.reduce((s, l) => s + (l.qty || 1), 0)})) + '</p>' : '');
  hydrate($('#dBody'));
  const canGo = st.ok && !S.offline && !scoreBlocked();
  $('#dFoot').innerHTML = (isAdmin() ? '<button type="button" class="btn" data-edit-item="' + esc(it.id) + '"' + (S.offline ? ' disabled' : '') + '>' + esc(t('แก้ไข')) + '</button>' : '') +
    '<button type="button" class="btn primary" data-borrow="' + esc(it.id) + '"' + (canGo ? '' : ' disabled') + '>' + esc(st.ok ? (scoreBlocked() ? t('คะแนนไม่พอ ยืมไม่ได้') : t('ยืมชิ้นนี้')) : (st.reason || t('ยืมไม่ได้'))) + '</button>';
}

/* borrow */
let B = null;
const bKind = () => ((document.querySelector('input[name=bKind]:checked') || {}).value === 'perm' ? 'perm' : 'temp');
function openBorrow(id){
  const it = itemById(id); if (!it) return;
  const avail = availableOf(it), max = it.maxDays || 7;
  if (it.status !== 'lendable' || avail < 1) return toast(t('ตอนนี้ยืมชิ้นนี้ไม่ได้'), 'bad');
  if (scoreBlocked()) return toast(t('คะแนนของคุณ ({s}) ต่ำกว่าเกณฑ์ที่ยืมได้ ({m}) จึงยืมไม่ได้ชั่วคราว ติดต่อผู้ดูแล', {s: myScore(), m: cfg().scoreMin}), 'bad');
  B = {id, shots: []};
  const ic = $('#bIcon'), th = thumbOf(it);
  ic.className = 'cat-ic' + (th ? ' img' : '');
  ic.innerHTML = th ? '<img src="' + th + '" alt="">' : esc(catIcon(catOf(it)));
  ic.style.cursor = it.imageId ? 'zoom-in' : '';
  ic.dataset.photo = it.imageId || ''; ic.dataset.cap = it.name;
  $('#bItem').textContent = it.name;
  $('#bAvail').textContent = (it.code ? it.code + ' · ' : '') + t('ว่าง {a} จาก {q} ชิ้น', {a: avail, q: it.qty});
  $('#bFacts').innerHTML = ownPill(it) + locHtml(it);
  $$('input[name=bKind]').forEach(r => { r.checked = r.value === 'temp'; });
  $('#bKindPerm').disabled = !it.allowPerm;
  $('#bPermNote').textContent = !it.allowPerm ? t('อุปกรณ์นี้ยืมถาวรไม่ได้') : (isAdmin() ? t('ผู้ดูแลบันทึกได้ทันที') : t('ต้องรอผู้ดูแลอนุมัติ'));
  $('#bQtyField').hidden = avail <= 1;
  const q = $('#bQty'); q.value = 1; q.max = avail;
  const dd = $('#bDays'); dd.max = max; dd.value = Math.min(7, max);
  $('#bMaxNote').textContent = t('วัน (นานสุด {n})', {n: max});
  const quick = [1, 3, 7, 14, 30].filter(x => x <= max); if (!quick.includes(max)) quick.push(max);
  $('#bQuick').innerHTML = quick.map(x => '<button type="button" class="chip" data-days="' + x + '">' + esc(nDays(x)) + '</button>').join('');
  $('#bMe').textContent = S.me ? S.me.name + (S.me.group ? ' · ' + S.me.group : '') : '';
  $('#bForOther').checked = false; $('#bOther').hidden = true;
  ['bName','bGroup','bNote','bReason','bUseAt'].forEach(k => { $('#' + k).value = ''; });
  $('#bMapLink').hidden = true;
  $('#bPolicyField').hidden = !hasPolicy(); $('#bAccept').checked = false;
  fillDatalists(); showErr($('#bErr'), '');
  updateBorrowKind(); renderBorrowPhotos(); updateBorrowPreview(false);
  closeDlg($('#dlgDetail'));
  openDlg($('#dlgBorrow'));
}
function updateBorrowKind(){
  const perm = bKind() === 'perm';
  $('#bDaysField').hidden = perm; $('#bReasonField').hidden = !perm;
  $('#bTitle').textContent = perm ? t('ขอยืมถาวร') : t('ยืมอุปกรณ์');
  $('#bSubmit').textContent = perm ? (isAdmin() ? t('บันทึกการยืมถาวร') : t('ส่งคำขอยืมถาวร')) : t('ยืนยันการยืม');
  showErr($('#bErr'), '');
}
function renderBorrowPhotos(){
  if (!B) return;
  const p = cfg().photos, min = p.minB || 0;
  $('#bPhotoTitle').textContent = min ? t('ถ่ายรูปอุปกรณ์หลายมุม (อย่างน้อย {n} รูป)', {n: min}) : t('ถ่ายรูปอุปกรณ์ (ไม่บังคับ)');
  $('#bPhotoBox').innerHTML = shotsBox(B.shots, 'b', min, p.max || 6, false);
}
async function shootBorrow(){
  const it = B && itemById(B.id); if (!it) return;
  const p = cfg().photos;
  const who = $('#bForOther').checked && $('#bName').value.trim() ? $('#bName').value.trim() : (S.me ? S.me.name : '');
  const shots = await takePhotos({
    title: t('ถ่ายรูปอุปกรณ์ก่อนยืม'), facing: 'environment', min: p.minB || 0, max: p.max || 6,
    hint: t('ถ่าย “{n}” หลายมุม เช่น ด้านหน้า ด้านหลัง ป้ายเลขครุภัณฑ์ อุปกรณ์เสริม', {n: it.name}),
    stamp: t('ยืม') + ' ' + (it.code || it.name) + ' · ' + who
  }, B.shots);
  if (shots && B){ B.shots = shots; showErr($('#bErr'), ''); }
  renderBorrowPhotos();
}
function updateBorrowPreview(anim){
  const it = B && itemById(B.id); if (!it) return;
  const max = it.maxDays || 7, days = clamp(parseInt($('#bDays').value, 10) || 1, 1, max);
  const due = endOfDay(addDays(Date.now(), days));
  $('#bStamp').textContent = fmtDate(due);
  $('#bDueLong').textContent = fmtDateLong(due) + ' (' + nDays(days) + ')';
  $$('#bQuick .chip').forEach(c => c.setAttribute('aria-pressed', String(+c.dataset.days === days)));
  if (anim){ const s = $('#bStampBox'); s.classList.remove('thunk'); void s.offsetWidth; s.classList.add('thunk'); }
}
function fillDatalists(){
  const ls = visibleLoans();
  const names = [...new Set(ls.map(l => (l.borrower || '').trim()).filter(Boolean))].slice(0, 200);
  const groups = [...new Set(ls.map(l => (l.group || '').trim()).filter(Boolean))].slice(0, 100);
  $('#nameList').innerHTML = names.map(n => '<option value="' + esc(n) + '"></option>').join('');
  $('#groupList').innerHTML = groups.map(n => '<option value="' + esc(n) + '"></option>').join('');
}
function updateMapLink(){
  const m = coordRe.exec($('#bUseAt').value), a = $('#bMapLink');
  a.hidden = !m; if (m) a.href = 'https://www.google.com/maps?q=' + m[1] + ',' + m[2];
}
function useGps(){
  if (!navigator.geolocation){ toast(t('เครื่องนี้หาตำแหน่งไม่ได้ พิมพ์ชื่อสถานที่แทนได้'), 'bad'); return; }
  const btn = $('#btnGps'); busy(btn, true, t('กำลังหาตำแหน่ง…'));
  navigator.geolocation.getCurrentPosition(p => {
    busy(btn, false);
    const c = p.coords.latitude.toFixed(5) + ', ' + p.coords.longitude.toFixed(5);
    const inp = $('#bUseAt'), cur = inp.value.replace(coordRe, '').replace(/[\s·]+$/, '').trim();
    inp.value = (cur ? cur + ' · ' : '') + c; updateMapLink();
  }, err => {
    busy(btn, false);
    toast(err && err.code === 1 ? t('แอปยังไม่ได้รับสิทธิ์ใช้ตำแหน่ง ให้กดอนุญาตในการตั้งค่าเบราว์เซอร์') : t('หาตำแหน่งไม่สำเร็จ ลองใหม่หรือพิมพ์ชื่อสถานที่แทน'), 'bad');
  }, {enableHighAccuracy: true, timeout: 15000, maximumAge: 60000});
}
async function submitBorrow(e){
  e.preventDefault();
  const it = B && itemById(B.id); if (!it) return;
  const perm = bKind() === 'perm';
  const forOther = $('#bForOther').checked, name = $('#bName').value.trim();
  if (forOther && !name){ showErr($('#bErr'), t('กรุณาใส่ชื่อคนที่ยืม')); $('#bName').focus(); return; }
  const reason = $('#bReason').value.trim();
  if (perm && !reason){ showErr($('#bErr'), t('กรุณาบอกเหตุผลที่ขอยืมถาวร')); $('#bReason').focus(); return; }
  const min = cfg().photos.minB || 0;
  if (B.shots.length < min){ showErr($('#bErr'), t('ต้องถ่ายรูปอุปกรณ์อย่างน้อย {n} รูป (ตอนนี้ {c} รูป)', {n: min, c: B.shots.length})); return; }
  if (hasPolicy() && !$('#bAccept').checked){ showErr($('#bErr'), t('กรุณาอ่านและกดยอมรับนโยบายการยืมก่อน')); return; }
  showErr($('#bErr'), '');
  const avail = availableOf(it);
  const qty = clamp(parseInt($('#bQty').value, 10) || 1, 1, Math.max(1, avail));
  const days = clamp(parseInt($('#bDays').value, 10) || 1, 1, it.maxDays || 7);
  const j = await write({action: 'borrow', itemId: it.id, kind: perm ? 'perm' : 'temp', forOther, borrower: name, group: forOther ? $('#bGroup').value.trim() : '',
    qty, days, reason: perm ? reason : '', useAt: $('#bUseAt').value.trim(), note: $('#bNote').value.trim(),
    photos: B.shots.map(s => s.full), acceptPolicy: $('#bAccept').checked}, $('#bSubmit'), B.shots.length ? t('กำลังส่งรูป…') : '');
  if (j){ B.shots = []; closeDlg($('#dlgBorrow')); vibrate([40, 60, 40]); }
}

/* return (ผู้ยืม): ถ่ายรูปหลายมุม รูปแรกต้องเห็นหน้า */
let R = null;
function sumRows(l, extra){
  const rows = [
    [t('อุปกรณ์'), loanItemName(l) + ((l.qty || 1) > 1 ? ' ×' + l.qty : '') + (l.code ? ' (' + l.code + ')' : '')],
    [t('คนยืม'), l.borrower + (l.group ? ' (' + l.group + ')' : '')],
    [t('ยืมเมื่อ'), fmtDate(l.borrowedAt) + ' · ' + fmtTime(l.borrowedAt)]
  ];
  if (hasDue(l)) rows.push([t('จำนวนวันที่ยืม'), nDays(l.days)], [t('กำหนดคืน'), fmtDate(l.dueAt)]);
  else rows.push([t('ประเภท'), l.status === 'pending' ? t('ขอยืมถาวร') : t('ยืมถาวร')]);
  if (l.useAt) rows.push([t('นำไปใช้ที่'), l.useAt]);
  return rows.concat(extra || []).map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('');
}
function openReturn(id){
  const l = loanById(id); if (!l) return;
  if (isAdmin()) return openReview(id);
  R = {id, shots: []};
  const now = Date.now(), s = loanState(l, now);
  $('#rSum').innerHTML = sumRows(l, [[t('คืนวันนี้'), fmtDate(now) + ' · ' + fmtTime(now)]]);
  const st = $('#rState');
  if (!hasDue(l)){ st.textContent = t('คืนอุปกรณ์ที่ยืมถาวร'); st.className = 'state ok'; }
  else { st.textContent = s.k === 'overdue' ? t('คืนช้ากว่ากำหนด {d} วัน', {d: s.days}) : t('คืนตรงเวลา 👍'); st.className = 'state ' + (s.k === 'overdue' ? 'bad' : 'ok'); }
  const an = $('#rAdminNote');
  an.innerHTML = l.adminNote && l.reviewedAt ? '<b>' + esc(t('ครั้งก่อนยังไม่ผ่าน · ข้อความจากผู้ดูแล')) + ':</b> ' + esc(l.adminNote) : '';
  an.hidden = !(l.adminNote && l.reviewedAt);
  $('#rNote').value = ''; showErr($('#rErr'), '');
  renderReturnPhotos();
  closeDlg($('#dlgDetail'));
  openDlg($('#dlgReturn'));
}
function renderReturnPhotos(){
  if (!R) return;
  const p = cfg().photos, min = Math.max(1, p.minR || 1);
  $('#rPhotoTitle').textContent = t('ถ่ายรูปตอนคืน (อย่างน้อย {n} รูป รูปแรกต้องเห็นหน้าคุณ)', {n: min});
  $('#rPhotoBox').innerHTML = shotsBox(R.shots, 'r', min, p.max || 6, true);
  $('#rSubmit').disabled = !(R.shots.length >= min && R.shots.some(s => s.face));
}
async function shootReturn(){
  const l = R && loanById(R.id); if (!l) return;
  const p = cfg().photos, n = loanItemName(l);
  const shots = await takePhotos({
    title: t('ถ่ายรูปคืนอุปกรณ์'), faceFirst: true, facing: 'environment', min: Math.max(1, p.minR || 1), max: p.max || 6,
    faceHint: t('รูปแรก: ถือ “{n}” ไว้ข้างหน้า ให้เห็นหน้าคุณและอุปกรณ์ชัดเจน', {n}),
    hint: t('ถ่าย “{n}” มุมอื่นๆ ให้เห็นสภาพ', {n}),
    stamp: t('คืน') + ' ' + (l.code || n) + ' · ' + l.borrower
  }, R.shots);
  if (shots && R){ R.shots = shots; showErr($('#rErr'), ''); }
  renderReturnPhotos();
}
async function submitReturn(e){
  e.preventDefault();
  const l = R && loanById(R.id); if (!l) return;
  const min = Math.max(1, cfg().photos.minR || 1);
  if (!R.shots.some(s => s.face)){ showErr($('#rErr'), t('กรุณาถ่ายรูปตัวคุณคู่กับอุปกรณ์ก่อนส่ง')); return; }
  if (R.shots.length < min){ showErr($('#rErr'), t('ต้องถ่ายรูปอย่างน้อย {n} รูป (ตอนนี้ {c} รูป)', {n: min, c: R.shots.length})); return; }
  const j = await write({action: 'requestReturn', loanId: l.id, photos: R.shots.map(s => s.full), returnNote: $('#rNote').value.trim()}, $('#rSubmit'), t('กำลังส่งรูป…'));
  if (j){ R.shots = []; closeDlg($('#dlgReturn')); vibrate([40, 60, 40]); }
  else renderReturnPhotos();
}

/* review (ผู้ดูแล): ตรวจการคืน / รับคืนต่อหน้า / พิจารณาคำขอยืมถาวร */
let V = null;
function openReview(id){
  const l = loanById(id); if (!l) return;
  const mode = l.status === 'review' ? 'review' : (l.status === 'pending' ? 'perm' : 'direct');
  V = {id, mode};
  $('#vTitle').textContent = mode === 'review' ? t('ตรวจสอบการคืน') : mode === 'perm' ? t('พิจารณาคำขอยืมถาวร') : t('รับคืนอุปกรณ์ (ต่อหน้า)');
  const name = loanItemName(l) + ' · ' + l.borrower;
  const b = l.borrowPhotoIds || [], r = l.returnPhotoIds || [];
  const group = (h, html) => '<div class="pgroup"><h4>' + esc(h) + '</h4>' + html + '</div>';
  let ph = '';
  if (mode === 'review') ph += r.length ? group(t('รูปตอนคืน ({n})', {n: r.length}), photoGrid(r, t('รูปตอนคืน') + ' · ' + name, true)) + '<p class="help">' + esc(t('ตรวจว่ารูปแรกเห็นหน้าผู้ยืมคู่กับอุปกรณ์ชัดเจน แตะรูปเพื่อดูขนาดใหญ่')) + '</p>' : '<p class="note-box">' + esc(t('ไม่มีรูปแนบ')) + '</p>';
  if (mode === 'direct') ph += '<p class="note-box">' + esc(t('ผู้ดูแลรับของคืนด้วยตัวเอง ไม่ต้องถ่ายรูป')) + '</p>';
  if (b.length) ph += group(mode === 'perm' ? t('รูปตอนยืม ({n})', {n: b.length}) : t('รูปตอนยืม ({n}) ใช้เทียบสภาพ', {n: b.length}), photoGrid(b, t('รูปตอนยืม') + ' · ' + name, false));
  $('#vPhotos').innerHTML = ph;
  const now = Date.now(), extra = [];
  if (mode === 'perm'){
    if (l.permReason) extra.push([t('เหตุผลที่ขอยืมถาวร'), l.permReason]);
  } else {
    if (mode === 'review' && l.returnReqAt) extra.push([t('ส่งหลักฐานเมื่อ'), fmtWhen(l.returnReqAt)]);
    if (hasDue(l)){
      const late = dayDiff(l.dueAt, mode === 'review' && l.returnReqAt ? l.returnReqAt : now);
      extra.push([t('สถานะเวลา'), late > 0 ? t('คืนช้ากว่ากำหนด {d} วัน', {d: late}) : t('คืนตรงเวลา')]);
    }
    if (l.returnNote) extra.push([t('ผู้ยืมแจ้งสภาพ'), l.returnNote]);
  }
  if (l.note) extra.push([t('หมายเหตุตอนยืม'), l.note]);
  $('#vSum').innerHTML = sumRows(l, extra);
  $('#vReturnChoices').hidden = mode === 'perm'; $('#vPermChoices').hidden = mode !== 'perm';
  $('#vRedoWrap').hidden = mode !== 'review';
  $$('input[name=vResult]').forEach(x => { x.checked = mode === 'direct' && x.value === 'ok'; });
  $$('input[name=vDecision]').forEach(x => { x.checked = false; });
  $('#vRepair').checked = false; $('#vNote').value = ''; showErr($('#vErr'), '');
  const users = D().users || [];
  const hasAcct = !!l.userId || (!!l.recordedBy && users.some(u => u.email === l.recordedBy));
  const mailOn = !!(S.data.settings && S.data.settings.mailOn);
  $('#vMailWrap').hidden = !(hasAcct && mailOn); $('#vMail').checked = true;
  $('#vNoAcct').hidden = hasAcct;
  $('#vSubmit').dataset.label = '';
  $('#vSubmit').textContent = hasAcct ? (mode === 'perm' ? t('บันทึกและแจ้งผู้ขอ') : t('บันทึกและแจ้งผู้ยืม')) : t('บันทึกผล');
  updateReviewForm();
  closeDlg($('#dlgDetail'));
  openDlg($('#dlgReview'));
  hydrate($('#vPhotos'));
}
function updateReviewForm(){
  const l = V && loanById(V.id); if (!l) return;
  const lbl = $('#vNoteLbl'), ta = $('#vNote'), hint = $('#vScoreHint');
  if (V.mode === 'perm'){
    const d = (document.querySelector('input[name=vDecision]:checked') || {}).value;
    $('#vRepairWrap').hidden = true; hint.textContent = '';
    if (d === 'reject'){ lbl.textContent = t('เหตุผลที่ไม่อนุมัติ (จำเป็น · ผู้ขอจะเห็นข้อความนี้)'); ta.placeholder = t('เช่น อุปกรณ์นี้ต้องใช้ร่วมกันหลายโครงการ'); }
    else { lbl.textContent = t('ข้อความถึงผู้ขอ (ไม่ใส่ก็ได้)'); ta.placeholder = t('เช่น อนุมัติถึงสิ้นปีงบประมาณ'); }
    return;
  }
  const r = (document.querySelector('input[name=vResult]:checked') || {}).value;
  $('#vRepairWrap').hidden = r !== 'problem';
  if (r === 'problem'){ lbl.textContent = t('พบปัญหาอะไร (จำเป็น · ผู้ยืมจะเห็นข้อความนี้)'); ta.placeholder = t('เช่น สายชาร์จหายไป 1 เส้น / เลนส์มีรอยขีดข่วน'); }
  else if (r === 'redo'){ lbl.textContent = t('เหตุผลที่ยังไม่ผ่าน (จำเป็น · ผู้ยืมจะเห็นข้อความนี้)'); ta.placeholder = t('เช่น รูปไม่เห็นหน้า กรุณาถ่ายใหม่ให้เห็นหน้าและอุปกรณ์'); }
  else { lbl.textContent = t('ข้อความถึงผู้ยืม (ไม่ใส่ก็ได้)'); ta.placeholder = t('เช่น ขอบคุณที่คืนตรงเวลา'); }
  // ตัวอย่างคะแนนที่จะเปลี่ยน
  const sc = S.data.settings && S.data.settings.score;
  hint.textContent = '';
  if (!sc || !l.userId || !r) return;
  if (r === 'redo'){ hint.textContent = t('ยังไม่คิดคะแนนจนกว่าการคืนจะผ่าน'); return; }
  const late = hasDue(l) ? Math.max(0, dayDiff(l.dueAt, V.mode === 'review' && l.returnReqAt ? l.returnReqAt : Date.now())) : 0;
  let delta = 0; const why = [];
  if (late > 0){ delta -= late * sc.late; why.push(t('คืนช้า {d} วัน', {d: late})); }
  if (r === 'problem'){ delta -= sc.prob; why.push(t('พบปัญหาตอนคืน')); }
  const bu0 = (D().users || []).find(x => x.id === l.userId);
  if (r === 'ok' && late === 0 && sc.cap > 0 && bu0 && (bu0.monthGains || 0) >= sc.cap){ hint.textContent = t('คืนตรงเวลา แต่เดือนนี้ผู้ยืมได้คะแนนเพิ่มครบ {n} ครั้งแล้ว จึงไม่ได้คะแนนเพิ่ม (กันการปั๊มคะแนน)', {n: sc.cap}); return; }
  if (r === 'ok' && late === 0){ delta += sc.ok; why.push(t('คืนตรงเวลา')); }
  const bu = (D().users || []).find(x => x.id === l.userId);
  if (delta > 0 && bu && typeof bu.score === 'number' && bu.score >= sc.start) hint.textContent = t('คืนตรงเวลา (ผู้ยืมมีคะแนนเต็ม {m} อยู่แล้ว)', {m: sc.start});
  else if (delta) hint.textContent = t('คะแนนผู้ยืมจะเปลี่ยน {d} ({w})', {d: (delta > 0 ? '+' : '') + delta, w: why.join(', ')});
}
async function submitReview(e){
  e.preventDefault();
  const l = V && loanById(V.id); if (!l) return;
  const note = $('#vNote').value.trim();
  const sendEmail = !$('#vMailWrap').hidden && $('#vMail').checked;
  if (V.mode === 'perm'){
    const decision = (document.querySelector('input[name=vDecision]:checked') || {}).value;
    if (!decision){ showErr($('#vErr'), t('กรุณาเลือกผลการพิจารณา')); return; }
    if (decision === 'reject' && !note){ showErr($('#vErr'), t('กรุณาเขียนเหตุผลที่ไม่อนุมัติ เพื่อแจ้งผู้ขอ')); $('#vNote').focus(); return; }
    showErr($('#vErr'), '');
    if (await write({action: 'reviewPerm', loanId: l.id, decision, note, sendEmail}, $('#vSubmit'))){ closeDlg($('#dlgReview')); vibrate(40); }
    return;
  }
  const result = (document.querySelector('input[name=vResult]:checked') || {}).value;
  if (!result){ showErr($('#vErr'), t('กรุณาเลือกผลการตรวจสอบ')); return; }
  if ((result === 'problem' || result === 'redo') && !note){ showErr($('#vErr'), result === 'problem' ? t('กรุณาเขียนว่าพบปัญหาอะไร') : t('กรุณาเขียนเหตุผล เพื่อให้ผู้ยืมส่งใหม่ได้ถูกต้อง')); $('#vNote').focus(); return; }
  showErr($('#vErr'), '');
  const j = await write({action: 'reviewReturn', loanId: l.id, result, note, markRepair: result === 'problem' && $('#vRepair').checked, sendEmail}, $('#vSubmit'));
  if (j){ closeDlg($('#dlgReview')); vibrate(40); }
}

/* item form */
let I = null;
const cleanPrefix = p => String(p || '').toUpperCase().replace(/[^A-Z0-9ก-๙]/g, '').slice(0, 10);
function nextCode(prefix){
  const digits = (S.data.settings && S.data.settings.codeDigits) || 4;
  const re = new RegExp('^' + prefix + '-(\\d+)$', 'i');
  let max = 0;
  D().items.forEach(it => { const m = re.exec(it.code || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return prefix + '-' + String(max + 1).padStart(digits, '0');
}
function catPrefix(name){ const c = catByName(name); return (c && c.prefix) || (S.data.settings && S.data.settings.codePrefix) || 'EQ'; }
function updateCodePreview(){
  if (!I || I.id) return;
  const typed = $('#iCode').value.trim();
  const p = cleanPrefix($('#iPrefix').value) || catPrefix($('#iCat').value);
  $('#iCodePrev').textContent = nextCode(p);
  $('#iCodePrevBox').classList.toggle('off', !!typed);
  $('#iCodeHelp').textContent = typed ? t('จะใช้รหัสที่พิมพ์ไว้: {c}', {c: typed}) : t('เว้นช่องรหัสว่างไว้ ระบบจะรันเลขต่อจากตัวอักษรนำหน้าให้เอง');
}
function renderItemImage(){
  const prev = $('#iImgPrev');
  let src = '';
  if (I.img === 'new') src = I.thumb;
  else if (I.img === 'keep' && I.imageId) src = TH[I.imageId] || '';
  prev.innerHTML = src ? '<img src="' + src + '" alt="">' : '<span>' + esc(I.img === 'remove' ? t('จะลบรูปเมื่อกดบันทึก') : (I.img === 'keep' && I.imageId ? t('มีรูปอยู่แล้ว') : t('ยังไม่มีรูป'))) + '</span>';
  $('#btnIRemove').hidden = !(I.img === 'new' || (I.img === 'keep' && I.imageId));
}
const iOwn = () => ((document.querySelector('input[name=iOwn]:checked') || {}).value === 'personal' ? 'personal' : 'office');
function updateOwnUi(){
  const personal = iOwn() === 'personal';
  $('#iAssetField').hidden = personal; $('#iOwnerField').hidden = !personal;
}
function openItem(id, preset){
  const it = id ? itemById(id) : null;
  I = {id: it ? it.id : null, img: 'keep', imageId: it ? it.imageId : '', full: '', thumb: '', prefixTouched: false};
  $('#iTitle').textContent = it ? t('แก้ไขอุปกรณ์') : t('เพิ่มอุปกรณ์');
  const cats = sortedCats();
  $('#iCat').innerHTML = cats.map(c => '<option value="' + esc(c.name) + '">' + esc(catIcon(c) + ' ' + c.name) + '</option>').join('') + '<option value="">' + esc(t('ไม่มีหมวด')) + '</option>';
  const cur = it ? it.category : (S.cat !== 'all' && S.cat !== '_none' ? S.cat : (cats[0] ? cats[0].name : ''));
  $('#iCat').value = catByName(cur) ? cur : '';
  $('#iName').value = it ? it.name : '';
  const o = cfg().org;
  $('#iOwnOffice').textContent = t('ครุภัณฑ์ {org}', {org: o.org});
  $('#iOwnPersonal').textContent = t('ส่วนตัว ({team})', {team: o.team});
  const own = it ? it.ownType : (S.own === 'personal' ? 'personal' : 'office');
  $$('input[name=iOwn]').forEach(r => { r.checked = r.value === own; });
  $('#iAsset').value = it ? (it.assetNo || '') : ((preset && preset.assetNo) || '');
  const users = (D().users || []).filter(u => u.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'th'));
  $('#iOwnerUser').innerHTML = '<option value="">' + esc(t('— เจ้าของไม่มีบัญชีในแอป (พิมพ์ชื่อด้านล่าง) —')) + '</option>' +
    users.map(u => '<option value="' + esc(u.email) + '">' + esc(u.name + ' · ' + u.email) + '</option>').join('');
  $('#iOwnerUser').value = it && it.ownerEmail && users.some(u => u.email === it.ownerEmail) ? it.ownerEmail : '';
  $('#iOwner').value = it ? (it.owner || '') : '';
  $('#iLocation').value = it ? (it.location || '') : '';
  const locs = [...new Set(D().items.map(x => (x.location || '').trim()).filter(Boolean))].slice(0, 100);
  $('#locList').innerHTML = locs.map(n => '<option value="' + esc(n) + '"></option>').join('');
  $('#iCode').value = it ? it.code : ((preset && preset.code) || '');
  $('#iAuto').hidden = !!it;
  $('#iPrefix').value = it ? '' : catPrefix($('#iCat').value);
  if (it) $('#iCodeHelp').textContent = t('แก้รหัสได้ ถ้าแก้แล้วต้องพิมพ์ป้าย QR ใหม่');
  $('#iQty').value = it ? it.qty : 1;
  $('#iMax').value = it ? it.maxDays : 7;
  $('#iPerm').checked = it ? it.allowPerm !== false : true;
  const st = it ? it.status : 'lendable';
  $$('input[name=iStatus]').forEach(r => { r.checked = r.value === st; });
  $('#iNote').value = it ? it.note : '';
  $('#iFile').value = '';
  showErr($('#iErr'), '');
  updateOwnUi(); renderItemImage(); updateCodePreview();
  closeDlg($('#dlgDetail'));
  openDlg($('#dlgItem'));
}
function setItemShot(shot){ if (!shot || !I) return; I.img = 'new'; I.full = shot.full; I.thumb = shot.thumb; renderItemImage(); }
async function submitItem(e){
  e.preventDefault();
  const name = $('#iName').value.trim();
  if (!name){ showErr($('#iErr'), t('กรุณาใส่ชื่ออุปกรณ์')); $('#iName').focus(); return; }
  const ownType = iOwn();
  const owner = $('#iOwner').value.trim();
  if (ownType === 'personal' && !owner){ showErr($('#iErr'), t('กรุณาใส่ชื่อเจ้าของอุปกรณ์ส่วนตัว')); $('#iOwner').focus(); return; }
  const item = {
    id: I.id || '', name, category: $('#iCat').value, code: $('#iCode').value.trim(), prefix: I.id ? '' : cleanPrefix($('#iPrefix').value),
    qty: clamp(parseInt($('#iQty').value, 10) || 1, 1, 999), maxDays: clamp(parseInt($('#iMax').value, 10) || 7, 1, 365),
    status: (document.querySelector('input[name=iStatus]:checked') || {}).value || 'lendable', note: $('#iNote').value.trim(),
    ownType, assetNo: ownType === 'office' ? $('#iAsset').value.trim() : '', owner: ownType === 'personal' ? owner : '',
    ownerEmail: ownType === 'personal' ? $('#iOwnerUser').value : '', location: $('#iLocation').value.trim(), allowPerm: $('#iPerm').checked
  };
  if (I.img === 'new'){ item.image = I.full; item.thumb = I.thumb; }
  if (I.img === 'remove') item.removeImage = true;
  if (await write({action: 'saveItem', item}, $('#iSubmit'), I.img === 'new' ? t('กำลังอัปโหลดรูป…') : '')) closeDlg($('#dlgItem'));
}

/* category form */
let C = null;
function openCat(id){
  const c = id ? D().cats.find(x => x.id === id) : null; C = c ? c.id : null;
  $('#cTitle').textContent = c ? t('แก้ไขหมวดหมู่') : t('เพิ่มหมวดหมู่');
  $('#cName').value = c ? c.name : '';
  $('#cPrefix').value = c ? (c.prefix || '') : '';
  $('#cPrefixHelp').textContent = t('เว้นว่าง = ใช้ค่าเริ่มต้น {p} (แก้ค่าเริ่มต้นได้ในชีต “ตั้งค่า”) · รหัสของอุปกรณ์เดิมจะไม่เปลี่ยน', {p: (S.data.settings && S.data.settings.codePrefix) || 'EQ'});
  $('#cIcon').value = c ? (c.icon || '') : '📦';
  $('#cIcons').innerHTML = ICONS.map(x => '<button type="button" data-icon="' + x + '" aria-label="' + esc(t('ใช้ไอคอน {i}', {i: x})) + '">' + x + '</button>').join('');
  showErr($('#cErr'), '');
  openDlg($('#dlgCat'));
}
async function submitCat(e){
  e.preventDefault();
  const name = $('#cName').value.trim();
  if (!name){ showErr($('#cErr'), t('กรุณาใส่ชื่อหมวดหมู่')); $('#cName').focus(); return; }
  if (await write({action: 'saveCat', cat: {id: C || '', name, icon: $('#cIcon').value.trim() || '📦', prefix: cleanPrefix($('#cPrefix').value)}}, $('#cSubmit'))) closeDlg($('#dlgCat'));
}

async function doDelete(key){
  const i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
  S.confirm = null;
  render(); if ($('#dlgDetail').open) fillDetail();
  if (kind === 'cancel'){ await write({action: 'cancelRequest', loanId: id}); if ($('#dlgDetail').open) fillDetail(); return; }
  const action = {item: 'deleteItem', cat: 'deleteCat', loan: 'deleteLoan'}[kind];
  if (action) await write({action, id});
}

/* members (admin) */
async function setUser(id, patch, btn){ await write(Object.assign({action: 'setUser', id}, patch), btn); }
async function resetUserPw(id, btn){
  const u = (D().users || []).find(x => x.id === id);
  const j = await write({action: 'resetUserPassword', id}, btn);
  if (j && j.tempPassword){
    $('#tFor').textContent = t('สำหรับ {n}', {n: u ? u.name + ' (' + u.email + ')' : t('สมาชิก|role')});
    $('#tPw').textContent = j.tempPassword;
    openDlg($('#dlgTemp'));
  }
}
/* คะแนน (ผู้ดูแลปรับ) */
let SCU = null;
/** การ์ดคะแนน: หน้า emoji + ตัวเลข + แถบสีจากแดงไปเขียวเข้ม */
function scoreCard(score, head, sub, extra){
  const m = scoreMood(score), c = cfg(), max = c.scoreMax || 100, min = c.scoreMin || 0;
  const pct = clamp(score / max * 100, 0, 100);
  return '<span class="score-ring lvl-' + m.lv + '" aria-hidden="true">' + m.emoji + '</span><div class="score-main">' +
    (head ? '<b>' + esc(head) + '</b>' : '') +
    '<span class="score-num lvl-' + m.lv + '">' + score + '<small> / ' + max + '</small> · ' + esc(m.label) + '</span>' +
    '<span class="score-meter" role="img" aria-label="' + esc(t('คะแนน {s} จาก {m}', {s: score, m: max})) + '"><i style="left:' + pct + '%"></i>' +
      (min ? '<u style="left:' + clamp(min / max * 100, 0, 100) + '%" title="' + esc(t('เกณฑ์ขั้นต่ำ {n}', {n: min})) + '"></u>' : '') + '</span>' +
    (sub ? '<span class="score-sub">' + esc(sub) + '</span>' : '') + (extra || '') + '</div>';
}
function quotaLine(gains, cap){
  if (!cap) return '';
  const full = gains >= cap;
  return '<span class="quota' + (full ? ' full' : '') + '">' + esc(t('เดือนนี้ได้คะแนนเพิ่มแล้ว {g}/{c} ครั้ง', {g: gains, c: cap})) +
    (full ? ' · ' + esc(t('ครบแล้ว คืนตรงเวลาจะได้คะแนนเพิ่มอีกครั้งตั้งแต่ต้นเดือนหน้า')) : '') + '</span>';
}
function openScore(id){
  const u = (D().users || []).find(x => x.id === id); if (!u) return;
  SCU = id;
  $('#scWho').innerHTML = scoreCard(u.score, u.name, u.email, quotaLine(u.monthGains || 0, cfg().gainCap || 0));
  $('#scDelta').value = 5; $('#scDelta').min = -100; $('#scDelta').max = 100;
  $('#scReason').value = ''; showErr($('#scErr'), '');
  openDlg($('#dlgScore'));
}
async function submitScore(e){
  e.preventDefault();
  const delta = parseInt($('#scDelta').value, 10) || 0;
  const reason = $('#scReason').value.trim();
  if (!delta){ showErr($('#scErr'), t('กรุณาใส่จำนวนคะแนนที่จะเพิ่มหรือลด')); return; }
  if (!reason){ showErr($('#scErr'), t('กรุณาใส่เหตุผล')); $('#scReason').focus(); return; }
  showErr($('#scErr'), '');
  if (await write({action: 'adjustScore', id: SCU, delta, reason}, $('#scSubmit'))) closeDlg($('#dlgScore'));
}

/* นโยบายการยืม */
function fillPolicy(){
  const p = D().policy || {};
  $('#polText').textContent = policyText() || t('ยังไม่มีนโยบายการยืม');
  $('#polAt').textContent = p.at ? t('แก้ไขล่าสุด {d}', {d: fmtDate(p.at)}) : '';
  $('#btnPolEdit').hidden = !isAdmin() || S.offline;
}
function openPolicy(){ fillPolicy(); openDlg($('#dlgPolicy')); }
function openPolicyEdit(){
  const p = D().policy || {};
  $('#peTh').value = p.th || ''; $('#peEn').value = p.en || '';
  showErr($('#peErr'), '');
  closeDlg($('#dlgPolicy'));
  openDlg($('#dlgPolicyEdit'));
}
async function submitPolicy(e){
  e.preventDefault();
  if (await write({action: 'savePolicy', th: $('#peTh').value.trim(), en: $('#peEn').value.trim()}, $('#peSubmit'))) closeDlg($('#dlgPolicyEdit'));
}

/* account */
function openAccount(){
  if (!S.me) return;
  const m = S.me;
  $('#aAvatar').textContent = initial(m.name);
  $('#aName').textContent = m.name;
  $('#aMeta').textContent = m.email + ' · ' + (m.role === 'admin' ? t('ผู้ดูแล') : t('สมาชิก|role')) + ' · ' + t('เข้าด้วย {m}', {m: methodLabel(m.method)}) + ' · ' + t('แอปเวอร์ชัน {v}', {v: VERSION});
  $$('[data-set-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.setLang === LANG)));
  const ms = D().myScore, c = cfg();
  const sc = ms ? ms.score : c.scoreMax;
  $('#aScore').innerHTML = scoreCard(sc, '', t('คืนตรงเวลาได้คะแนนเพิ่ม คืนช้าหรือมีปัญหาจะถูกหักคะแนน') + (c.scoreMin ? ' · ' + t('ต้องมีอย่างน้อย {n} คะแนนจึงจะยืมได้', {n: c.scoreMin}) : ''),
    quotaLine(ms ? (ms.monthGains || 0) : 0, c.gainCap || 0));
  const log = (ms && ms.log) || [];
  $('#aScoreLog').innerHTML = !log.length ? '<p class="help">' + esc(t('ยังไม่มีประวัติคะแนน')) + '</p>' :
    log.slice(0, 15).map(x => '<div><span>' + esc(x.reason) + '<small>' + (x.time ? esc(fmtWhen(x.time)) : '') + '</small></span><span class="d ' + (x.delta >= 0 ? 'up' : 'down') + '">' + (x.delta > 0 ? '+' : '') + x.delta + '</span></div>').join('');
  $('#pName').value = m.name || ''; $('#pGroup').value = m.group || '';
  $('#pwTitle').textContent = m.hasPassword ? t('เปลี่ยนรหัสผ่าน') : t('ตั้งรหัสผ่าน (เพื่อเข้าด้วยอีเมลได้ด้วย)');
  $('#pwCurWrap').hidden = !m.hasPassword;
  $('#pwCur').value = ''; $('#pwNew').value = ''; showErr($('#pwErr'), '');
  openDlg($('#dlgAccount'));
}
async function submitProfile(e){
  e.preventDefault();
  const name = $('#pName').value.trim();
  if (!name){ toast(t('กรุณาใส่ชื่อ'), 'bad'); return; }
  if (await write({action: 'updateProfile', name, group: $('#pGroup').value.trim()}, $('#pSubmit'))) closeDlg($('#dlgAccount'));
}
async function submitPw(e){
  e.preventDefault();
  const pw = $('#pwNew').value;
  if (S.me.hasPassword && !$('#pwCur').value){ showErr($('#pwErr'), t('กรุณาใส่รหัสผ่านปัจจุบัน')); return; }
  if (pw.length < 6){ showErr($('#pwErr'), t('รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัว')); return; }
  showErr($('#pwErr'), '');
  if (await write({action: 'changePassword', current: $('#pwCur').value, password: pw}, $('#pwSubmit'))) closeDlg($('#dlgAccount'));
}
async function logoutAll(){
  try { await call({action: 'logoutAll'}); } catch (e){}
  logout(true); toast(t('ออกจากระบบทุกเครื่องแล้ว'), 'ok');
}

/* settings */
function openSettings(){
  $('#sUrl').value = S.api || '';
  $('#sUrlHelp').textContent = (window.LEND_CONFIG && window.LEND_CONFIG.API_URL) ? t('ไฟล์ config.js มีลิงก์ตั้งไว้แล้ว ถ้าแก้ตรงนี้จะใช้เฉพาะในเครื่องนี้') : t('ลิงก์นี้จะถูกจำไว้ในเครื่องนี้');
  showErr($('#sErr'), '');
  openDlg($('#dlgSettings'));
}
async function connect(url, errEl, btn){
  url = normApi(url);
  if (!validApi(url)){ showErr(errEl, t('ลิงก์ต้องขึ้นต้นด้วย https://script.google.com/ และลงท้ายด้วย /exec')); return false; }
  if (/\/dev(\?|$)/.test(url)){ showErr(errEl, t('นี่คือลิงก์ทดสอบ (/dev) ให้ใช้ลิงก์ที่ลงท้ายด้วย /exec')); return false; }
  showErr(errEl, ''); busy(btn, true, t('กำลังทดสอบ…'));
  try {
    const info = await call({action: 'info'}, url);
    if (url !== S.api){ logout(true); }
    S.api = url; S.info = info; LS.set('api', url); LS.set('info', info); S.error = '';
    toast(t('เชื่อมต่อสำเร็จ'), 'ok'); render();
    if (S.token) refresh(false);
    return true;
  } catch (e){ showErr(errEl, e.message); return false; }
  finally { busy(btn, false); }
}

/* ---------- QR labels ---------- */
function qrSvg(text, cell){
  if (typeof qrcode !== 'function') return '<p class="err">' + esc(t('โหลดตัวสร้าง QR ไม่สำเร็จ')) + '</p>';
  const q = qrcode(0, 'M'); q.addData(String(text)); q.make();
  return q.createSvgTag({cellSize: cell || 4, margin: 2, scalable: true});
}
function openLabels(){
  const cats = sortedCats();
  $('#lCat').innerHTML = '<option value="all">' + esc(t('ทุกหมวด')) + '</option>' + cats.map(c => '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>').join('');
  renderLabels(); openDlg($('#dlgLabels'));
}
function labelItems(){
  const cat = $('#lCat').value;
  return D().items.filter(it => it.code && (cat === 'all' || it.category === cat)).sort((a, b) => a.code.localeCompare(b.code));
}
function labelsHtml(list){
  return '<div class="labels-grid">' + list.map(it => '<div class="label">' + qrSvg(it.code) + '<div class="ln">' + esc(it.name) + '</div><div class="lc">' + esc(it.code) + (it.assetNo ? ' · ' + esc(it.assetNo) : '') + '</div></div>').join('') + '</div>';
}
function renderLabels(){
  const list = labelItems();
  $('#lGrid').outerHTML = list.length ? labelsHtml(list).replace('class="labels-grid"', 'class="labels-grid" id="lGrid"') : '<div class="labels-grid" id="lGrid"><p class="muted">' + esc(t('ยังไม่มีอุปกรณ์ในหมวดนี้')) + '</p></div>';
  $('#btnPrint').disabled = !list.length;
}
function printLabels(){
  const list = labelItems(); if (!list.length) return;
  const pa = $('#printArea');
  pa.className = $('#lSize').value === 'big' ? 'big' : '';
  pa.innerHTML = labelsHtml(list);
  closeDlg($('#dlgLabels'));
  setTimeout(() => { window.print(); }, 150);
}
window.addEventListener('afterprint', () => { $('#printArea').innerHTML = ''; });

/* ---------- scanner ---------- */
let scanner = null, scanMode = 'lookup', scanBusy = false;
function setScanMsg(s){ $('#scMsg').textContent = s; }
function camErrText(e){
  const m = String((e && (e.name || e.message)) || e || '');
  if (/NotAllowed|Permission/i.test(m)) return t('แอปยังไม่ได้รับสิทธิ์ใช้กล้อง ให้กดอนุญาตกล้องในการตั้งค่าเบราว์เซอร์ แล้วลองใหม่');
  if (/NotFound|no camera|Requested device|Overconstrained/i.test(m)) return t('ไม่พบกล้องในเครื่องนี้');
  if (/NotReadable|Could not start/i.test(m)) return t('กล้องถูกแอปอื่นใช้อยู่ ปิดแอปนั้นแล้วลองใหม่');
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return t('ต้องเปิดแอปผ่าน https เท่านั้นจึงจะใช้กล้องได้');
  return t('เปิดกล้องไม่ได้ ลองปิดแล้วเปิดแอปใหม่');
}
async function ensureScanner(){
  await loadScript('vendor/html5-qrcode.min.js');
  if (!scanner){
    const F = window.Html5QrcodeSupportedFormats;
    const formats = F ? [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.DATA_MATRIX] : undefined;
    scanner = new window.Html5Qrcode('reader', {verbose: false, formatsToSupport: formats, experimentalFeatures: {useBarCodeDetectorIfSupported: true}});
  }
  return scanner;
}
async function openScanner(mode){
  scanMode = mode || 'lookup'; scanBusy = false;
  $('#scTitle').textContent = scanMode === 'assign' ? t('สแกนบาร์โค้ดเดิมบนของ') : t('สแกนอุปกรณ์');
  $('#manualCode').value = '';
  openDlg($('#dlgScan'));
  setScanMsg(t('กำลังเปิดกล้อง…'));
  let sc;
  try { sc = await ensureScanner(); } catch (e){ setScanMsg(t('โหลดตัวสแกนไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่')); return; }
  if (!$('#dlgScan').open) return;
  try {
    await sc.start({facingMode: 'environment'}, {
      fps: 10,
      qrbox: (w, h) => { const base = Math.min(w || 300, h > 0 ? h : (w || 300)); const s = Math.max(150, Math.floor(base * 0.72)); return {width: s, height: Math.max(120, Math.floor(s * 0.8))}; }
    }, onScanned, () => {});
    setScanMsg(t('หันกล้องไปที่ QR หรือบาร์โค้ดบนอุปกรณ์'));
    if (!$('#dlgScan').open) stopScanCam();
  } catch (e){ setScanMsg(camErrText(e) + ' ' + t('หรือพิมพ์รหัสแทน')); }
}
async function stopScanCam(){ if (scanner && scanner.isScanning){ try { await scanner.stop(); } catch (e){} } }
async function closeScanner(){ await stopScanCam(); try { $('#dlgScan').close(); } catch (e){ $('#dlgScan').removeAttribute('open'); } }
function onScanned(text){
  if (scanBusy) return; scanBusy = true;
  vibrate(80);
  closeScanner().then(() => handleCode(String(text || '').trim()));
}
async function scanPhoto(file){
  if (!file) return;
  setScanMsg(t('กำลังอ่านรหัสจากรูป…'));
  try {
    const sc = await ensureScanner();
    await stopScanCam();
    onScanned(await sc.scanFile(file, false));
  } catch (e){ setScanMsg(t('อ่านรหัสจากรูปไม่ได้ ลองถ่ายให้ใกล้และชัดขึ้น หรือพิมพ์รหัสแทน')); }
  finally { $('#scanFile').value = ''; }
}
const normCode = s => String(s || '').toLowerCase().replace(/\s+/g, '');
function handleCode(code){
  if (!code) return;
  if (scanMode === 'assign'){ $('#iCode').value = code; updateCodePreview(); toast(t('ใช้รหัส {c}', {c: code}), 'ok'); return; }
  if (!S.data) return toast(t('ยังโหลดข้อมูลไม่เสร็จ ลองใหม่อีกครั้ง'), 'bad');
  const low = normCode(code);
  // ตัวเลขล้วน: เทียบแบบไม่สนเลข 0 นำหน้า (ข้อมูลเก่าที่ชีตแปลงเป็นตัวเลขไปแล้ว)
  const digitsEq = (a, b) => /^\d+$/.test(a) && /^\d+$/.test(b) && a.replace(/^0+/, '') === b.replace(/^0+/, '');
  const its = D().items;
  const it = its.find(i => normCode(i.code) === low) || its.find(i => i.assetNo && normCode(i.assetNo) === low) || its.find(i => i.id === code) ||
    its.find(i => digitsEq(normCode(i.code), low) || (i.assetNo && digitsEq(normCode(i.assetNo), low)));
  if (it){ openDetail(it.id); return; }
  if (isAdmin() && !S.offline){ toast(t('ไม่พบรหัส {c} เพิ่มเป็นอุปกรณ์ใหม่ได้เลย', {c: code})); openItem(null, {code}); }
  else toast(t('ไม่พบอุปกรณ์รหัส {c}', {c: code}), 'bad');
}

/* ---------- events ---------- */
function bind(){
  $$('.nb[data-tab]').forEach(n => n.addEventListener('click', () => setTab(n.dataset.tab)));
  $('#btnRefresh').addEventListener('click', () => refresh(false));
  $('#btnAccount').addEventListener('click', openAccount);
  $('#btnBell').addEventListener('click', openNotifs);
  $('#qItems').addEventListener('input', e => { S.qItems = e.target.value; renderItems(); });
  $('#qLoans').addEventListener('input', e => { S.qLoans = e.target.value; renderLoans(); });
  $('#qHist').addEventListener('input', e => { S.qHist = e.target.value; renderHistory(); });
  $('#onlyFree').addEventListener('change', e => { S.onlyFree = e.target.checked; renderItems(); });
  $('#fLogin').addEventListener('submit', submitLogin);
  $('#fRegister').addEventListener('submit', submitRegister);
  $('#fReset1').addEventListener('submit', submitReset1);
  $('#fReset2').addEventListener('submit', submitReset2);
  $('#btnPendingBack').addEventListener('click', () => { S.pending = false; S.authMode = 'login'; render(); });
  $('#fBorrow').addEventListener('submit', submitBorrow);
  $('#fReturn').addEventListener('submit', submitReturn);
  $('#fReview').addEventListener('submit', submitReview);
  $$('input[name=vResult],input[name=vDecision]').forEach(r => r.addEventListener('change', () => { updateReviewForm(); showErr($('#vErr'), ''); }));
  $$('input[name=bKind]').forEach(r => r.addEventListener('change', updateBorrowKind));
  $('#bAccept').addEventListener('change', () => showErr($('#bErr'), ''));
  $('#btnGps').addEventListener('click', useGps);
  $('#bUseAt').addEventListener('input', updateMapLink);
  $('#fItem').addEventListener('submit', submitItem);
  $('#fCat').addEventListener('submit', submitCat);
  $('#fProfile').addEventListener('submit', submitProfile);
  $('#fPw').addEventListener('submit', submitPw);
  $('#fScore').addEventListener('submit', submitScore);
  $('#fPolicy').addEventListener('submit', submitPolicy);
  $('#btnPolicyEdit').addEventListener('click', openPolicyEdit);
  $('#btnPolEdit').addEventListener('click', openPolicyEdit);
  $('#btnLogout').addEventListener('click', () => logout(false));
  $('#btnLogoutAll').addEventListener('click', logoutAll);
  $('#btnCopyTemp').addEventListener('click', async () => {
    const s = $('#tPw').textContent;
    try { await navigator.clipboard.writeText(s); toast(t('คัดลอกแล้ว'), 'ok'); }
    catch (e){ const r = document.createRange(); r.selectNodeContents($('#tPw')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast(t('เลือกข้อความไว้แล้ว กดคัดลอกได้เลย')); }
  });
  $('#fSettings').addEventListener('submit', async e => { e.preventDefault(); if (await connect($('#sUrl').value, $('#sErr'), $('#sSubmit'))) closeDlg($('#dlgSettings')); });
  $('#btnSetup').addEventListener('click', () => connect($('#setupUrl').value, $('#setupErr'), $('#btnSetup')));
  $('#setupUrl').addEventListener('keydown', e => { if (e.key === 'Enter') connect($('#setupUrl').value, $('#setupErr'), $('#btnSetup')); });
  $('#bForOther').addEventListener('change', e => { $('#bOther').hidden = !e.target.checked; if (e.target.checked) setTimeout(() => $('#bName').focus(), 30); showErr($('#bErr'), ''); });
  $('#bDays').addEventListener('input', () => updateBorrowPreview(true));
  $('#bName').addEventListener('input', () => showErr($('#bErr'), ''));
  // item form
  $('#iCat').addEventListener('change', () => { if (I && !I.id && !I.prefixTouched) $('#iPrefix').value = catPrefix($('#iCat').value); updateCodePreview(); });
  $('#iPrefix').addEventListener('input', () => { if (I) I.prefixTouched = true; updateCodePreview(); });
  $('#iCode').addEventListener('input', updateCodePreview);
  $$('input[name=iOwn]').forEach(r => r.addEventListener('change', updateOwnUi));
  $('#iOwnerUser').addEventListener('change', e => {
    const u = (D().users || []).find(x => x.email === e.target.value);
    if (u) $('#iOwner').value = u.name;
  });
  $('#btnICam').addEventListener('click', async () => setItemShot(await takePhoto({title: t('ถ่ายรูปอุปกรณ์'), facing: 'environment', hint: t('ถ่ายให้เห็นอุปกรณ์ทั้งชิ้น บนพื้นเรียบ แสงสว่าง')})));
  $('#iFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { setItemShot(await processFile(f)); } catch (err){ toast(err.message || t('เปิดรูปนี้ไม่ได้ ลองรูปอื่น'), 'bad'); }
    e.target.value = '';
  });
  $('#btnIRemove').addEventListener('click', () => { if (!I) return; I.full = I.thumb = ''; I.img = I.imageId ? 'remove' : 'keep'; renderItemImage(); });
  // camera
  $('#btnShutter').addEventListener('click', snap);
  $('#btnFlip').addEventListener('click', () => { CAM.facing = CAM.facing === 'user' ? 'environment' : 'user'; startCam(); });
  $('#btnRetake').addEventListener('click', () => { CAM.shot = null; camLiveMode(); startCam(); });
  $('#btnUseShot').addEventListener('click', () => finishCam(CAM.shot));
  $('#btnCamDone').addEventListener('click', () => finishCam(CAM.shots.slice()));
  $('#btnCamClose').addEventListener('click', () => finishCam(null));
  $('#dlgCam').addEventListener('cancel', e => { e.preventDefault(); finishCam(null); });
  // photo viewer
  $('#phPrev').addEventListener('click', () => galStep(-1));
  $('#phNext').addEventListener('click', () => galStep(1));
  $('#dlgPhoto').addEventListener('keydown', e => { if (e.key === 'ArrowLeft') galStep(-1); else if (e.key === 'ArrowRight') galStep(1); });
  let tx = null;
  $('#dlgPhoto').addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, {passive: true});
  $('#dlgPhoto').addEventListener('touchend', e => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 50) galStep(dx < 0 ? 1 : -1); }, {passive: true});
  // labels + scanner
  $('#btnLabels').addEventListener('click', openLabels);
  $('#lCat').addEventListener('change', renderLabels);
  $('#btnPrint').addEventListener('click', printLabels);
  $('#btnScanCode').addEventListener('click', () => openScanner('assign'));
  $('#btnScanClose').addEventListener('click', closeScanner);
  $('#dlgScan').addEventListener('cancel', e => { e.preventDefault(); closeScanner(); });
  $('#scanFile').addEventListener('change', e => scanPhoto(e.target.files && e.target.files[0]));
  $('#fManual').addEventListener('submit', e => { e.preventDefault(); const v = $('#manualCode').value.trim(); if (v) onScanned(v); });
  $('#btnInstall').addEventListener('click', async () => { if (!S.installEvt) return; S.installEvt.prompt(); try { await S.installEvt.userChoice; } catch (e){} S.installEvt = null; render(); });
  $$('dialog.sheet').forEach(d => d.addEventListener('click', e => { if (e.target === d) closeDlg(d); }));

  document.addEventListener('click', e => {
    const el = e.target.closest('button,a,[data-photo],[data-local]'); if (!el) return;
    const ds = el.dataset;
    if ('langToggle' in ds){ setLang(isEn() ? 'th' : 'en', true); return; }
    if (ds.setLang){ setLang(ds.setLang, true); return; }
    if ('close' in ds){ closeDlg(el.closest('dialog')); return; }
    if (ds.camDel != null){ camDelete(+ds.camDel); return; }
    if (ds.shoot){ if (ds.shoot === 'b') shootBorrow(); else shootReturn(); return; }
    if (ds.rmShot){ const box = ds.rmShot === 'b' ? B : R; if (box){ box.shots.splice(+ds.ri, 1); if (ds.rmShot === 'b') renderBorrowPhotos(); else renderReturnPhotos(); } return; }
    if (ds.local){ const box = ds.local === 'b' ? B : R; if (box && box.shots.length) openGallery(box.shots.map((_, k) => k), +ds.li, t('รูปที่ถ่าย (ยังไม่ได้ส่ง)'), box.shots.map(s => s.full)); return; }
    if (ds.gal){ openGallery(ds.gal.split(','), +ds.gi || 0, ds.cap); return; }
    if (ds.photo){ openGallery([ds.photo], 0, ds.cap); return; }
    if (ds.auth){ S.authMode = ds.auth; ['lErr','regErr','f1Err','f2Err','gErr'].forEach(id => showErr($('#' + id), '')); if (ds.auth === 'reset1') $('#f1Email').value = $('#lEmail').value; render(); return; }
    if (ds.eye){ const inp = document.getElementById(ds.eye); const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; el.dataset.th = show ? 'ซ่อน' : 'แสดง'; el.textContent = t(el.dataset.th); return; }
    if ('scan' in ds){ if (!S.token) return; openScanner('lookup'); return; }
    if (ds.step){
      const inp = document.getElementById(ds.for);
      const lo = inp.min !== '' ? +inp.min : 1, hi = inp.max !== '' ? +inp.max : 9999, cur = parseInt(inp.value, 10);
      inp.value = clamp((isNaN(cur) ? lo : cur) + (+ds.step), lo, hi);
      if (ds.for === 'bDays') updateBorrowPreview(true);
      return;
    }
    if (ds.sc){ $('#scDelta').value = ds.sc; return; }
    if (ds.days){ $('#bDays').value = ds.days; updateBorrowPreview(true); return; }
    if (ds.icon){ $('#cIcon').value = ds.icon; return; }
    if (ds.cat){ S.cat = ds.cat; renderItems(); return; }
    if (ds.own){ S.own = ds.own; renderItems(); return; }
    if (ds.loanf){ S.loanFilter = ds.loanf; renderLoans(); return; }
    if ('gotoOverdue' in ds){ S.loanFilter = 'overdue'; setTab('loans'); return; }
    if ('gotoMine' in ds){ S.loanFilter = 'all'; setTab('loans'); return; }
    if ('gotoReview' in ds){ const rc = reviewCounts(); S.loanFilter = rc.review ? 'review' : 'pending'; setTab('loans'); return; }
    if (ds.goto){ setTab(ds.goto); return; }
    if ('refresh' in ds){ refresh(false); return; }
    if ('openSettings' in ds){ openSettings(); return; }
    if ('openAccount' in ds){ openAccount(); return; }
    if ('openPolicy' in ds){ openPolicy(); return; }
    if (ds.detail){ openDetail(ds.detail); return; }
    if (ds.borrow){ openBorrow(ds.borrow); return; }
    if (ds.return){ openReturn(ds.return); return; }
    if (ds.review){ openReview(ds.review); return; }
    if ('addItem' in ds){ openItem(null); return; }
    if ('addCat' in ds){ openCat(null); return; }
    if (ds.editItem){ openItem(ds.editItem); return; }
    if (ds.editCat){ openCat(ds.editCat); return; }
    if (ds.scoreUser){ openScore(ds.scoreUser); return; }
    if (ds.uset){ const patch = {}; if (ds.role) patch.role = ds.role; if (ds.status) patch.status = ds.status; setUser(ds.uset, patch, el); return; }
    if (ds.ureset){ resetUserPw(ds.ureset, el); return; }
    if (ds.askDel){ S.confirm = ds.askDel; render(); if ($('#dlgDetail').open) fillDetail(); return; }
    if ('cancelDel' in ds){ S.confirm = null; render(); if ($('#dlgDetail').open) fillDetail(); return; }
    if (ds.doDel){ doDelete(ds.doDel); return; }
  });

  window.addEventListener('online', () => { S.offline = false; refresh(true); });
  window.addEventListener('offline', () => { S.offline = true; render(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - S.lastSync > 15000) refresh(true); });
  setInterval(() => { if (document.visibilityState === 'visible' && !$$('dialog[open]').length) refresh(true); }, 45000);
  setInterval(() => { if (!$$('dialog[open]').length) renderHeader(); }, 60000);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; if (S.tab === 'manage') render(); });
}

/* ---------- start ---------- */
async function boot(){
  const params = new URLSearchParams(location.search);
  const fromUrl = normApi(params.get('api'));
  if (fromUrl && validApi(fromUrl)){ LS.set('api', fromUrl); params.delete('api'); history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash); }
  const ql = params.get('lang');
  if (ql === 'en' || ql === 'th'){ LANG = ql; LS.set('lang', ql); }
  const cfgUrl = normApi(window.LEND_CONFIG && window.LEND_CONFIG.API_URL);
  S.api = normApi(LS.get('api', '')) || (validApi(cfgUrl) ? cfgUrl : '');
  S.token = LS.get('token', '');
  S.info = LS.get('info', null);
  const h = location.hash.slice(1), saved = LS.get('tab', 'items');
  S.tab = ['items','loans','history','manage'].includes(h) ? h : (['items','loans','history','manage'].includes(saved) ? saved : 'items');
  const cache = LS.get('cache', null);
  if (S.token && cache && cache.api === S.api && cache.data){ S.data = cache.data; S.me = cache.me || null; S.lastSync = cache.at || 0; }
  applyStatic(); bind(); render();
  if (S.api){
    loadInfo().then(() => { if (!S.token) render(); else renderHeader(); });
    if (S.token) refresh(!!S.data);
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
})();
