'use strict';
/* אם משהו קורס בטעינה, מציגים את השגיאה על המסך במקום להשאיר אפליקציה "תקועה" */
window.addEventListener('error', e => {
  if (window.__shownErr) return; window.__shownErr = true;
  try { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:10px;margin:0;color:#c0392b;background:#fff;font:14px sans-serif">שגיאה: ' + String(e.message).replace(/</g, '&lt;') + '</p>'); } catch (_) { /* ignore */ }
});
/* ============ הגדרות ============ */
const APP_VERSION = '1.4.2';
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
/* ב-WebView של Capacitor ללא bundler אין registerPlugin; קוראים לתוסף דרך nativePromise */
const Native = NATIVE ? {
  saveFile: o => window.Capacitor.nativePromise('FormsFiles', 'saveFile', o),
  sendEmail: o => window.Capacitor.nativePromise('FormsFiles', 'sendEmail', o),
} : null;
const ZIP_CHUNK = NATIVE ? 25 : 60; // כמה PDF בכל קובץ ZIP
const MAIL_CHUNK = 20; // כמה קבצים מצורפים בכל מייל
const QFIELDS = [
  { key: 'electric', label: 'רישום שעון חשמל', mode: 'decimal' },
  { key: 'water', label: 'רישום מונה המים', mode: 'decimal' },
  { key: 'keysFront', label: 'מספר מפתחות קיימים לדלת קדמית', mode: 'numeric' },
  { key: 'keysBack', label: 'מספר מפתחות קיימים לדלת אחורית', mode: 'numeric' },
  { key: 'acSigns', label: 'מספר שלטי מזגנים שהוחזרו', mode: 'numeric' },
];
/* הגדרת ברירת מחדל גנרית. הנוסח, הלוגו ושמות החותמים האמיתיים נטענים מקובץ הגדרות נפרד (לא נשמר בקוד) */
const DEFAULT_CONFIG = {
  appTitle: 'טפסי חתימה בשטח',
  folder: 'FieldForms', /* שם התיקייה ב-Documents באנדרואיד */
  docTitle: 'טופס השבת מבנה',
  intro: '',
  items: [],
  formHeading: '',
  paragraphs: [
    'אנו מצהירים כי במבנה {id} בישוב {site} של קהילת {community} נבדק ונמסר.',
    'רישום שעון חשמל: {electric} רישום מונה המים: {water}',
    'מספר מפתחות קיימים לדלת קדמית: {keysFront}. מספר מפתחות קיימים לדלת אחורית: {keysBack} .',
    'מספר שלטי מזגנים שהוחזרו: {acSigns} .',
    'הערות: {notes}',
  ],
  signers: [{ key: 's1', label: 'נציג א' }, { key: 's2', label: 'נציג ב' }, { key: 's3', label: 'נציג ג' }],
  logo: '',
};
let CFG_CUSTOM = false, CFG = DEFAULT_CONFIG, SIGNERS = [], COLS_CORE = [], HEAD_ALIASES = {};
/* העמודות בייבוא/ייצוא. אפשר לשנות כאן שמות ושדות לפי לוח ה-Monday */
function applyConfig(cfg) {
  CFG_CUSTOM = !!cfg;
  CFG = { ...DEFAULT_CONFIG, ...(cfg || {}) };
  SIGNERS = CFG.signers;
  COLS_CORE = [
    ['מספר מבנה', r => r.num],
    ['שם אתר', r => r.site],
    ['קהילה', r => r.community],
    ...SIGNERS.flatMap(s => [
      ['שם ' + s.label, r => (r.signers[s.key] || {}).name || ''],
      ['חתימת ' + s.label, r => ((r.signers[s.key] || {}).sig ? 'נחתם' : '')],
    ]),
    ...QFIELDS.map(f => [f.label, r => r.fields[f.key]]),
    ['הערות', r => r.fields.notes],
  ];
  HEAD_ALIASES = buildAliases();
  document.title = CFG.appTitle;
}
const COLS_TAIL = [
  ['סטטוס', r => statusLabel(r)],
  ['תאריך חתימה', r => (r.signedAt ? fmtDate(r.signedAt) : '')],
  ['נשלח במייל', r => (r.emailedAt ? fmtDate(r.emailedAt) : '')],
  ['קובץ PDF', r => r.pdfName || ''],
];

/* ============ עזרים ============ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = h => String(h ?? '').replace(/[^א-תa-zA-Z0-9]/g, '');
const pad2 = n => String(n).padStart(2, '0');
function fmtDay(iso) {
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
const safeName = s => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
const blobToB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
const folderName = () => CFG.folder || 'FieldForms';
async function nativeSave(blob, name, sub = '') {
  return Native.saveFile({ folder: folderName() + (sub ? '/' + sub : ''), name, mime: blob.type || 'application/octet-stream', data: await blobToB64(blob) });
}
/* באנדרואיד: שומר לתיקיית Documents/<folder>/Exports. בדפדפן: הורדה רגילה */
function download(blob, name, sub = 'Exports') {
  if (NATIVE) {
    return nativeSave(blob, name, sub).then(r => toast('נשמר ב-' + r.path, 5000)).catch(e => toast('שגיאה בשמירה: ' + (e.message || e), 6000));
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
function modal(html) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="sheet">${html}</div>`;
  $('#modal-root').appendChild(wrap);
  return { el: wrap.firstChild, close: () => wrap.remove() };
}
function ask(msg, buttons) {
  return new Promise(res => {
    const m = modal(`<p class="msg">${esc(msg)}</p><div class="row">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.t)}</button>`).join('')}</div>`);
    m.el.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (b) { m.close(); res(buttons[+b.dataset.i].v); }
    });
  });
}
const natCmp = (a, b) => String(a).localeCompare(String(b), 'he', { numeric: true });

