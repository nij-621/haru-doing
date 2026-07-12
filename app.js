'use strict';
/* 하루두잉 — 개인용 데일리 플래너 (두잉두잉 + Structured 스타일) */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => fmt(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MOODS = ['😄', '🙂', '😐', '😔', '😢', '😠', '🥱', '🤒', '🥳'];
const MOOD_LABELS = ['Happy', 'Good', 'Okay', 'Down', 'Sad', 'Angry', 'Tired', 'Sick', 'Party'];
const COLORS = ['#ff7b54', '#4a90d9', '#4caf7d', '#e8a33d', '#b085d6', '#e05c7a', '#7a8a99'];
const STATUS = {
  todo:   { sym: '○', label: 'To-do' },
  doing:  { sym: '◐', label: 'Doing' },
  done:   { sym: '✓', label: 'Done' },
  defer:  { sym: '→', label: 'Defer' },
  cancel: { sym: '✕', label: 'Cancel' },
};
const HOUR_PX = 56;

/* ---------- 상태 ---------- */
let tasks = [];      // 할 일 + 반복 템플릿 + 반복 인스턴스 오버라이드
let days = {};       // 'YYYY-MM-DD' -> { mood, diary }
let settings = { font: 'sans', size: 16, theme: 'auto', notify: false, view: 'list' };
let cur = todayStr();       // 오늘 탭에서 보는 날짜
let curMonth = cur.slice(0, 7); // 전체 탭에서 보는 달
let tab = 'today';
let editing = null;         // 모달에서 수정 중인 항목
let inboxSort = 'recent';   // 인박스 정렬: recent | oldest
let tlScrollKey = '';       // 타임라인 자동 스크롤이 이미 실행된 날짜 키
let notified = new Set();

/* ---------- 저장/불러오기 ---------- */
function load() {
  try {
    tasks = JSON.parse(localStorage.getItem('hd.tasks') || '[]');
    days = JSON.parse(localStorage.getItem('hd.days') || '{}');
    settings = Object.assign(settings, JSON.parse(localStorage.getItem('hd.settings') || '{}'));
  } catch (e) { console.error('load fail', e); }
}
function save() {
  localStorage.setItem('hd.tasks', JSON.stringify(tasks));
  localStorage.setItem('hd.days', JSON.stringify(days));
  localStorage.setItem('hd.settings', JSON.stringify(settings));
  updateBadge();
  updateWidgetData();
}

/* ---------- 반복 일정 ---------- */
function repeatMatches(tpl, dateStr) {
  if (dateStr < tpl.date) return false;
  const d = parseDate(dateStr), t = parseDate(tpl.date);
  if (tpl.repeat === 'daily') return true;
  if (tpl.repeat === 'weekdays') return d.getDay() >= 1 && d.getDay() <= 5;
  if (tpl.repeat === 'weekly') return d.getDay() === t.getDay();
  return false;
}

/* 특정 날짜의 할 일 목록 (반복 인스턴스 포함) */
function tasksForDay(dateStr) {
  const out = tasks.filter(t => !t.repeat && t.date === dateStr && !t.hidden);
  for (const tpl of tasks.filter(t => t.repeat)) {
    if (!repeatMatches(tpl, dateStr)) continue;
    const ov = tasks.find(o => o.repeatOf === tpl.id && o.date === dateStr);
    if (ov) continue; // 이미 out에 포함됨(hidden이면 제외됨)
    out.push({
      id: 'v:' + tpl.id + ':' + dateStr, virtual: true, tplId: tpl.id,
      title: tpl.title, emoji: tpl.emoji, color: tpl.color, note: tpl.note,
      time: tpl.time, dur: tpl.dur, date: dateStr, status: 'todo', repeat: null,
    });
  }
  out.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || (a.createdAt || 0) - (b.createdAt || 0));
  return out;
}

/* 가상 반복 인스턴스를 실제 레코드로 변환 */
function materialize(inst) {
  const t = {
    id: uid(), title: inst.title, emoji: inst.emoji, color: inst.color, note: inst.note,
    time: inst.time, dur: inst.dur, date: inst.date, status: inst.status,
    repeatOf: inst.tplId, createdAt: Date.now(),
  };
  tasks.push(t);
  return t;
}

/* ---------- 자동 이월 (두잉두잉: 진행중/연기 → 다음날) ---------- */
function carryOver() {
  const today = todayStr();
  let n = 0;
  for (const t of tasks) {
    if (t.repeat || !t.date || t.date >= today || t.carried || t.hidden) continue;
    if (t.status === 'doing' || t.status === 'defer') {
      tasks.push({
        id: uid(), title: t.title, emoji: t.emoji, color: t.color, note: t.note,
        time: t.time, dur: t.dur, date: today, status: 'todo',
        carriedFrom: t.date, createdAt: Date.now(),
      });
      t.carried = true;
      n++;
    }
  }
  if (n) { save(); }
  return n;
}

/* ---------- 상태 변경 ---------- */
function setStatus(item, st) {
  let t = item.virtual ? materialize(item) : item;
  t.status = st;
  save();
  render();
  // Doing/Defer → 어디로 옮길지 물어보기 (두잉두잉 스타일)
  if ((st === 'doing' || st === 'defer') && t.date) openMoveDialog(t);
}

