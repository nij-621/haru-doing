'use strict';
/* HaruDoing Work — 출퇴근 기록 + 월별 리포트
   데이터: hd.work / hd.workSettings (app.js의 hd.tasks와 완전 분리)
   규칙:
   - 기준시간: 월–목 8h, 금 6.5h (설정에서 변경 가능), 주말·휴가·공휴일·병가는 0
   - 점심: 구간 사이 30분 이상 공백이 있으면 추가 공제 없음, 없으면 하루 1회 30분 공제.
     단, 6시간 이하 근무한 날은 공제 없음 (오스트리아 AZG: 휴게 의무는 6시간 초과부터 —
     회사 시스템도 동일하게 동작함을 사용자가 확인)
   - 회사 입력 추천: 하루 한 블록(시작–종료), 종료 = 시작 + 순근무 + 점심(6시간 초과 시
     시스템이 공제), 15분 단위 반올림, 초과근무 상한 +2h, 차이는 Left overtime 잔고로 */
(function () {

const WTYPES = { work: 'Work', vacation: 'Vacation', holiday: 'Holiday', sick: 'Sick' };
const NO_LUNCH_MAX = 360; // 6시간 이하 근무일은 점심 공제 없음 (AZG, 회사 시스템 동일)

let work = {};   // 'YYYY-MM-DD' -> { seg:[{s,e|null}], home, type, note, entry:{s,e}|null, entered }
let wcfg = {
  base: [0, 480, 480, 480, 480, 390, 0],  // 요일(getDay)별 기준 분
  lunch: 30, cap: 120,
  opening: 0, openingMonth: '',            // 엑셀에서 넘어온 초기 잔고(분) + 기산월
  autoFill: false,                         // 부족한 날 잔고로 자동 채움 (Entry 추천)
};
let wrMonth = todayStr().slice(0, 7);
let wrView = 'days';                       // days | entry
let wmDate = null, wmSegs = [];            // 에디터 상태

/* ---------- 저장/불러오기 ---------- */
function wload() {
  try {
    work = JSON.parse(localStorage.getItem('hd.work') || '{}');
    wcfg = Object.assign(wcfg, JSON.parse(localStorage.getItem('hd.workSettings') || '{}'));
  } catch (e) { console.error('work load fail', e); }
}
function wsave() {
  localStorage.setItem('hd.work', JSON.stringify(work));
  localStorage.setItem('hd.workSettings', JSON.stringify(wcfg));
}

/* ---------- 시간 헬퍼 ---------- */
const t2m = t => { const [h, mi] = t.split(':').map(Number); return h * 60 + mi; };
const m2t = m => pad(Math.floor(Math.max(0, Math.min(m, 1439)) / 60)) + ':' + pad(Math.max(0, Math.min(m, 1439)) % 60);
const fmtDur = mm => Math.floor(Math.abs(mm) / 60) + ':' + pad(Math.abs(mm) % 60);
const fmtSign = mm => mm === 0 ? '0:00' : (mm < 0 ? '-' : '+') + fmtDur(mm);
const nowM = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const nowT = () => m2t(nowM());
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sortedSegs = rec => [...(rec.seg || [])].filter(x => x.s).sort((a, b) => a.s.localeCompare(b.s));

/* "8:00" / "+1:30" / "-0:45" / "6,5" -> 분 (실패 시 null) */
function parseDur(str) {
  const s = String(str).trim().replace(',', '.');
  let m = s.match(/^([+-]?)(\d{1,3}):([0-5]\d)$/);
  if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  m = s.match(/^([+-]?)(\d{1,2}(\.\d+)?)$/);
  if (m) return Math.round((m[1] === '-' ? -1 : 1) * Number(m[2]) * 60);
  return null;
}

/* ---------- 하루 계산 ---------- */
function dayInfo(ds) {
  const rec = work[ds];
  const off = !!(rec && rec.type && rec.type !== 'work');
  const base = off ? 0 : (wcfg.base[parseDate(ds).getDay()] || 0);
  let gross = 0, gap = false, open = false, prevEnd = null;
  if (rec) for (const sg of sortedSegs(rec)) {
    const s = t2m(sg.s);
    let e;
    if (sg.e) e = t2m(sg.e);
    else { open = true; e = ds === todayStr() ? nowM() : s; }
    if (e > s) {
      if (prevEnd !== null && s - prevEnd >= wcfg.lunch) gap = true;
      gross += e - s;
      prevEnd = prevEnd === null ? e : Math.max(prevEnd, e);
    } else if (prevEnd === null) prevEnd = s;
  }
  // 점심 공제: 공백(휴식)을 안 찍었고 6시간 초과 근무한 날만 (AZG 휴게 의무 기준)
  const deducted = gross > NO_LUNCH_MAX && !gap;
  const net = gross ? (deducted ? Math.max(0, gross - wcfg.lunch) : gross) : 0;
  return { rec, off, base, gross, net, gap, deducted, open, diff: net - base, hasData: !!rec };
}

/* 잔고 기산 시작일 (설정 우선, 없으면 첫 기록일) */
function trackingStart() {
  if (wcfg.openingMonth) return wcfg.openingMonth + '-01';
  const keys = Object.keys(work).sort();
  return keys[0] || null;
}

/* 어제 이전에 퇴근을 안 찍은 날 */
function staleOpenDate() {
  const today = todayStr();
  return Object.keys(work).sort().find(ds =>
    ds < today && (work[ds].seg || []).some(x => x.s && !x.e)) || null;
}

/* ---------- 회사 입력 추천 (기산일부터 순차 계산: 잔고가 날짜 순서에 의존) ----------
   반환: { map: ds -> {s,e,net,diff,left,override} | {offType} | null(기록 없음/시간 없음), left } */
function entriesThrough(lastDs) {
  const from = trackingStart();
  const dates = Object.keys(work).filter(ds => ds <= lastDs && (!from || ds >= from)).sort();
  let left = wcfg.opening;
  const map = {};
  for (const ds of dates) {
    const info = dayInfo(ds);
    if (info.off) { map[ds] = { offType: work[ds].type }; continue; }
    if (!info.gross) { map[ds] = null; continue; }
    const ov = work[ds].entry;
    // 회사 시스템이 인정하는 순근무: 입력 블록이 6시간 초과일 때만 점심 공제
    const spanNet = span => span > NO_LUNCH_MAX ? Math.max(0, span - wcfg.lunch) : Math.max(0, span);
    let ent;
    if (ov && ov.s && ov.e) {
      ent = { s: ov.s, e: ov.e, net: spanNet(t2m(ov.e) - t2m(ov.s)), override: true };
    } else {
      const maxNet = info.base + wcfg.cap;
      let net = Math.min(info.net, maxNet);
      // 자동 채움: 아직 근무 중인 날(퇴근 전)은 제외 — 하루가 끝나야 부족분이 확정됨
      if (wcfg.autoFill && !info.open && net < info.base && left > 0) net += Math.min(left, info.base - net);
      const sR = Math.round(t2m(sortedSegs(work[ds])[0].s) / 15) * 15;
      const span = net > NO_LUNCH_MAX ? net + wcfg.lunch : net;
      let eR = Math.round((sR + span) / 15) * 15;
      while (spanNet(eR - sR) > maxNet) eR -= 15;
      eR = Math.max(eR, sR);
      ent = { s: m2t(sR), e: m2t(eR), net: spanNet(eR - sR), override: false };
    }
    left += info.net - ent.net;
    ent.diff = info.net - ent.net;   // +면 잔고에 적립, -면 잔고에서 사용
    ent.left = left;
    map[ds] = ent;
  }
  return { map, left };
}

/* 한 달 실제 ± 합계 (기록 있는 날만) */
function monthActual(month) {
  let sum = 0;
  for (const ds of Object.keys(work)) {
    if (ds.slice(0, 7) !== month) continue;
    const info = dayInfo(ds);
    if (info.gross || info.off) sum += info.diff;
  }
  return sum;
}

/* ---------- Today 탭 펀치 카드 ---------- */
function renderWorkCard() {
  const el = $('#work-card');
  if (!el) return;
  el.hidden = false;
  const ds = cur, isToday = ds === todayStr();
  const info = dayInfo(ds);
  const rec = info.rec;
  const running = isToday && rec && (rec.seg || []).some(x => x.s && !x.e);
  const d = parseDate(ds);
  let h = `<div class="wk-head">
    <span class="wk-title">${iconSvg('work', 16)}Work</span>
    <label class="wk-home set-row">Home office <input id="wk-home" type="checkbox" ${rec && rec.home ? 'checked' : ''}></label>
  </div>`;
  const stale = staleOpenDate();
  if (stale) h += `<button class="wk-warn" id="wk-stale">Missing end time on ${stale} — tap to fix</button>`;
  if (info.off) {
    h += `<div class="wk-off">${WTYPES[rec.type] || rec.type}${rec.note ? ' · ' + esc(rec.note) : ''}</div>`;
  } else {
    const segs = rec ? sortedSegs(rec) : [];
    if (segs.length) {
      h += '<div class="wk-segs">';
      for (const sg of segs) {
        const openNow = !sg.e;
        const end = sg.e || (isToday ? 'now' : '—');
        const mins = sg.e ? t2m(sg.e) - t2m(sg.s) : (isToday ? nowM() - t2m(sg.s) : 0);
        h += `<div class="wk-seg${openNow ? ' run' : ''}"><span>${sg.s} – ${end}</span><span>${mins > 0 ? fmtDur(mins) : ''}${openNow && isToday ? '…' : ''}</span></div>`;
      }
      if (info.deducted) h += `<div class="wk-lunch">Lunch −${fmtDur(wcfg.lunch)} (no break logged)</div>`;
      h += '</div>';
    }
  }
  h += '<div class="wk-btns">';
  if (isToday && !info.off) {
    h += running
      ? '<button id="wk-punch" class="wk-main out">End work</button>'
      : `<button id="wk-punch" class="wk-main">${rec && (rec.seg || []).length ? 'Resume work' : 'Start work'}</button>`;
  }
  h += `<button id="wk-edit" class="chip-btn">${iconSvg('writing', 15)} Edit</button></div>`;
  const parts = [];
  if (info.gross || info.off) parts.push(`<b>${fmtDur(info.net)}</b> · ${isToday ? 'Today' : WEEKDAYS[d.getDay()]} ${fmtSign(info.diff)}`);
  parts.push(`${MONTHS[d.getMonth()]} ${fmtSign(monthActual(ds.slice(0, 7)))}`);
  h += `<div class="wk-foot"><span>${parts.join(' · ')}</span><button id="wk-report" class="wk-link">Report ›</button></div>`;
  el.innerHTML = h;

  $('#wk-home').onchange = e => {
    work[ds] = work[ds] || { seg: [] };
    work[ds].home = e.target.checked;
    wsave();
  };
  const punch = $('#wk-punch');
  if (punch) punch.onclick = () => { running ? punchEnd() : punchStart(); };
  $('#wk-edit').onclick = () => openWorkModal(ds);
  $('#wk-report').onclick = () => openReport(ds.slice(0, 7));
  const st = $('#wk-stale');
  if (st) st.onclick = () => openWorkModal(stale);
}

function punchStart() {
  const ds = todayStr();
  const rec = work[ds] = work[ds] || { seg: [] };
  rec.seg = rec.seg || [];
  rec.seg.push({ s: nowT(), e: null });
  wsave(); renderWorkCard();
}
function punchEnd() {
  const rec = work[todayStr()];
  if (!rec) return;
  const openSeg = (rec.seg || []).find(x => x.s && !x.e);
  if (openSeg) {
    const t = nowT();
    openSeg.e = t === openSeg.s ? m2t(t2m(t) + 1) : t;  // 같은 분에 찍으면 1분 보정
  }
  wsave(); renderWorkCard();
}

/* ---------- 하루 편집 모달 ---------- */
function openWorkModal(ds) {
  wmDate = ds;
  const rec = work[ds] || {};
  const d = parseDate(ds);
  $('#wm-title').textContent = `${MONTHS[d.getMonth()]} ${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
  $('#wm-type').value = rec.type || 'work';
  $('#wm-home').checked = !!rec.home;
  $('#wm-note').value = rec.note || '';
  $('#wm-es').value = rec.entry ? rec.entry.s : '';
  $('#wm-ee').value = rec.entry ? rec.entry.e : '';
  wmSegs = sortedSegs(rec).map(x => ({ s: x.s, e: x.e }));
  if (!wmSegs.length) wmSegs.push({ s: '', e: '' });
  wmRenderSegs();
  $('#work-modal').hidden = false;
}
function closeWorkModal() { $('#work-modal').hidden = true; wmDate = null; }

function wmRenderSegs() {
  const box = $('#wm-segs');
  box.innerHTML = '';
  wmSegs.forEach((sg, i) => {
    const row = document.createElement('div');
    row.className = 'wm-seg';
    row.innerHTML = `<input type="time" value="${sg.s || ''}"><span>–</span><input type="time" value="${sg.e || ''}"><button class="icon-btn" aria-label="Remove period">✕</button>`;
    const [is, ie] = row.querySelectorAll('input');
    is.onchange = e => { wmSegs[i].s = e.target.value; };
    ie.onchange = e => { wmSegs[i].e = e.target.value; };
    row.querySelector('button').onclick = () => { wmSegs.splice(i, 1); if (!wmSegs.length) wmSegs.push({ s: '', e: '' }); wmRenderSegs(); };
    box.appendChild(row);
  });
}

function saveWorkModal() {
  const ds = wmDate;
  const segs = wmSegs.filter(x => x.s).map(x => ({ s: x.s, e: x.e || null }));
  segs.sort((a, b) => a.s.localeCompare(b.s));
  for (let i = 0; i < segs.length; i++) {
    const sg = segs[i];
    if (!sg.e && (ds !== todayStr() || i !== segs.length - 1)) { alert('Only the last period of today can be left open.'); return; }
    if (sg.e && t2m(sg.e) <= t2m(sg.s)) { alert(`End must be after start (${sg.s}).`); return; }
    if (i > 0 && segs[i - 1].e && t2m(sg.s) < t2m(segs[i - 1].e)) { alert('Periods overlap.'); return; }
  }
  const es = $('#wm-es').value, ee = $('#wm-ee').value;
  if ((es && !ee) || (!es && ee)) { alert('Entry override needs both start and end.'); return; }
  if (es && ee && t2m(ee) <= t2m(es)) { alert('Entry override end must be after start.'); return; }
  const type = $('#wm-type').value;
  const home = $('#wm-home').checked;
  const note = $('#wm-note').value.trim();
  if (!segs.length && type === 'work' && !home && !note && !es) {
    delete work[ds];
  } else {
    const rec = work[ds] = work[ds] || {};
    rec.seg = segs;
    rec.type = type === 'work' ? undefined : type;
    rec.home = home || undefined;
    rec.note = note || undefined;
    rec.entry = es ? { s: es, e: ee } : undefined;
  }
  wsave();
  closeWorkModal();
  if (tab === 'today') renderWorkCard();
  if (!$('#work-report').hidden) renderReport();
}

function clearWorkDay() {
  if (!confirm('Clear all work data for this day?')) return;
  delete work[wmDate];
  wsave();
  closeWorkModal();
  if (tab === 'today') renderWorkCard();
  if (!$('#work-report').hidden) renderReport();
}

/* ---------- 월별 리포트 ---------- */
function openReport(month) {
  wrMonth = month || todayStr().slice(0, 7);
  $('#work-report').hidden = false;
  renderReport();
}
function closeReport() { $('#work-report').hidden = true; }

function renderReport() {
  const [y, mo] = wrMonth.split('-').map(Number);
  $('#wr-month').textContent = `${MONTHS[mo - 1]} ${y}`;
  $$('#wr-seg button').forEach(b => b.classList.toggle('active', b.dataset.wview === wrView));
  $('#wr-autofill').hidden = wrView !== 'entry';
  $('#wr-af').checked = !!wcfg.autoFill;

  const daysIn = new Date(y, mo, 0).getDate();
  const lastDs = `${y}-${pad(mo)}-${pad(daysIn)}`;
  const { map } = entriesThrough(lastDs);
  const today = todayStr();
  const from = trackingStart();

  let netSum = 0, baseSum = 0, entSum = 0, entBase = 0, lastLeft = null, missing = 0;
  const list = $('#wr-list');
  list.innerHTML = '';

  for (let day = 1; day <= daysIn; day++) {
    const ds = `${y}-${pad(mo)}-${pad(day)}`;
    if (ds > today) break;
    const dow = parseDate(ds).getDay();
    const info = dayInfo(ds);
    const ent = map[ds];
    if (ent && ent.left !== undefined) lastLeft = ent.left;

    if (!info.hasData || (!info.gross && !info.off)) {
      if (dow >= 1 && dow <= 5 && from && ds >= from) {
        missing++;
        const row = mkDayRow(ds, `<span class="wr-miss">No record</span>`, '', '');
        row.classList.add('wr-missing');
        list.appendChild(row);
      }
      continue;
    }
    netSum += info.net; baseSum += info.base;
    if (ent && !ent.offType && ent.net !== undefined) { entSum += ent.net; entBase += info.base; }

    if (wrView === 'days') {
      if (info.off) {
        list.appendChild(mkDayRow(ds, `<span class="wr-off">${WTYPES[work[ds].type]}${work[ds].note ? ' · ' + esc(work[ds].note) : ''}</span>`, '', ''));
      } else {
        const segTxt = sortedSegs(work[ds]).map(sg => `${sg.s}–${sg.e || (ds === today ? 'now' : '?')}`).join(' · ');
        list.appendChild(mkDayRow(ds, esc(segTxt) + (work[ds].note ? ` · ${esc(work[ds].note)}` : ''), fmtDur(info.net), diffChip(info.diff), work[ds].home));
      }
    } else {
      if (info.off) {
        list.appendChild(mkDayRow(ds, `<span class="wr-off">${WTYPES[work[ds].type]}</span>`, '', '', false, ds));
      } else if (ent) {
        const sub = [];
        if (ent.override) sub.push('edited');
        if (ent.diff) sub.push(`bank ${fmtSign(ent.diff)}`);
        sub.push(`bal ${fmtSign(ent.left)}`);
        const row = mkDayRow(ds, `<b class="wr-time">${ent.s} – ${ent.e}</b> <small>${sub.join(' · ')}</small>`, fmtDur(ent.net), '', work[ds].home, ds);
        list.appendChild(row);
      }
    }
  }
  if (!list.children.length) list.innerHTML = '<div class="empty-note">No work records this month.<br>Use Start work on the Today screen.</div>';

  const finalLeft = lastLeft !== null ? lastLeft : wcfg.opening;
  $('#wr-summary').innerHTML = `
    <div class="wr-metric"><small>Worked / target</small><b>${fmtDur(netSum)} / ${fmtDur(baseSum)}</b></div>
    <div class="wr-metric"><small>Actual overtime</small><b class="${cls(netSum - baseSum)}">${fmtSign(netSum - baseSum)}</b></div>
    <div class="wr-metric"><small>Entered overtime</small><b class="${cls(entSum - entBase)}">${fmtSign(entSum - entBase)}</b></div>
    <div class="wr-metric"><small>Left overtime</small><b class="${cls(finalLeft)}">${fmtSign(finalLeft)}</b></div>`
    + (missing ? `<div class="wr-note">${missing} weekday${missing > 1 ? 's' : ''} without a record — tap to fill or mark as vacation.</div>` : '');
}

const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
const diffChip = v => `<span class="wr-diff ${cls(v)}">${fmtSign(v)}</span>`;

function mkDayRow(ds, infoHtml, cnt, extra, home, entryDs) {
  const d = parseDate(ds);
  const row = document.createElement('div');
  row.className = 'day-row wr-row';
  row.innerHTML = `<div class="d">${d.getDate()}<small>${WEEKDAYS[d.getDay()]}</small></div>
    <div class="wr-ho">${home ? iconSvg('home', 14) : ''}</div>
    <div class="info">${infoHtml}</div>
    <div class="cnt">${cnt}</div>${extra || ''}`;
  if (entryDs !== undefined && work[ds]) {
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'wr-check';
    chk.title = 'Entered in company system';
    chk.checked = !!work[ds].entered;
    chk.onclick = e => { e.stopPropagation(); work[ds].entered = chk.checked || undefined; wsave(); row.classList.toggle('entered', chk.checked); };
    row.appendChild(chk);
    row.classList.toggle('entered', !!work[ds].entered);
  }
  row.onclick = () => openWorkModal(ds);
  return row;
}

/* ---------- CSV 내보내기 ---------- */
function exportCsv() {
  const [y, mo] = wrMonth.split('-').map(Number);
  const daysIn = new Date(y, mo, 0).getDate();
  const { map } = entriesThrough(`${y}-${pad(mo)}-${pad(daysIn)}`);
  const rows = [['Date', 'Day', 'Type', 'Home', 'Periods', 'Net', 'Base', 'Actual diff', 'Entry start', 'Entry end', 'Entry net', 'Banked', 'Balance', 'Note']];
  for (let day = 1; day <= daysIn; day++) {
    const ds = `${y}-${pad(mo)}-${pad(day)}`;
    const rec = work[ds];
    if (!rec) continue;
    const info = dayInfo(ds);
    const ent = map[ds];
    rows.push([
      ds, WEEKDAYS[parseDate(ds).getDay()], rec.type || 'work', rec.home ? 'yes' : '',
      sortedSegs(rec).map(sg => `${sg.s}-${sg.e || ''}`).join(' '),
      fmtDur(info.net), fmtDur(info.base), fmtSign(info.diff),
      ent && ent.s ? ent.s : '', ent && ent.e ? ent.e : '',
      ent && ent.net !== undefined && !ent.offType ? fmtDur(ent.net) : '',
      ent && ent.diff !== undefined ? fmtSign(ent.diff) : '',
      ent && ent.left !== undefined ? fmtSign(ent.left) : '',
      rec.note || '',
    ]);
  }
  const csv = rows.map(r => r.map(v => /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.download = `HaruDoing_work_${wrMonth}.csv`;
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- 설정 ---------- */
function populateWorkSettings() {
  $('#ws-base').value = fmtDur(wcfg.base[1]);
  $('#ws-fri').value = fmtDur(wcfg.base[5]);
  $('#ws-lunch').value = wcfg.lunch;
  $('#ws-cap').value = fmtDur(wcfg.cap);
  $('#ws-open').value = fmtSign(wcfg.opening);
  $('#ws-openm').value = wcfg.openingMonth || '';
}
function bindWorkSettings() {
  const durField = (id, apply) => {
    $(id).onchange = e => {
      const v = parseDur(e.target.value);
      if (v === null) { populateWorkSettings(); return; }
      apply(v); wsave(); populateWorkSettings();
    };
  };
  durField('#ws-base', v => { const m = Math.abs(v); wcfg.base[1] = wcfg.base[2] = wcfg.base[3] = wcfg.base[4] = m; });
  durField('#ws-fri', v => { wcfg.base[5] = Math.abs(v); });
  durField('#ws-cap', v => { wcfg.cap = Math.abs(v); });
  durField('#ws-open', v => { wcfg.opening = v; });
  $('#ws-lunch').onchange = e => { wcfg.lunch = Math.max(0, Number(e.target.value) || 0); wsave(); populateWorkSettings(); };
  $('#ws-openm').onchange = e => { wcfg.openingMonth = e.target.value || ''; wsave(); };
}

/* ---------- 백업 연동 (app.js exportData/importData가 호출) ---------- */
window.HDWORK = {
  exportPayload: () => ({ work, workSettings: wcfg }),
  importPayload(data) {
    if (data.work) work = data.work;
    if (data.workSettings) wcfg = Object.assign(wcfg, data.workSettings);
    wsave();
    populateWorkSettings();
  },
};

/* ---------- 이벤트 + 시작 ---------- */
function wbind() {
  $('#wr-back').onclick = closeReport;
  $('#wr-mprev').onclick = () => { const [y, m] = wrMonth.split('-').map(Number); wrMonth = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; renderReport(); };
  $('#wr-mnext').onclick = () => { const [y, m] = wrMonth.split('-').map(Number); wrMonth = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; renderReport(); };
  $$('#wr-seg button').forEach(b => b.onclick = () => { wrView = b.dataset.wview; renderReport(); });
  $('#wr-af').onchange = e => { wcfg.autoFill = e.target.checked; wsave(); renderReport(); };
  $('#wr-csv').onclick = exportCsv;
  $('#wm-addseg').onclick = () => { wmSegs.push({ s: '', e: '' }); wmRenderSegs(); };
  $('#wm-save').onclick = saveWorkModal;
  $('#wm-cancel').onclick = closeWorkModal;
  $('#wm-del').onclick = clearWorkDay;
  $('#work-modal').addEventListener('click', e => { if (e.target.id === 'work-modal') closeWorkModal(); });
  bindWorkSettings();
  // 다른 탭/창에서 근무 데이터가 바뀌면 다시 불러오기
  window.addEventListener('storage', e => {
    if (e.key === 'hd.work' || e.key === 'hd.workSettings') {
      wload();
      populateWorkSettings();
      if (tab === 'today') renderWorkCard();
      if (!$('#work-report').hidden) renderReport();
    }
  });
  // 근무 중 경과 시간 실시간 갱신
  setInterval(() => {
    if (tab === 'today' && !document.hidden) renderWorkCard();
  }, 60000);
}

window.renderWorkCard = renderWorkCard;

wload();
wbind();
populateWorkSettings();
if (tab === 'today') renderWorkCard();  // app.js init()이 먼저 렌더를 끝낸 뒤 로드되므로 1회 직접 호출

})();