/* ============ מסד נתונים (IndexedDB) ============ */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('field-forms', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('buildings')) d.createObjectStore('buildings', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  run(mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction('buildings', mode);
      const s = t.objectStore('buildings');
      let out; const rq = fn(s);
      if (rq && 'onsuccess' in rq) rq.onsuccess = () => { out = rq.result; };
      t.oncomplete = () => res(out);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  all() { return this.run('readonly', s => s.getAll()); },
  put(rec) { return this.run('readwrite', s => s.put(rec)); },
  del(id) { return this.run('readwrite', s => s.delete(id)); },
  putMany(recs) { return this.run('readwrite', s => { recs.forEach(r => s.put(r)); }); },
  clear() { return this.run('readwrite', s => s.clear()); },
  getMeta(k) { return new Promise((res, rej) => { const q = this.db.transaction('meta', 'readonly').objectStore('meta').get(k); q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error); }); },
  setMeta(k, v) { return new Promise((res, rej) => { const t = this.db.transaction('meta', 'readwrite'); t.objectStore('meta').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  getCfg() { return new Promise((res, rej) => { const q = this.db.transaction('meta', 'readonly').objectStore('meta').get('config'); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); },
  setCfg(cfg) { return new Promise((res, rej) => { const t = this.db.transaction('meta', 'readwrite'); cfg ? t.objectStore('meta').put(cfg, 'config') : t.objectStore('meta').delete('config'); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
};

/* ============ מודל נתונים ============ */
const S = { map: new Map(), recipients: [], filter: { q: '', site: '', st: 'all' }, cur: null };
/* מזהה ייחודי = מספר מבנה + שם אתר (מספר מבנה לבדו אינו ייחודי) */
const cleanTxt = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const mkKey = (num, site) => `${num}|${site}`;
function blankRec(num, site = '') {
  return {
    id: mkKey(num, site), num: String(num), site, community: '',
    fields: { electric: '', water: '', keysFront: '', keysBack: '', acSigns: '', notes: '' },
    signers: Object.fromEntries(SIGNERS.map(s => [s.key, { name: '', sig: '' }])),
    extra: {}, pdf: null, pdfName: '', signedAt: '', exportedAt: '', updatedAt: Date.now(),
  };
}
function fillSigners(r) { SIGNERS.forEach(s => { if (!r.signers[s.key]) r.signers[s.key] = { name: '', sig: '' }; }); }
const isSigned = r => !!r.signedAt && !!r.pdf;
function hasData(r) {
  return Object.values(r.fields).some(v => v) || SIGNERS.some(s => r.signers[s.key].sig);
}
const statusKey = r => (isSigned(r) ? 'signed' : hasData(r) ? 'draft' : 'new');
const statusLabel = r => ({ signed: 'נחתם', draft: 'טיוטה', new: 'ממתין' }[statusKey(r)]);
const sortedRecs = () => [...S.map.values()].sort((a, b) => natCmp(a.site, b.site) || natCmp(a.num, b.num));

let saveTimer;
function scheduleSave(rec) {
  rec.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => DB.put(rec).catch(() => toast('שגיאה בשמירה במכשיר')), 350);
}
async function saveNow(rec) { clearTimeout(saveTimer); rec.updatedAt = Date.now(); await DB.put(rec); }

/* ============ ייבוא ============ */
function buildAliases() {
  const m = {};
  const add = (key, list) => list.forEach(x => (m[norm(x)] = key));
  add('num', ['מספר מבנה', 'מבנה', 'מס מבנה']);
  add('site', ['שם אתר', 'אתר', 'ישוב', 'שם ישוב', 'שם היישוב']);
  add('community', ['קהילה', 'שם קהילה', 'שם הקהילה']);
  SIGNERS.forEach(sg => {
    add('name:' + sg.key, ['שם ' + sg.label, sg.label]);
    add('sigcol', ['חתימת ' + sg.label, 'חתימה ' + sg.label]);
  });
  add('sigcol', ['סטטוס', 'תאריך חתימה', 'קובץ PDF', 'מזהה מבנה', 'נשלח במייל']);
  add('f:electric', ['רישום שעון חשמל', 'שעון חשמל']);
  add('f:water', ['רישום מונה המים', 'רישום מונה מים', 'מונה מים', 'מונה המים']);
  add('f:keysFront', ['מספר מפתחות קיימים לדלת קדמית', 'מפתחות דלת קדמית', 'מפתחות קדמית']);
  add('f:keysBack', ['מספר מפתחות קיימים לדלת אחורית', 'מפתחות דלת אחורית', 'מפתחות אחורית']);
  add('f:acSigns', ['מספר שלטי מזגנים שהוחזרו', 'שלטי מזגנים שהוחזרו', 'שלטי מזגנים']);
  add('f:notes', ['הערות', 'הערה']);
  return m;
}

function workbookSheets(buf, name) {
  let wb;
  if (/\.csv$/i.test(name)) {
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    wb = XLSX.read(text, { type: 'string', raw: true });
  } else {
    wb = XLSX.read(buf, { type: 'array' });
  }
  return wb.SheetNames.map(n => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false, blankrows: false }) }));
}

/* נמענים: עמודות אתר / תפקיד / אימייל (אתר ריק = מקבל את כל האתרים) */
const RC_ALIASES = (() => {
  const m = {};
  const add = (k, l) => l.forEach(x => (m[norm(x)] = k));
  add('site', ['אתר', 'שם אתר', 'ישוב', 'site']);
  add('role', ['תפקיד', 'role']);
  add('email', ['אימייל', 'אי מייל', 'מייל', 'דואל', 'כתובת מייל', 'כתובת אימייל', 'email', 'e-mail', 'mail']);
  add('name', ['שם', 'שם הנמען', 'שם איש קשר', 'name']);
  return m;
})();
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const rcKey = r => norm(r.site) + '|' + r.email.toLowerCase();
function findHeader(rows, kind) {
  const hi = rows.findIndex((r, i) => i < 8 && r.some(c => (kind === 'num' ? HEAD_ALIASES[norm(c)] : RC_ALIASES[norm(c)]) === kind));
  return hi;
}
function sheetKind(rows) {
  if (findHeader(rows, 'num') >= 0) return 'buildings';
  if (findHeader(rows, 'email') >= 0) return 'recipients';
  return '';
}

async function importRecipients(rows) {
  const hi = findHeader(rows, 'email');
  const map = rows[hi].map(c => RC_ALIASES[norm(c)] || '');
  const have = new Map(S.recipients.map(r => [rcKey(r), r]));
  let added = 0, updated = 0, bad = 0;
  for (const row of rows.slice(hi + 1)) {
    const get = k => { const i = map.indexOf(k); return i < 0 ? '' : cleanTxt(row[i]); };
    const emails = get('email').split(/[;,\s]+/).filter(Boolean);
    if (!emails.length) continue;
    for (const email of emails) {
      if (!EMAIL_RE.test(email)) { bad++; continue; }
      const rec = { site: get('site'), role: get('role'), name: get('name'), email };
      const k = rcKey(rec);
      if (have.has(k)) { Object.assign(have.get(k), rec); updated++; } else { have.set(k, rec); S.recipients.push(rec); added++; }
    }
  }
  await DB.setMeta('recipients', S.recipients);
  return `נמענים: נוספו ${added}, עודכנו ${updated}` + (bad ? `\nכתובות לא תקינות (דולגו): ${bad}` : '');
}

async function importBuildings(rows) {
  const hi = findHeader(rows, 'num');
  const heads = rows[hi].map(c => String(c).trim());
  const map = heads.map(h => HEAD_ALIASES[norm(h)] || (h ? 'extra:' + h : ''));
  const stat = { added: 0, updated: 0, skipped: 0, nokey: 0, dup: 0 };
  const touched = [], seen = new Map();
  for (const row of rows.slice(hi + 1)) {
    const get = key => { const i = map.indexOf(key); return i < 0 ? '' : cleanTxt(row[i]); };
    const num = get('num'), site = get('site'), comm = get('community');
    if (!num) { if (row.some(c => cleanTxt(c))) stat.nokey++; continue; }
    const key = mkKey(num, site);
    let rec = seen.get(key) || S.map.get(key);
    const isNew = !rec;
    if (rec && isSigned(rec)) { stat.skipped++; continue; }
    if (!rec) rec = blankRec(num, site);
    fillSigners(rec);
    if (comm) rec.community = comm;
    SIGNERS.forEach(s => { const v = get('name:' + s.key); if (v) rec.signers[s.key].name = v; });
    QFIELDS.concat([{ key: 'notes' }]).forEach(f => { const v = get('f:' + f.key); if (v && !rec.fields[f.key]) rec.fields[f.key] = v; });
    map.forEach((k, i) => { if (k.startsWith('extra:')) { const v = cleanTxt(row[i]); if (v) rec.extra[k.slice(6)] = v; } });
    rec.updatedAt = Date.now();
    if (seen.has(key)) { stat.dup++; continue; }
    seen.set(key, rec); touched.push(rec); isNew ? stat.added++ : stat.updated++;
  }
  await DB.putMany(touched);
  touched.forEach(r => S.map.set(r.id, r));
  return `נוספו ${stat.added} מבנים, עודכנו ${stat.updated}` +
    (stat.skipped ? `\nדולגו ${stat.skipped} מבנים שכבר נחתמו` : '') +
    (stat.dup ? `\nשורות כפולות (אותו מספר מבנה + אתר) אוחדו: ${stat.dup}` : '') +
    (stat.nokey ? `\nשורות ללא מספר מבנה (לא יובאו): ${stat.nokey}` : '');
}

async function importFile(file) {
  const buf = await file.arrayBuffer();
  if (/\.json$/i.test(file.name)) return importBackup(buf);
  const msgs = [];
  for (const sh of workbookSheets(buf, file.name)) {
    const kind = sheetKind(sh.rows);
    if (kind === 'buildings') msgs.push(await importBuildings(sh.rows));
    else if (kind === 'recipients') msgs.push(await importRecipients(sh.rows));
  }
  if (!msgs.length) throw new Error('לא נמצאה עמודה "מספר מבנה" (מבנים) או "אימייל" (נמענים) בקובץ');
  return msgs.join('\n');
}

/* ============ ייצוא ============ */
function extraKeys(recs) { const k = new Set(); recs.forEach(r => Object.keys(r.extra || {}).forEach(x => k.add(x))); return [...k]; }
function csvCell(v) { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function buildCsv(recs) {
  const ex = extraKeys(recs);
  const head = ['מזהה מבנה', ...COLS_CORE.map(c => c[0]), ...ex, ...COLS_TAIL.map(c => c[0])];
  const lines = [head.map(csvCell).join(',')];
  recs.forEach(r => lines.push([r.site ? `${r.num} - ${r.site}` : r.num, ...COLS_CORE.map(c => c[1](r)), ...ex.map(k => (r.extra || {})[k] || ''), ...COLS_TAIL.map(c => c[1](r))].map(csvCell).join(',')));
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}
function pdfFileName(r) {
  return safeName(`מבנה ${r.num}${r.site ? ' - ' + r.site : ''}`) + '.pdf';
}

/* ============ יצירת המסמך / PDF ============ */
function field(v, cls = '') { return `<span class="f ${cls}">${esc(v) || '&nbsp;'}</span>`; }
function docHtml(r, iso) {
  const f = r.fields;
  const when = iso || r.signedAt || new Date().toISOString();
  const tok = {
    id: field(r.num), site: field(r.site, 'w'), community: field(r.community, 'w'),
    electric: field(f.electric, 'w'), water: field(f.water, 'w'),
    keysFront: field(f.keysFront, 's'), keysBack: field(f.keysBack, 's'), acSigns: field(f.acSigns, 's'),
  };
  const para = t => {
    if (t.includes('{notes}')) {
      const [pre, post] = t.split('{notes}');
      return `<div class="line nt"><span>${esc(pre)}</span><span class="notes">${esc(f.notes)}</span>${post.trim() ? `<span>${esc(post)}</span>` : ''}</div>`;
    }
    return `<p class="line">${esc(t).replace(/\{(\w+)\}/g, (m, k) => tok[k] ?? m)}</p>`;
  };
  return `<div id="doc">
    ${CFG.logo ? `<img class="logo" src="${CFG.logo}" alt="">` : ''}
    <h2>${esc(CFG.docTitle)}</h2>
    ${CFG.intro ? `<p>${esc(CFG.intro)}</p>` : ''}
    ${CFG.items.map((t, i) => `<div class="li">${i + 1}. ${esc(t)}</div>`).join('')}
    ${CFG.formHeading ? `<div class="sub">${esc(CFG.formHeading)}</div>` : ''}
    ${CFG.paragraphs.map(para).join('')}
    <p class="line datel">תאריך: ${field(fmtDay(when), 'w')}</p>
    <div class="sigs">${SIGNERS.map(s => { const g = r.signers[s.key] || { name: '', sig: '' }; return `<div class="sg"><div class="box">${g.sig ? `<img src="${g.sig}" alt="">` : ''}</div><div class="role">${esc(s.label)}</div><div class="nm">${esc(g.name)}</div></div>`; }).join('')}</div>
  </div>`;
}
async function renderDocCanvas(rec, iso) {
  await Promise.all([document.fonts.load('400 15px Heebo', 'אבג abc'), document.fonts.load('700 15px Heebo', 'אבג abc')]);
  const st = $('#doc-stage');
  st.innerHTML = docHtml(rec, iso);
  await Promise.all([...st.querySelectorAll('img')].map(i => (i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; }))));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cv = await html2canvas(st.firstElementChild, { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true, scrollX: 0, scrollY: 0, windowWidth: 794 });
  st.innerHTML = '';
  return cv;
}
function canvasToPdf(cv, title) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title });
  pdf.addImage(cv.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  return pdf.output('blob');
}
async function ensurePdf(rec) {
  if (rec.pdf) return rec.pdf;
  const cv = await renderDocCanvas(rec, rec.signedAt);
  rec.pdfName = pdfFileName(rec);
  rec.pdf = canvasToPdf(cv, rec.pdfName);
  await saveNow(rec);
  return rec.pdf;
}