/* ---------- 이동 다이얼로그 ---------- */
let moveTask = null;
function openMoveDialog(t) {
  moveTask = t;
  $('#mv-pick').hidden = false;
  $('#mv-date-row').hidden = true;
  const d = parseDate(t.date);
  d.setDate(d.getDate() + 1);
  $('#mv-date').value = fmt(d);
  $('#move-modal').hidden = false;
}
function closeMoveDialog() { $('#move-modal').hidden = true; moveTask = null; }
function moveCopy(targetDate) {
  const t = moveTask;
  closeMoveDialog();
  if (!t || !targetDate || targetDate === t.date) return;
  tasks.push({
    id: uid(), title: t.title, emoji: t.emoji, color: t.color, note: t.note,
    time: t.time, dur: t.dur, date: targetDate, status: 'todo',
    carriedFrom: t.date, createdAt: Date.now(),
  });
  t.carried = true; // 자정 자동 이월과 중복 방지
  save();
  render();
}

/* ---------- 렌더링 ---------- */
function render() {
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-today').hidden = tab !== 'today';
  $('#tab-inbox').hidden = tab !== 'inbox';
  $('#tab-month').hidden = tab !== 'month';
  $('#tab-settings').hidden = tab !== 'settings';
  $('#topbar').style.display = tab === 'today' ? '' : 'none';
  $('#fab').hidden = tab === 'settings' || tab === 'month';
  if (tab === 'today') renderToday();
  if (tab === 'inbox') renderInbox();
  if (tab === 'month') renderMonth();
  if (tab === 'settings') renderSettings();
}

function renderToday() {
  const d = parseDate(cur);
  const isToday = cur === todayStr();
  // 날짜: 큰 날짜 + 작은 요일/Today 2줄 위계
  const dl = $('#btn-date');
  dl.classList.toggle('today', isToday);
  dl.innerHTML = `<span class="dl-date">${MONTHS[d.getMonth()]} ${d.getDate()}</span>`
    + `<span class="dl-sub">${WEEKDAYS[d.getDay()]}${isToday ? ' · Today' : ''}</span>`;
  $$('#view-seg button').forEach(b => b.classList.toggle('active', b.dataset.view === settings.view));

  // 기분 + 일기
  const day = days[cur] || {};
  const moodRow = $('#mood-row');
  moodRow.innerHTML = '';
  MOODS.forEach((m, mi) => {
    const b = document.createElement('button');
    b.textContent = m;
    b.title = MOOD_LABELS[mi];
    b.setAttribute('aria-label', MOOD_LABELS[mi]);
    b.classList.toggle('sel', day.mood === m);
    b.onclick = () => {
      days[cur] = days[cur] || {};
      days[cur].mood = days[cur].mood === m ? null : m;
      save(); renderToday();
    };
    moodRow.appendChild(b);
  });
  const diary = $('#diary-input');
  if (diary.value !== (day.diary || '')) diary.value = day.diary || '';

  // 이월 안내
  const carried = tasksForDay(cur).filter(t => t.carriedFrom);
  const note = $('#carry-note');
  if (isToday && carried.length) {
    note.hidden = false;
    note.innerHTML = iconSvg('ui-carried', 13) + ` ${carried.length} unfinished ${carried.length === 1 ? 'task' : 'tasks'} carried over to today.`;
  } else note.hidden = true;

  const list = tasksForDay(cur);
  renderNextUp(list, isToday);
  $('#list-view').hidden = settings.view !== 'list';
  $('#timeline-view').hidden = settings.view !== 'timeline';
  if (settings.view === 'list') renderListView(list);
  else renderTimelineView(list, isToday);
}

/* 아직 끝나지 않은 가장 이른 시간 일정 (Next up 카드와 타임라인 강조가 공유) */
function nextUpcomingTask(list) {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return list.filter(t => (t.status === 'todo' || t.status === 'doing') && t.time)
    .find(t => {
      const [h, m] = t.time.split(':').map(Number);
      return h * 60 + m + (t.dur || 30) > nowMins;
    }) || null;
}

/* ---------- Next up: 지금 해야 할 일 하이라이트 ---------- */
function renderNextUp(list, isToday) {
  const el = $('#next-up');
  if (!isToday) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'task-group-label';
  el.appendChild(label);

  const active = list.filter(t => t.status === 'todo' || t.status === 'doing');
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let pick = nextUpcomingTask(list);
  let suffix = '';
  if (pick) {
    const [h, m] = pick.time.split(':').map(Number);
    if (h * 60 + m <= nowMins) suffix = ' · now';
  } else {
    pick = active.find(t => !t.time) || null;
    if (pick) suffix = ' · no time set';
  }
  label.textContent = 'Next up' + suffix;

  if (!pick) {
    const empty = document.createElement('div');
    empty.className = 'next-empty';
    empty.textContent = 'No upcoming tasks';
    el.appendChild(empty);
    return;
  }
  const row = taskRow(pick);
  row.classList.add('next-task');
  el.appendChild(row);
}