/* ============ משטח חתימה ============ */
function makePad(cv) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = ctx.fillStyle = '#0b1a4a'; ctx.lineWidth = 2.8;
  let drawing = false, last = null, prevMid = null, box = null;
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const grow = p => { box = box ? { x0: Math.min(box.x0, p.x), y0: Math.min(box.y0, p.y), x1: Math.max(box.x1, p.x), y1: Math.max(box.y1, p.y) } : { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; };
  cv.addEventListener('pointerdown', e => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId); drawing = true;
    last = prevMid = pt(e); grow(last);
    ctx.beginPath(); ctx.arc(last.x, last.y, 1.4, 0, 7); ctx.fill();
  });
  cv.addEventListener('pointermove', e => {
    if (!drawing) return; e.preventDefault();
    const p = pt(e), mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    ctx.beginPath(); ctx.moveTo(prevMid.x, prevMid.y); ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y); ctx.stroke();
    prevMid = mid; last = p; grow(p);
  });
  const end = () => { drawing = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  return {
    clear() { ctx.clearRect(0, 0, W, H); box = null; },
    isEmpty: () => !box,
    png() {
      if (!box) return '';
      const m = 8, x = Math.max(0, box.x0 - m), y = Math.max(0, box.y0 - m);
      const w = Math.min(W, box.x1 + m) - x, h = Math.min(H, box.y1 + m) - y;
      const out = document.createElement('canvas'); out.width = Math.max(1, w * dpr); out.height = Math.max(1, h * dpr);
      out.getContext('2d').drawImage(cv, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
  };
}
function signModal(title) {
  return new Promise(res => {
    const m = modal(`<h3>${esc(title)}</h3><div class="padwrap"><canvas class="pad"></canvas><div class="padline">חתום כאן</div></div>
      <div class="row"><button class="btn" data-a="clear">נקה</button><button class="btn" data-a="cancel">ביטול</button><button class="btn primary" data-a="ok">אישור</button></div>`);
    const pad = makePad(m.el.querySelector('canvas'));
    m.el.addEventListener('click', e => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'clear') pad.clear();
      else if (a === 'cancel') { m.close(); res(null); }
      else if (a === 'ok') {
        if (pad.isEmpty()) return toast('לא נחתם עדיין');
        const png = pad.png(); m.close(); res(png);
      }
    });
  });
}

/* ============ תצוגות ============ */
function show(view) {
  ['list', 'form', 'export'].forEach(v => ($('#v-' + v).hidden = v !== view));
  $('#backBtn').hidden = view !== 'form';
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === (view === 'export' ? 'export' : 'list')));
  if (view !== 'form') $('#title').textContent = view === 'export' ? 'ייבוא / ייצוא' : CFG.appTitle;
  window.scrollTo(0, 0);
}
function route() {
  const h = decodeURIComponent(location.hash || '#/');
  let m;
  if ((m = h.match(/^#\/b\/(.+)$/)) && S.map.has(m[1])) { renderForm(S.map.get(m[1])); show('form'); }
  else if (h === '#/x') { renderExport(); show('export'); }
  else { renderList(); show('list'); }
}

function renderList() {
  const recs = sortedRecs();
  const sites = [...new Set(recs.map(r => r.site).filter(Boolean))].sort(natCmp);
  const sel = $('#siteSel');
  sel.innerHTML = '<option value="">כל האתרים</option>' + sites.map(s => `<option ${s === S.filter.site ? 'selected' : ''} value="${esc(s)}">${esc(s)}</option>`).join('');
  const total = recs.length, signed = recs.filter(isSigned).length;
  $('#stats').innerHTML = `<div><b>${total}</b><span>מבנים</span></div><div><b>${signed}</b><span>נחתמו</span></div><div><b>${total - signed}</b><span>ממתינים</span></div>`;
  const q = norm(S.filter.q);
  const list = recs.filter(r =>
    (!S.filter.site || r.site === S.filter.site) &&
    (S.filter.st === 'all' || (S.filter.st === 'signed') === isSigned(r)) &&
    (!q || norm(r.num + r.site + r.community).includes(q)));
  $('#list').innerHTML = list.map(r => {
    const k = statusKey(r);
    return `<a class="row-item" href="#/b/${encodeURIComponent(r.id)}"><div class="num">${esc(r.num)}</div><div class="meta"><b>${esc(r.site) || '—'}</b><span>${esc(r.community)}</span></div><span class="chip ${k}">${statusLabel(r)}</span></a>`;
  }).join('');
  $('#empty').hidden = total > 0;
}

function renderForm(rec) {
  S.cur = rec;
  $('#title').textContent = `מבנה ${rec.num}${rec.site ? ' · ' + rec.site : ''}`;
  const locked = isSigned(rec);
  const dis = locked ? 'disabled' : '';
  const root = $('#v-form');
  root.innerHTML = `
    ${locked ? `<div class="banner">✔ נחתם ב-${fmtDate(rec.signedAt)}${rec.filePath ? `<br><small>נשמר ב-${esc(rec.filePath)}</small>` : ''}</div>` : ''}
    <div class="card"><h2>פרטי המבנה</h2>
      <div class="grid2">
        <div class="fld"><label>מספר מבנה</label><input value="${esc(rec.num)}" disabled></div>
        <div class="fld"><label>ישוב / שם אתר</label><input value="${esc(rec.site)}" disabled></div>
      </div>
      <div class="fld"><label>קהילה</label><input data-k="community" value="${esc(rec.community)}" ${dis}></div>
    </div>
    <div class="card"><h2>נתוני הבדיקה</h2>
      <div class="grid2">${QFIELDS.map(f => `<div class="fld"><label>${esc(f.label)}</label><input data-f="${f.key}" inputmode="${f.mode}" value="${esc(rec.fields[f.key])}" ${dis}></div>`).join('')}</div>
      <div class="fld"><label>הערות</label><textarea data-f="notes" rows="3" ${dis}>${esc(rec.fields.notes)}</textarea></div>
    </div>
    <div class="card"><h2>חתימות</h2>
      ${SIGNERS.map(s => `<div class="sig"><h3>${esc(s.label)}</h3>
        <input data-n="${s.key}" placeholder="שם הנציג" value="${esc(rec.signers[s.key].name)}" ${dis}>
        <button class="sigbox ${rec.signers[s.key].sig ? 'has' : ''}" data-sig="${s.key}" ${dis}>${rec.signers[s.key].sig ? `<img src="${rec.signers[s.key].sig}" alt="חתימה">` : 'לחץ כאן לחתימה'}</button></div>`).join('')}
    </div>
    <div class="row col">
      ${locked
        ? `<button class="btn primary" data-act="dl">הורד PDF</button><button class="btn" data-act="share">שתף PDF</button><button class="btn danger" data-act="reopen">פתח לעריכה מחדש</button>`
        : `<button class="btn primary" data-act="finish">תצוגה מקדימה וסיום</button>`}
    </div>`;

  root.oninput = e => {
    const t = e.target;
    if (t.dataset.k) rec[t.dataset.k] = t.value;
    else if (t.dataset.f) rec.fields[t.dataset.f] = t.value;
    else if (t.dataset.n) rec.signers[t.dataset.n].name = t.value;
    else return;
    scheduleSave(rec);
  };
  root.onclick = async e => {
    const sg = e.target.closest('[data-sig]');
    if (sg) {
      const key = sg.dataset.sig, s = SIGNERS.find(x => x.key === key);
      const png = await signModal('חתימה – ' + s.label);
      if (png) { rec.signers[key].sig = png; await saveNow(rec); renderForm(rec); }
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'finish') finishFlow(rec);
    else if (act === 'dl') {
      if (NATIVE) savePdfToFolder(rec).then(r => toast('נשמר ב-' + r.path, 5000)).catch(e => toast('שגיאה בשמירה: ' + (e.message || e), 6000));
      else download(rec.pdf, rec.pdfName);
    }
    else if (act === 'share') shareFlow(rec);
    else if (act === 'reopen') {
      const ok = await ask('לפתוח את הטופס לעריכה? קובץ ה-PDF הקיים יימחק ויווצר מחדש בסיום.', [{ t: 'ביטול', v: false }, { t: 'פתח לעריכה', v: true, cls: 'danger' }]);
      if (ok) { rec.pdf = null; rec.signedAt = ''; rec.exportedAt = ''; await saveNow(rec); renderForm(rec); }
    }
  };
}

async function finishFlow(rec) {
  const missing = SIGNERS.filter(s => !rec.signers[s.key].sig).map(s => s.label);
  if (missing.length) {
    const go = await ask('חסרות חתימות: ' + missing.join(', ') + '.\nלהמשיך בכל זאת?', [{ t: 'חזרה', v: false }, { t: 'המשך בלי', v: true }]);
    if (!go) return;
  }
  const wait = modal('<p class="msg">מכין תצוגה מקדימה…</p>');
  const signIso = new Date().toISOString(); /* תאריך החתימה מתועד פעם אחת ומשמש גם לתצוגה וגם ל-PDF */
  let cv;
  try { cv = await renderDocCanvas(rec, signIso); } catch (err) { wait.close(); return toast('שגיאה ביצירת המסמך: ' + err.message, 5000); }
  wait.close();
  const m = modal(`<h3>תצוגה מקדימה</h3><img class="prev" src="${cv.toDataURL('image/jpeg', 0.7)}" alt="תצוגה מקדימה"><div class="row" style="margin-top:12px"><button class="btn" data-a="back">חזרה לעריכה</button><button class="btn primary" data-a="ok">אשר וצור PDF</button></div>`);
  m.el.addEventListener('click', async e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'back') m.close();
    else if (a === 'ok') {
      m.close();
      rec.pdfName = pdfFileName(rec);
      rec.pdf = canvasToPdf(cv, rec.pdfName);
      rec.signedAt = signIso;
      rec.exportedAt = '';
      await saveNow(rec);
      if (NATIVE) {
        try { const r = await savePdfToFolder(rec); toast('ה-PDF נשמר ב-' + r.path, 5000); }
        catch (e) { toast('ה-PDF נשמר באפליקציה, אך השמירה לתיקייה נכשלה: ' + (e.message || e), 7000); }
      } else toast('ה-PDF נשמר במכשיר');
      renderForm(rec);
    }
  });
}
async function savePdfToFolder(rec) {
  const r = await nativeSave(rec.pdf, rec.pdfName, '');
  rec.fileUri = r.uri; rec.filePath = r.path;
  await saveNow(rec);
  return r;
}
async function shareFlow(rec) {
  if (NATIVE) {
    try {
      const r = await savePdfToFolder(rec);
      await Native.sendEmail({ to: [], uris: [r.uri], subject: rec.pdfName, body: '', title: 'שיתוף PDF', type: 'application/pdf' });
    } catch (e) { toast('שגיאה: ' + (e.message || e), 5000); }
    return;
  }
  const file = new File([rec.pdf], rec.pdfName, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: rec.pdfName }); } catch (_) { /* בוטל */ }
  } else { download(rec.pdf, rec.pdfName); }
}