function taskRow(t, opts = {}) {
  const row = document.createElement('div');
  row.className = 'task-row st-' + t.status + (t.time ? ' sched' : ' unsched') + (t.important ? ' important' : '');
  row.style.setProperty('--tcolor', t.color || 'var(--line)');

  const bullet = document.createElement('button');
  bullet.className = 'bullet';
  bullet.textContent = STATUS[t.status].sym;
  bullet.title = STATUS[t.status].label;
  bullet.onclick = e => { e.stopPropagation(); openStatusPopover(bullet, t); };
  row.appendChild(bullet);

  const main = document.createElement('div');
  main.className = 'task-main';
  const title = document.createElement('div');
  title.className = 'task-title';
  const iconId = resolveIcon(t.emoji);
  if (iconId) title.appendChild(IconBadge(iconId, { size: 15 }));
  const txt = document.createElement('span');
  txt.className = 't-text';
  txt.textContent = t.title;
  title.appendChild(txt);
  if (t.important) {
    const star = document.createElement('span');
    star.className = 'imp-star';
    star.innerHTML = iconSvg('important', 13);
    title.appendChild(star);
  }
  main.appendChild(title);
  const subs = [];
  if (t.dur) subs.push([null, t.dur >= 60 ? `${Math.floor(t.dur / 60)}h${t.dur % 60 ? ' ' + t.dur % 60 + 'm' : ''}` : `${t.dur}m`]);
  if (t.tplId || t.repeatOf) subs.push(['ui-repeat', 'Repeats']);
  if (t.carriedFrom) subs.push(['ui-carried', 'Carried over']);
  if (t.note) subs.push(['ui-notetext', t.note]);
  if (subs.length) {
    const sub = document.createElement('div');
    sub.className = 'task-sub';
    subs.forEach(([ic, text], i) => {
      const s = document.createElement('span');
      s.className = 'sub-item';
      if (ic) s.innerHTML = iconSvg(ic, 11);
      s.appendChild(document.createTextNode((ic ? ' ' : '') + text));
      sub.appendChild(s);
      if (i < subs.length - 1) sub.appendChild(document.createTextNode(' · '));
    });
    main.appendChild(sub);
  }
  row.appendChild(main);

  if (t.time) {
    const tm = document.createElement('div');
    tm.className = 'task-time';
    tm.textContent = t.time;
    row.appendChild(tm);
  }
  if (opts.toToday) {
    const b = document.createElement('button');
    b.className = 'mini-btn';
    b.textContent = 'To today →';
    b.onclick = e => { e.stopPropagation(); t.date = todayStr(); save(); render(); };
    row.appendChild(b);
  }
  row.onclick = () => openModal(t);
  return row;
}

function renderListView(list) {
  const el = $('#list-view');
  el.innerHTML = '';
  if (!list.length) {
    el.innerHTML = '<div class="empty-note">No tasks yet.<br>Tap ＋ to write your first one</div>';
    return;
  }
  const timed = list.filter(t => t.time), untimed = list.filter(t => !t.time);
  if (untimed.length) {
    const h = document.createElement('div'); h.className = 'task-group-label'; h.textContent = 'Tasks';
    el.appendChild(h);
    untimed.forEach(t => el.appendChild(taskRow(t)));
  }
  if (timed.length) {
    const h = document.createElement('div'); h.className = 'task-group-label'; h.textContent = 'Scheduled';
    el.appendChild(h);
    timed.forEach(t => el.appendChild(taskRow(t)));
  }
}

/* ---------- 타임라인 (Structured식 순차 레이아웃) ----------
   task 수만큼 늘어나고, 겹치지 않으며, 빈 시간은 점선 커넥터로 압축 */
const timeToMins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const minsToTime = mins => `${pad(Math.floor(Math.max(0, Math.min(mins, 1439)) / 60))}:${pad(Math.max(0, Math.min(mins, 1439)) % 60)}`;

function renderTimelineView(list, isToday) {
  const un = $('#tl-unsched');
  un.innerHTML = '';
  const untimed = list.filter(t => !t.time);
  if (untimed.length) {
    const h = document.createElement('div'); h.className = 'task-group-label'; h.textContent = 'No time set';
    un.appendChild(h);
    untimed.forEach(t => un.appendChild(taskRow(t)));
  }
  const grid = $('#tl-grid');
  grid.innerHTML = '';
  const timed = list.filter(t => t.time);
  if (!timed.length) {
    grid.innerHTML = '<div class="empty-note">No scheduled tasks.<br>Give a task a time to see it on the timeline.</div>';
    return;
  }
  const hint = document.createElement('div');
  hint.className = 'tl-hint';
  hint.textContent = 'Press & hold a card, then drag to change its time';
  grid.appendChild(hint);

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const nextTask = isToday ? nextUpcomingTask(list) : null;
  let nowEl = null;
  const addNowLine = () => {
    const n = document.createElement('div');
    n.className = 'tls-now';
    n.innerHTML = `<span>${minsToTime(nowMins)}</span>`;
    grid.appendChild(n);
    nowEl = n;
  };

  let prevEnd = null;
  let nowInserted = !isToday;
  for (const t of timed) {
    const start = timeToMins(t.time);
    const end = start + (t.dur || 0);
    // 빈 시간 커넥터 (길수록 살짝 길어지지만 최대 64px로 압축)
    if (prevEnd !== null && start > prevEnd) {
      const gap = start - prevEnd;
      const g = document.createElement('div');
      g.className = 'tls-gap';
      g.style.height = Math.min(22 + gap / 60 * 8, 64) + 'px';
      if (gap >= 45) g.innerHTML = `<span>${minsToTime(prevEnd)} – ${minsToTime(start)}</span>`;
      const at = Math.ceil(prevEnd / 15) * 15;
      g.title = 'Add a task here';
      g.onclick = () => openModal(null, { date: cur, time: minsToTime(at) });
      grid.appendChild(g);
    }
    if (!nowInserted && nowMins < start) { addNowLine(); nowInserted = true; }
    grid.appendChild(seqCard(t, t === nextTask));
    prevEnd = prevEnd === null ? end : Math.max(prevEnd, end);
  }
  if (!nowInserted) addNowLine();
  // 현재 시각으로 자동 스크롤은 "날짜/뷰가 바뀐 첫 렌더"에만 —
  // 상태 변경·드래그 후 재렌더에서 화면이 튀지 않도록
  const scrollKey = cur + '|timeline';
  if (isToday && nowEl && tlScrollKey !== scrollKey) {
    tlScrollKey = scrollKey;
    requestAnimationFrame(() => {
      const y = nowEl.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2;
      if (y > 0) window.scrollTo({ top: y, behavior: 'smooth' });
    });
  }
}