function renderExport() {
  const recs = sortedRecs(), signed = recs.filter(isSigned);
  $('#cfgState').textContent = !CFG_CUSTOM ? 'כרגע: ברירת מחדל גנרית (ללא לוגו)' : 'כרגע: ' + CFG.docTitle + (CFG.logo ? ' · עם לוגו' : '');
  $('#expStats').textContent = `${recs.length} מבנים · ${signed.length} חתומים · ${signed.filter(r => !r.exportedAt).length} טרם יוצאו`;
  renderRecipients(); renderMail();
  if (NATIVE) {
    $('#swState').textContent = '✔ אפליקציית אנדרואיד – עובדת ללא קליטה. גרסה ' + APP_VERSION + '. תיקיית שמירה: Documents/' + folderName();
    $('#persistState').textContent = ''; return;
  }
  $('#swState').textContent = ('serviceWorker' in navigator && navigator.serviceWorker.controller)
    ? '✔ האפליקציה שמורה במכשיר ועובדת גם בלי קליטה. גרסה ' + APP_VERSION
    : 'האפליקציה עדיין לא שמורה לעבודה אופליין – פתח אותה פעם אחת עם אינטרנט. גרסה ' + APP_VERSION;
  navigator.storage?.persisted?.().then(p => { $('#persistState').textContent = p ? 'אחסון קבוע: מופעל' : 'אחסון קבוע: לא הופעל (מומלץ לייצא גיבוי מדי פעם)'; });
}
function note(el, msg) { el.textContent = msg; el.hidden = false; }

/* ============ נמענים ושליחה במייל ============ */
function recipientsFor(site) {
  const seen = new Set(), out = [];
  S.recipients.filter(r => !r.site || norm(r.site) === norm(site)).forEach(r => {
    const k = r.email.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(r); }
  });
  return out;
}
function renderRecipients() {
  const el = $('#rcList');
  el.innerHTML = S.recipients.length
    ? S.recipients.map((r, i) => `<div class="rc"><div><b>${esc(r.email)}</b><span>${esc(r.site || 'כל האתרים')}${r.role ? ' · ' + esc(r.role) : ''}</span></div><button class="btn small" data-del="${i}" aria-label="מחק">✕</button></div>`).join('')
    : '<p class="hint">אין נמענים עדיין.</p>';
}
function unsentSigned() {
  const only = $('#onlyUnsent').checked;
  return sortedRecs().filter(r => isSigned(r) && (!only || !r.emailedAt));
}
function renderMail() {
  const bySite = new Map();
  unsentSigned().forEach(r => { const k = r.site || ''; (bySite.get(k) || bySite.set(k, []).get(k)).push(r); });
  $('#mailList').innerHTML = bySite.size ? [...bySite].map(([site, recs]) => {
    const rc = recipientsFor(site);
    return `<div class="mailrow"><div><b>${esc(site) || 'ללא אתר'}</b> · ${recs.length} קבצים<span class="${rc.length ? '' : 'warn'}">${rc.length ? 'אל: ' + esc(rc.map(r => r.email).join(', ')) : 'אין נמענים לאתר הזה – תבחר נמען במייל'}</span></div><button class="btn primary small" data-send="${esc(site)}">${NATIVE ? 'פתח מייל' : 'שלח'}</button></div>`;
  }).join('') : '<p class="hint">אין טפסים חתומים לשליחה.</p>';
}
async function sendSite(site) {
  const recs = unsentSigned().filter(r => (r.site || '') === site);
  if (!recs.length) return;
  const to = recipientsFor(site).map(r => r.email);
  const parts = Math.ceil(recs.length / MAIL_CHUNK), day = fmtDay(new Date().toISOString());
  const wait = modal('<p class="msg">מכין את הקבצים…</p>');
  try {
    for (let p = 0; p < parts; p++) {
      const chunk = recs.slice(p * MAIL_CHUNK, (p + 1) * MAIL_CHUNK);
      const subject = `${CFG.docTitle} - ${site || 'ללא אתר'} - ${day}` + (parts > 1 ? ` (${p + 1}/${parts})` : '');
      const body = `מצורפים ${chunk.length} טפסים חתומים:\n` + chunk.map(r => `• מבנה ${r.num}`).join('\n');
      if (NATIVE) {
        const uris = [];
        for (const r of chunk) { await ensurePdf(r); uris.push((await savePdfToFolder(r)).uri); }
        wait.close();
        await Native.sendEmail({ to, uris, subject, body, title: 'שליחת טפסים' });
      } else {
        wait.close();
        const zip = new JSZip();
        for (const r of chunk) zip.file(r.pdfName || pdfFileName(r), await ensurePdf(r));
        download(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), `forms-${today()}-${p + 1}.zip`);
        location.href = `mailto:${to.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n\n(צרף את קובץ ה-ZIP שהורד)')}`;
      }
      const ok = await ask(`האם שלחת את המייל (${p + 1}/${parts})?\nאם כן, נסמן את ${chunk.length} הטפסים כנשלחו.`, [{ t: 'עוד לא', v: false }, { t: 'נשלח', v: true, cls: 'primary' }]);
      if (ok) { chunk.forEach(r => (r.emailedAt = new Date().toISOString())); await DB.putMany(chunk); }
      else break;
    }
  } catch (e) { wait.close(); toast('שגיאה: ' + (e.message || e), 6000); }
  renderExport();
}