/* 순차 타임라인 카드: 시간 라벨 + 컬러 아이콘 도트(세로 레일 위) + 카드 */
function seqCard(t, isNext) {
  const item = document.createElement('div');
  item.className = 'tls-item st-' + t.status + (isNext ? ' next' : '');
  item.style.setProperty('--tcolor', t.color || 'var(--accent)');
  const end = t.dur ? minsToTime(timeToMins(t.time) + t.dur) : null;
  item.innerHTML = `
    <div class="tls-time">${t.time}</div>
    <div class="tls-rail"><span class="tls-dot"></span></div>
    <div class="tls-card">
      <div class="tls-body">
        <div class="tls-title"></div>
        <div class="tls-sub"></div>
      </div>
    </div>`;
  const iconId = resolveIcon(t.emoji);
  if (iconId) item.querySelector('.tls-dot').innerHTML = iconSvg(iconId, 15);
  item.querySelector('.tls-title').textContent = t.title;
  item.querySelector('.tls-sub').textContent = end ? `${t.time} – ${end} · ${t.dur}m` : t.time;
  if (t.note) item.querySelector('.tls-sub').textContent += '  ·  ' + t.note;
  const bullet = document.createElement('button');
  bullet.className = 'bullet';
  bullet.textContent = STATUS[t.status].sym;
  bullet.title = STATUS[t.status].label;
  bullet.onclick = e => { e.stopPropagation(); openStatusPopover(bullet, t); };
  item.querySelector('.tls-card').appendChild(bullet);
  item.querySelector('.tls-card').onclick = e => {
    e.stopPropagation();
    if (item.dataset.dragged) return; // 드래그 직후 클릭 무시
    openModal(t);
  };
  attachSeqDrag(item, t);
  return item;
}

/* ---------- 타임라인 드래그 (시간 변경) ----------
   마우스: 4px 이상 움직이면 드래그 시작
   터치: 250ms 길게 누르면 드래그. 그 전에 움직이면 드래그를 취소하고
   네이티브 스크롤(touch-action: pan-y)에 맡긴다 — 관성/바운스가 자연스럽고
   preventDefault는 드래그 중일 때만 제한적으로 사용.
   14px 이동 = 15분 (드래그 중 카드의 시간 라벨이 실시간 갱신) */
function attachSeqDrag(item, t) {
  let sy = 0, mode = null, timer = null, newMins = null;
  const origMins = timeToMins(t.time);
  const STEP_PX = 14, STEP_MIN = 15;
  const arm = () => {
    mode = 'drag';
    newMins = origMins;
    item.classList.add('dragging');
    try { navigator.vibrate && navigator.vibrate(15); } catch (e) {}
  };
  item.addEventListener('contextmenu', e => e.preventDefault());
  // 드래그 중일 때만 네이티브 스크롤 차단 (그 외에는 브라우저 기본 스크롤 그대로)
  item.addEventListener('touchmove', e => {
    if (mode === 'drag' && e.cancelable) e.preventDefault();
  }, { passive: false });
  item.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    sy = e.clientY; mode = 'wait';
    if (e.pointerType === 'mouse') mode = 'mouse-wait';
    else timer = setTimeout(arm, 250);
    try { item.setPointerCapture(e.pointerId); } catch (err) {}
  });
  item.addEventListener('pointermove', e => {
    if (!mode) return;
    const dy = e.clientY - sy;
    if (mode === 'mouse-wait' && Math.abs(dy) > 4) arm();
    else if (mode === 'wait' && Math.abs(dy) > 12) {
      // 길게 누르기 전에 움직임 → 드래그 취소, 네이티브 스크롤이 처리
      clearTimeout(timer);
      mode = null;
      return;
    }
    if (mode !== 'drag') return;
    const steps = Math.round(dy / STEP_PX);
    newMins = Math.max(0, Math.min(origMins + steps * STEP_MIN, 1425));
    item.style.transform = `translateY(${steps * STEP_PX}px)`;
    item.querySelector('.tls-time').textContent = minsToTime(newMins);
    const end = t.dur ? minsToTime(newMins + t.dur) : null;
    item.querySelector('.tls-sub').textContent = end ? `${minsToTime(newMins)} – ${end} · ${t.dur}m` : minsToTime(newMins);
  });
  const finish = () => {
    clearTimeout(timer);
    if (mode === 'drag') {
      item.classList.remove('dragging');
      item.style.transform = '';
      item.dataset.dragged = '1';
      setTimeout(() => { delete item.dataset.dragged; }, 0);
      const time = minsToTime(newMins);
      if (time !== t.time) {
        const real = t.virtual ? materialize(t) : t;
        real.time = time;
        save();
        render();
      }
    }
    mode = null;
  };
  item.addEventListener('pointerup', finish);
  item.addEventListener('pointercancel', () => {
    clearTimeout(timer);
    item.classList.remove('dragging');
    item.style.transform = '';
    mode = null;
  });
}

function renderInbox() {
  const el = $('#inbox-list');
  el.innerHTML = '';
  const list = tasks.filter(t => !t.repeat && !t.date && !t.hidden);
  const sortCtl = $('#inbox-sort');
  if (!list.length) {
    sortCtl.hidden = true;
    el.innerHTML = '<div class="empty-state">'
      + '<span class="empty-ico">' + iconSvg('ui-inbox', 26) + '</span>'
      + '<div class="empty-title">Inbox is clear</div>'
      + '<div class="empty-body">Tasks without a date will appear here.</div>'
      + '</div>';
    return;
  }
  sortCtl.hidden = false;
  $$('#inbox-sort button').forEach(b => b.classList.toggle('active', b.dataset.sort === inboxSort));
  list.sort((a, b) => inboxSort === 'recent'
    ? (b.createdAt || 0) - (a.createdAt || 0)
    : (a.createdAt || 0) - (b.createdAt || 0));
  list.forEach(t => el.appendChild(taskRow(t, { toToday: true })));
}

/* ---------- 검색 ---------- */
let searchQuery = '';
function renderSearch() {
  const el = $('#search-results');
  const q = searchQuery.toLowerCase();
  el.innerHTML = '';
  // 반복 템플릿 제외한 실제 기록(오늘 포함 과거·미래·인박스)을 제목/메모로 검색
  const hits = tasks.filter(t =>
    !t.repeat && !t.hidden &&
    (t.title.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q))
  ).sort((a, b) => (b.date || '9999').localeCompare(a.date || '9999'));

  const cnt = document.createElement('div');
  cnt.id = 'search-count';
  cnt.textContent = hits.length ? `${hits.length} found` : 'No results.';
  el.appendChild(cnt);

  const today = todayStr();
  for (const t of hits) {
    const row = document.createElement('div');
    row.className = 'day-row';
    const dateCell = document.createElement('div');
    dateCell.className = 'search-date';
    if (t.date) {
      const d = parseDate(t.date);
      const rel = t.date === today ? 'Today' : WEEKDAYS[d.getDay()];
      dateCell.innerHTML = `<b>${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}</b>${rel}`;
    } else {
      dateCell.innerHTML = '<b>' + iconSvg('ui-inbox', 14) + '</b>Inbox';
    }
    const sym = document.createElement('div');
    sym.className = 'search-sym st-' + t.status;
    sym.textContent = STATUS[t.status].sym;
    sym.title = STATUS[t.status].label;
    const info = document.createElement('div');
    info.className = 'info';
    info.style.color = 'var(--ink)';
    info.textContent = (t.emoji ? t.emoji + ' ' : '') + t.title + (t.note ? ' — ' + t.note : '');
    const cntCell = document.createElement('div');
    cntCell.className = 'cnt';
    cntCell.textContent = t.time || '';
    row.append(dateCell, sym, info, cntCell);
    row.onclick = () => {
      if (t.date) { cur = t.date; tab = 'today'; }
      else { tab = 'inbox'; }
      render();
    };
    el.appendChild(row);
  }
  // 반복 일정 이름이 걸리면 안내
  const tplHits = tasks.filter(t => t.repeat && t.title.toLowerCase().includes(q));
  if (tplHits.length) {
    const note = document.createElement('div');
    note.id = 'search-count';
    const label = { daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly' };
    note.textContent = '🔁 Repeating: ' + tplHits.map(t => `${t.title} (${label[t.repeat] || t.repeat}, since ${t.date})`).join(', ')
      + ' — only days where you changed its status appear in the list above.';
    el.appendChild(note);
  }
}