async function exportZip() {
  let recs = sortedRecs().filter(isSigned);
  if ($('#onlyNew').checked) recs = recs.filter(r => !r.exportedAt);
  const msg = $('#expMsg');
  if (!recs.length) return note(msg, 'אין קבצים חתומים לייצוא.');
  const stamp = today(), parts = Math.ceil(recs.length / ZIP_CHUNK);
  for (let p = 0; p < parts; p++) {
    const chunk = recs.slice(p * ZIP_CHUNK, (p + 1) * ZIP_CHUNK);
    const zip = new JSZip();
    for (let i = 0; i < chunk.length; i++) {
      note(msg, `מכין חלק ${p + 1}/${parts}: ${i + 1}/${chunk.length}`);
      zip.file(chunk[i].pdfName || pdfFileName(chunk[i]), await ensurePdf(chunk[i]));
    }
    zip.file('summary.csv', buildCsv(chunk));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    download(blob, `signed-forms-${stamp}${parts > 1 ? `-part${p + 1}` : ''}.zip`);
    chunk.forEach(r => (r.exportedAt = new Date().toISOString()));
    await DB.putMany(chunk);
    await new Promise(r => setTimeout(r, 700));
  }
  note(msg, `יוצאו ${recs.length} קבצי PDF.`);
  renderExport();
}
async function importBackup(buf) {
  const data = JSON.parse(new TextDecoder().decode(buf));
  if (!Array.isArray(data.buildings)) throw new Error('קובץ גיבוי לא תקין');
  const recs = data.buildings.map(b => Object.assign(blankRec(b.num ?? b.id, b.site || ''), b, { pdf: null }));
  recs.forEach(r => { r.num = String(r.num ?? r.id); r.id = mkKey(r.num, r.site); });
  await DB.putMany(recs); recs.forEach(r => S.map.set(r.id, r));
  return `שוחזרו ${recs.length} מבנים מהגיבוי (קובצי ה-PDF ייווצרו מחדש בעת הייצוא).`;
}