function renderMonth() {
  const searching = !!searchQuery.trim();
  $('#search-results').hidden = !searching;
  $('#search-clear').hidden = !searching;
  $('.month-nav').style.display = searching ? 'none' : '';
  $('#month-list').style.display = searching ? 'none' : '';
  if (searching) { renderSearch(); return; }
  const [y, m] = curMonth.split('-').map(Number);
  $('#month-label').textContent = `${MONTHS[m - 1]} ${y}`;
  const el = $('#month-list');
  el.innerHTML = '';
  const daysIn = new Date(y, m, 0).getDate();
  const today = todayStr();
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${y}-${pad(m)}-${pad(d)}`;
    const list = tasksForDay(ds);
    const info = days[ds] || {};
    if (!list.length && !info.mood && !info.diary && ds !== today) continue;
    const done = list.filter(t => t.status === 'done').length;
    const total = list.filter(t => t.status !== 'cancel').length;
    const row = document.createElement('div');
    row.className = 'day-row' + (ds === today ? ' today' : '');
    row.innerHTML = `<div class="d">${d}<small>${WEEKDAYS[parseDate(ds).getDay()]}</small></div>
      <div class="m"></div><div class="info"></div><div class="cnt"></div>`;
    row.querySelector('.m').textContent = info.mood || '';
    row.querySelector('.info').textContent = info.diary || (list[0] ? list[0].title + (list.length > 1 ? ` +${list.length - 1} more` : '') : '');
    const cnt = row.querySelector('.cnt');
    if (total) {
      cnt.textContent = `${done}/${total}`;
      if (done === total) cnt.classList.add('all-done');
    }
    row.onclick = () => { cur = ds; tab = 'today'; render(); };
    el.appendChild(row);
  }
  if (!el.children.length) el.innerHTML = '<div class="empty-note">No entries this month.</div>';
}

function renderSettings() {
  $('#set-font').value = settings.font;
  $('#set-size').value = settings.size;
  $('#set-theme').value = settings.theme;
  $('#set-notify').checked = settings.notify;
}

function applySettings() {
  document.documentElement.dataset.font = settings.font;
  document.documentElement.style.setProperty('--fs', settings.size + 'px');
  document.documentElement.style.setProperty('--fs-base', settings.size + 'px');
  const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/* ---------- 상태 팝오버 ---------- */
function openStatusPopover(anchor, item) {
  const pop = $('#popover');
  pop.innerHTML = '';
  for (const [key, s] of Object.entries(STATUS)) {
    const b = document.createElement('button');
    b.innerHTML = `${s.sym}<small>${s.label}</small>`;
    b.onclick = e => { e.stopPropagation(); pop.hidden = true; setStatus(item, key); };
    pop.appendChild(b);
  }
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  pop.style.left = Math.min(Math.max(r.left, 8), window.innerWidth - pw - 8) + 'px';
  pop.style.top = (r.bottom + 6 + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 6 : r.bottom + 6) + 'px';
}
document.addEventListener('pointerdown', e => {
  const pop = $('#popover');
  if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.bullet')) pop.hidden = true;
});

/* ---------- 모달 ---------- */
let fEmoji = '', fColor = COLORS[0];
function openModal(item, preset = {}) {
  editing = item;
  $('#modal-title').textContent = item ? 'Edit task' : 'New task';
  $('#f-title').value = item ? item.title : '';
  $('#f-date').value = item ? (item.date || '') : (preset.date !== undefined ? preset.date : (tab === 'inbox' ? '' : cur));
  $('#f-time').value = item ? (item.time || '') : (preset.time || '');
  $('#f-dur').value = item ? (item.dur || '') : (preset.time ? '60' : '');
  $('#f-repeat').value = item ? (item.repeat || '') : '';
  $('#f-repeat').disabled = !!(item && (item.tplId || item.repeatOf));
  $('#f-note').value = item ? (item.note || '') : '';
  fEmoji = item ? (resolveIcon(item.emoji) || '') : '';
  fColor = item ? (item.color || COLORS[0]) : COLORS[0];
  buildPicks();
  $('#btn-del').hidden = !item;
  $('#btn-del-series').hidden = !(item && (item.tplId || item.repeatOf));
  $('#modal').hidden = false;
  if (!item) $('#f-title').focus();
}
function closeModal() { $('#modal').hidden = true; editing = null; }

/* TaskIconPicker: 카테고리별 라인 아이콘 선택 */
function buildPicks() {
  const ep = $('#emoji-picks');
  ep.innerHTML = '';
  const mkBtn = icon => {
    const b = document.createElement('button');
    b.type = 'button';
    const val = icon.id === 'none' ? '' : icon.id;
    b.className = 'pick-btn' + (fEmoji === val ? ' sel' : '');
    b.title = icon.label;
    b.setAttribute('aria-label', icon.label);
    b.innerHTML = iconSvg(icon.id, 20);
    b.onclick = () => { fEmoji = val; buildPicks(); };
    return b;
  };
  const noneGrid = document.createElement('div');
  noneGrid.className = 'pick-grid';
  noneGrid.appendChild(mkBtn(TASK_ICONS[0]));
  ep.appendChild(noneGrid);
  for (const cat of ICON_CATEGORIES) {
    const icons = TASK_ICONS.filter(i => i.category === cat.id && i.id !== 'none');
    if (!icons.length) continue;
    const label = document.createElement('div');
    label.className = 'pick-cat';
    label.textContent = cat.label;
    ep.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'pick-grid';
    icons.forEach(i => grid.appendChild(mkBtn(i)));
    ep.appendChild(grid);
  }
  const cp = $('#color-picks');
  cp.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.style.background = c;
    b.classList.toggle('sel', c === fColor);
    b.onclick = () => { fColor = c; buildPicks(); };
    cp.appendChild(b);
  }
}

function saveModal() {
  const title = $('#f-title').value.trim();
  if (!title) { $('#f-title').focus(); return; }
  const fields = {
    title, emoji: fEmoji, color: fColor,
    date: $('#f-date').value || null,
    time: $('#f-time').value || null,
    dur: $('#f-dur').value ? Number($('#f-dur').value) : null,
    note: $('#f-note').value.trim() || null,
  };
  const repeat = $('#f-repeat').value || null;

  if (editing) {
    const t = editing.virtual ? materialize(editing) : editing;
    Object.assign(t, fields);
    if (!t.repeatOf && !t.repeat && repeat) { t.repeat = repeat; t.date = t.date || todayStr(); }
    else if (t.repeat) t.repeat = repeat || t.repeat;
  } else {
    const t = { id: uid(), ...fields, status: 'todo', createdAt: Date.now() };
    if (repeat) { t.repeat = repeat; t.date = t.date || todayStr(); }
    tasks.push(t);
  }
  save();
  closeModal();
  render();
}

function deleteEditing(series) {
  if (!editing) return;
  if (series) {
    const tplId = editing.tplId || editing.repeatOf;
    if (!confirm('Delete this entire repeating task?')) return;
    tasks = tasks.filter(t => t.id !== tplId && t.repeatOf !== tplId);
  } else if (editing.virtual) {
    const t = materialize(editing);
    t.hidden = true;
  } else {
    tasks = tasks.filter(t => t.id !== editing.id);
  }
  save();
  closeModal();
  render();
}

/* ---------- 이미지로 저장 (두잉두잉) ---------- */
function saveAsImage() {
  const list = tasksForDay(cur);
  const day = days[cur] || {};
  const d = parseDate(cur);
  const W = 720, pad_ = 46, lh = 52;
  const H = 210 + Math.max(list.length, 1) * lh + (day.diary ? 60 : 0) + 60;
  const cv = $('#snap-canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const dark = document.documentElement.dataset.theme === 'dark';
  ctx.fillStyle = dark ? '#171614' : '#f6f5f3';
  ctx.fillRect(0, 0, W, H);
  const ink = dark ? '#edeae4' : '#292723', ink2 = dark ? '#97928a' : '#8d897f';
  ctx.fillStyle = ink;
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(`${MONTHS[d.getMonth()]} ${d.getDate()} (${WEEKDAYS[d.getDay()]})`, pad_, 74);
  if (day.mood) { ctx.font = '38px sans-serif'; ctx.fillText(day.mood, W - pad_ - 44, 76); }
  ctx.strokeStyle = ink2; ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(pad_, 104); ctx.lineTo(W - pad_, 104); ctx.stroke();
  ctx.setLineDash([]);
  let y = 160;
  ctx.font = '26px sans-serif';
  if (!list.length) { ctx.fillStyle = ink2; ctx.fillText('No entries', pad_, y); y += lh; }
  const stColor = { todo: ink2, doing: '#4e80c9', done: '#3fa372', defer: '#d99a3d', cancel: ink2 };
  for (const t of list) {
    ctx.fillStyle = stColor[t.status];
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(STATUS[t.status].sym, pad_, y);
    ctx.fillStyle = (t.status === 'done' || t.status === 'cancel') ? ink2 : ink;
    ctx.font = '26px sans-serif';
    // 아이콘 id/구 이모지는 캔버스에 그리지 않음 (라인 아이콘은 텍스트로 표현 불가)
    const drawEmoji = t.emoji && !TASK_ICON_IDS.has(t.emoji) && !EMOJI_TO_ICON[t.emoji];
    const label = (t.time ? t.time + '  ' : '') + (drawEmoji ? t.emoji + ' ' : '') + t.title;
    ctx.fillText(label, pad_ + 44, y, W - pad_ * 2 - 44);
    if (t.status === 'done' || t.status === 'cancel') {
      const w = Math.min(ctx.measureText(label).width, W - pad_ * 2 - 44);
      ctx.strokeStyle = ink2; ctx.beginPath();
      ctx.moveTo(pad_ + 44, y - 9); ctx.lineTo(pad_ + 44 + w, y - 9); ctx.stroke();
    }
    y += lh;
  }
  if (day.diary) {
    y += 16;
    ctx.fillStyle = ink2; ctx.font = 'italic 24px sans-serif';
    ctx.fillText('“' + day.diary + '”', pad_, y, W - pad_ * 2);
    y += 40;
  }
  ctx.fillStyle = ink2; ctx.font = '18px sans-serif';
  ctx.fillText('HaruDoing', W - pad_ - 90, H - 26);
  const a = document.createElement('a');
  a.download = `HaruDoing_${cur}.png`;
  a.href = cv.toDataURL('image/png');
  a.click();
}

/* ---------- 백업 ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify({ tasks, days, settings, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.download = `HaruDoing_backup_${todayStr()}.json`;
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!Array.isArray(data.tasks)) throw new Error('bad format');
      if (!confirm(`Overwrite current data with this backup (${data.tasks.length} tasks)?`)) return;
      tasks = data.tasks; days = data.days || {}; settings = Object.assign(settings, data.settings || {});
      save(); applySettings(); render();
      alert('Import complete!');
    } catch (e) { alert('Import failed: not a valid backup file.'); }
  };
  r.readAsText(file);
}

/* ---------- 배지 / 위젯 / 알림 ---------- */
function updateBadge() {
  try {
    if (!('setAppBadge' in navigator)) return;
    const n = tasksForDay(todayStr()).filter(t => t.status === 'todo' || t.status === 'doing').length;
    n ? navigator.setAppBadge(n) : navigator.clearAppBadge();
  } catch (e) {}
}

async function updateWidgetData() {
  try {
    const list = tasksForDay(todayStr());
    const day = days[todayStr()] || {};
    const data = {
      date: todayStr(), mood: day.mood || '',
      remaining: list.filter(t => t.status === 'todo' || t.status === 'doing').length,
      items: list.slice(0, 6).map(t => ({
        sym: STATUS[t.status].sym,
        text: (t.time ? t.time + ' ' : '') + (t.emoji ? t.emoji + ' ' : '') + t.title,
      })),
    };
    const c = await caches.open('hd-widget');
    await c.put('widgets/today-data.json', new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
    navigator.serviceWorker?.controller?.postMessage({ type: 'widget-update' });
  } catch (e) {}
}

function checkNotifications() {
  if (!settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  for (const t of tasksForDay(todayStr())) {
    if (t.time === hm && t.status === 'todo' && !notified.has(t.id)) {
      notified.add(t.id);
      try { new Notification('⏰ ' + (t.emoji ? t.emoji + ' ' : '') + t.title, { body: "It's time!", icon: 'icons/icon-192.png' }); } catch (e) {}
    }
  }
}

/* ---------- 이벤트 바인딩 ---------- */
function shiftDay(n) {
  const d = parseDate(cur);
  d.setDate(d.getDate() + n);
  cur = fmt(d);
  render();
}

function bind() {
  $('#btn-prev').onclick = () => shiftDay(-1);
  $('#btn-next').onclick = () => shiftDay(1);
  $('#btn-today').onclick = () => { cur = todayStr(); render(); };
  $('#btn-date').onclick = () => { cur = todayStr(); render(); };
  $$('#view-seg button').forEach(b => b.onclick = () => {
    if (settings.view === b.dataset.view) return;
    settings.view = b.dataset.view;
    tlScrollKey = ''; // 뷰를 다시 켜면 현재 시각으로 한 번 스크롤
    save();
    render();
  });
  $$('#inbox-sort button').forEach(b => b.onclick = () => {
    if (inboxSort === b.dataset.sort) return;
    inboxSort = b.dataset.sort;
    renderInbox();
  });
  // Today 화면 좌우 스와이프로 날짜 이동 (왼→오 = 전날, 오→왼 = 다음날)
  let swX = null, swY = null;
  const todaySec = $('#tab-today');
  todaySec.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    swX = e.touches[0].clientX;
    swY = e.touches[0].clientY;
  }, { passive: true });
  todaySec.addEventListener('touchend', e => {
    if (swX === null) return;
    const dx = e.changedTouches[0].clientX - swX;
    const dy = e.changedTouches[0].clientY - swY;
    swX = swY = null;
    if (!$('#modal').hidden || !$('#move-modal').hidden) return;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      shiftDay(dx > 0 ? -1 : 1);
    }
  }, { passive: true });
  $('#btn-snap').onclick = saveAsImage;
  $('#diary-input').addEventListener('change', e => {
    days[cur] = days[cur] || {};
    days[cur].diary = e.target.value.trim();
    save();
  });
  $$('#tabbar button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  $('#fab').onclick = () => openModal(null, tab === 'inbox' ? { date: '' } : {});
  $('#btn-save').onclick = saveModal;
  $('#btn-cancel').onclick = closeModal;
  $('#btn-del').onclick = () => deleteEditing(false);
  $('#btn-del-series').onclick = () => deleteEditing(true);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('#mv-tomorrow').onclick = () => {
    const d = parseDate(moveTask.date);
    d.setDate(d.getDate() + 1);
    moveCopy(fmt(d));
  };
  $('#mv-pick').onclick = () => { $('#mv-pick').hidden = true; $('#mv-date-row').hidden = false; };
  $('#mv-date-go').onclick = () => moveCopy($('#mv-date').value);
  $('#mv-ok').onclick = closeMoveDialog;
  $('#move-modal').addEventListener('click', e => { if (e.target.id === 'move-modal') closeMoveDialog(); });
  $('#f-title').addEventListener('keydown', e => { if (e.key === 'Enter') saveModal(); });

  $('#search-input').addEventListener('input', e => { searchQuery = e.target.value; renderMonth(); });
  $('#search-clear').onclick = () => { searchQuery = ''; $('#search-input').value = ''; renderMonth(); };
  $('#btn-mprev').onclick = () => { const [y, m] = curMonth.split('-').map(Number); curMonth = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; render(); };
  $('#btn-mnext').onclick = () => { const [y, m] = curMonth.split('-').map(Number); curMonth = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; render(); };

  $('#set-font').onchange = e => { settings.font = e.target.value; save(); applySettings(); };
  $('#set-size').oninput = e => { settings.size = Number(e.target.value); save(); applySettings(); };
  $('#set-theme').onchange = e => { settings.theme = e.target.value; save(); applySettings(); };
  $('#set-notify').onchange = async e => {
    if (e.target.checked && 'Notification' in window) {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { e.target.checked = false; return; }
    }
    settings.notify = e.target.checked;
    save();
  };
  $('#btn-export').onclick = exportData;
  $('#btn-import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; };
  $('#btn-wipe').onclick = () => {
    if (!confirm('Really delete ALL data? This cannot be undone.')) return;
    localStorage.removeItem('hd.tasks');
    localStorage.removeItem('hd.days');
    location.reload();
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);
  // 다른 탭/창에서 데이터가 바뀌면 다시 불러오기
  window.addEventListener('storage', () => { load(); applySettings(); render(); });
}

/* ---------- 시작 ---------- */
function hydrateUiIcons() {
  $$('[data-ui-icon]').forEach(el => {
    el.innerHTML = iconSvg(el.dataset.uiIcon, Number(el.dataset.size) || 20);
  });
}

function init() {
  load();
  applySettings();
  hydrateUiIcons();
  bind();
  carryOver();
  // 앱 바로가기(manifest shortcuts) 처리
  const q = new URLSearchParams(location.search);
  if (q.get('tab') === 'inbox') tab = 'inbox';
  render();
  if (q.get('action') === 'add') openModal(null, {});
  updateBadge();
  updateWidgetData();
  setInterval(checkNotifications, 30000);
  setInterval(() => {
    // 자정 넘어가면 이월 처리 + 오늘 갱신
    if (tab === 'today' && cur === todayStr() && settings.view === 'timeline') renderToday();
    carryOver() && render();
  }, 60000);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW 등록 실패', e));
  }
}
init();