function wire() {
  $('#q').addEventListener('input', e => { S.filter.q = e.target.value; renderList(); });
  $('#siteSel').addEventListener('change', e => { S.filter.site = e.target.value; renderList(); });
  $('#statSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.filter.st = b.dataset.s; $$('#statSeg button').forEach(x => x.classList.toggle('on', x === b)); renderList();
  });
  $$('.tabs button').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.tab === 'export' ? '#/x' : '#/'; }));
  $('#backBtn').addEventListener('click', () => { location.hash = '#/'; });
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.cur) saveNow(S.cur).catch(() => {}); });

  /* כפתורי בחירת קובץ: לחיצה תכנותית על ה-input (עובד גם ב-WebView של אנדרואיד). באנדרואיד ללא סינון סוגים כדי שכל הקבצים יוצגו */
  if (NATIVE) $$('input[type=file]').forEach(i => i.removeAttribute('accept'));
  $('#impBtn').addEventListener('click', () => $('#impFile').click());
  $('#cfgBtn').addEventListener('click', () => $('#cfgFile').click());
  window.addEventListener('error', e => toast('שגיאה: ' + e.message, 6000));
  window.addEventListener('unhandledrejection', e => toast('שגיאה: ' + ((e.reason && e.reason.message) || e.reason), 6000));
  $('#impFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    note($('#impMsg'), 'קורא את הקובץ: ' + f.name + ' …');
    try { note($('#impMsg'), await importFile(f)); renderExport(); }
    catch (err) { note($('#impMsg'), 'שגיאה בייבוא: ' + err.message); }
  });
  $('#cfgFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    note($('#cfgMsg'), 'קורא את הקובץ: ' + f.name + ' …');
    try {
      const cfg = JSON.parse(await f.text());
      if (!Array.isArray(cfg.signers) || !cfg.signers.length || !Array.isArray(cfg.paragraphs) || !cfg.docTitle) throw new Error('קובץ הגדרות לא תקין');
      await DB.setCfg(cfg); applyConfig(cfg); S.map.forEach(fillSigners);
      note($('#cfgMsg'), 'ההגדרות נטענו: ' + CFG.docTitle); renderExport();
    } catch (err) { note($('#cfgMsg'), 'שגיאה: ' + err.message); }
  });
  $('#cfgReset').addEventListener('click', async () => {
    await DB.setCfg(null); applyConfig(null); note($('#cfgMsg'), 'הוחזרה ברירת המחדל הגנרית'); renderExport();
  });
  $('#onlyUnsent').addEventListener('change', renderMail);
  $('#mailList').addEventListener('click', e => { const b = e.target.closest('[data-send]'); if (b) sendSite(b.dataset.send); });
  $('#rcList').addEventListener('click', async e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    S.recipients.splice(+b.dataset.del, 1); await DB.setMeta('recipients', S.recipients); renderExport();
  });
  $('#rcAdd').addEventListener('click', async () => {
    const email = cleanTxt($('#rcEmail').value), site = cleanTxt($('#rcSite').value), role = cleanTxt($('#rcRole').value);
    if (!EMAIL_RE.test(email)) return toast('כתובת אימייל לא תקינה');
    const rec = { site, role, name: '', email }, k = rcKey(rec);
    const ex = S.recipients.find(r => rcKey(r) === k);
    if (ex) ex.role = role; else S.recipients.push(rec);
    await DB.setMeta('recipients', S.recipients);
    $('#rcEmail').value = ''; $('#rcRole').value = ''; renderExport();
  });
  $('#tplBtn').addEventListener('click', () => {
    const ex = [];
    const ws = XLSX.utils.aoa_to_sheet([COLS_CORE.map(c => c[0])]);
    ws['!cols'] = COLS_CORE.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, 'מבנים');
    download(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }), 'buildings-template.xlsx');
  });
  $('#csvBtn').addEventListener('click', () => download(buildCsv(sortedRecs()), `monday-${today()}.csv`));
  $('#csvSignedBtn').addEventListener('click', () => download(buildCsv(sortedRecs().filter(isSigned)), `monday-signed-${today()}.csv`));
  $('#zipBtn').addEventListener('click', () => exportZip().catch(err => note($('#expMsg'), 'שגיאה: ' + err.message)));
  $('#bakBtn').addEventListener('click', () => {
    const data = { version: APP_VERSION, exportedAt: new Date().toISOString(), buildings: sortedRecs().map(r => ({ ...r, pdf: null })) };
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `backup-${today()}.json`);
  });
  $('#wipeBtn').addEventListener('click', async () => {
    const unexp = [...S.map.values()].filter(r => isSigned(r) && !r.exportedAt).length;
    const ok = await ask(`למחוק את כל המבנים, החתימות וקבצי ה-PDF מהמכשיר?${unexp ? `\n\nשים לב: ${unexp} טפסים חתומים טרם יוצאו!` : ''}\nאי אפשר לשחזר.`, [{ t: 'ביטול', v: false }, { t: 'מחק הכול', v: true, cls: 'danger' }]);
    if (ok) { await DB.clear(); S.map.clear(); renderExport(); toast('הנתונים נמחקו'); }
  });
}

async function init() {
  const net = () => { $('#net').textContent = navigator.onLine ? 'מחובר' : 'ללא קליטה'; };
  net(); addEventListener('online', net); addEventListener('offline', net);
  await DB.open();
  applyConfig(await DB.getCfg());
  S.recipients = (await DB.getMeta('recipients')) || [];
  for (const r of await DB.all()) {
    fillSigners(r);
    if (r.num === undefined) { /* הגירה מגרסה ישנה: המזהה היה מספר מבנה בלבד */
      await DB.del(r.id); r.num = String(r.id); r.id = mkKey(r.num, r.site); await DB.put(r);
    }
    S.map.set(r.id, r);
  }
  wire(); route();
  navigator.storage?.persist?.();
  if (!NATIVE && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(() => renderExport()).catch(() => {});
}
init().catch(err => { document.body.insertAdjacentHTML('afterbegin', `<p style="padding:20px;color:#c0392b">שגיאה בטעינת האפליקציה: ${esc(err.message)}</p>`); });
