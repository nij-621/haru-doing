// HaruDoing — Today widget for Scriptable (iOS)
// ─────────────────────────────────────────────
// 설치 방법:
// 1) HaruDoing 앱: Settings → Export data (backup)
//    → 다운로드된 파일을 "파일에 저장" → iCloud Drive → Scriptable 폴더
// 2) Scriptable 앱에서 새 스크립트 만들고 이 코드 전체를 붙여넣기, 이름 "HaruDoing"
// 3) 홈 화면 길게 누르기 → 위젯 추가 → Scriptable → 크기 선택
//    → 위젯 길게 누르기 → "위젯 편집" → Script: HaruDoing 선택
// 위젯 데이터를 갱신하려면 앱에서 Export를 다시 해서 같은 폴더에 저장하면 됩니다.
// (파일 이름이 바뀌어도 가장 최신 백업을 자동으로 찾습니다)

const APP_URL = "https://nij-621.github.io/haru-doing/";

const C = {
  bg:    Color.dynamic(new Color("#f6f5f3"), new Color("#171614")),
  ink:   Color.dynamic(new Color("#292723"), new Color("#edeae4")),
  ink2:  Color.dynamic(new Color("#8d897f"), new Color("#97928a")),
  accent: new Color("#e05b3c"),
  done:  new Color("#3fa372"),
  doing: new Color("#4e80c9"),
  defer: new Color("#d99a3d"),
};
const SYM = { todo: "○", doing: "◐", done: "✓", defer: "→", cancel: "✕" };
const SYMCOLOR = { todo: C.ink2, doing: C.doing, done: C.done, defer: C.defer, cancel: C.ink2 };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const pad = n => String(n).padStart(2, "0");
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

// ── 백업 파일 찾기 (여러 위치에서 가장 최근 것) ──
// 검색 순서: ① "HaruDoing" 폴더 북마크(Downloads 등 원하는 폴더)
//            ② iCloud Drive/Scriptable   ③ On My iPhone/Scriptable
// 참고: 아직 기기에 내려받지 않은 iCloud 파일은 목록에서
//       ".이름.json.icloud" 형태로 보이므로 그것도 처리한다.
function realName(f) {
  return (f.startsWith(".") && f.endsWith(".icloud")) ? f.slice(1, -7) : f;
}
function collectBackups(fm, dir, isICloud, out) {
  try {
    if (!fm.isDirectory(dir)) {
      if (/\.json(\.icloud)?$/i.test(dir)) out.push({ fm, path: dir, isICloud, named: true, mtime: safeMtime(fm, dir) });
      return;
    }
    for (const f of fm.listContents(dir)) {
      const name = realName(f);
      if (!/\.json$/i.test(name)) continue;
      const named = /harudoing/i.test(name); // HaruDoing 이름이 붙은 백업 우선
      const p = fm.joinPath(dir, name);
      let mtime = safeMtime(fm, p) || safeMtime(fm, fm.joinPath(dir, f));
      out.push({ fm, path: p, isICloud, named, mtime: mtime || new Date(0) });
    }
  } catch (e) {}
}
function safeMtime(fm, p) {
  try { return fm.modificationDate(p); } catch (e) { return null; }
}

async function loadBackup() {
  const out = [];
  const icloud = FileManager.iCloud();
  const local = FileManager.local();
  // ① Scriptable 설정 → File Bookmarks 에 "HaruDoing"으로 등록한 폴더/파일
  try {
    if (icloud.bookmarkExists("HaruDoing")) collectBackups(icloud, icloud.bookmarkedPath("HaruDoing"), true, out);
  } catch (e) {}
  // ② iCloud Drive/Scriptable
  collectBackups(icloud, icloud.documentsDirectory(), true, out);
  // ③ On My iPhone/Scriptable
  collectBackups(local, local.documentsDirectory(), false, out);
  // HaruDoing 이름이 붙은 파일 우선, 그 안에서 최신순.
  // 이름이 바뀐 경우를 대비해 다른 .json도 후순위로 시도한다.
  out.sort((a, b) => (b.named - a.named) || (b.mtime - a.mtime));
  for (const cand of out) {
    try {
      if (cand.isICloud) { try { await cand.fm.downloadFileFromiCloud(cand.path); } catch (e) {} }
      const raw = cand.fm.readString(cand.path);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (!Array.isArray(data.tasks)) continue; // 하루두잉 백업이 맞는지 확인
      data._file = cand.path.split("/").pop();
      data._modified = cand.mtime;
      return data;
    } catch (e) {}
  }
  return null;
}

// ── 앱과 동일한 로직으로 오늘 할 일 계산 ──
function repeatMatches(tpl, dateStr) {
  if (!tpl.date || dateStr < tpl.date) return false;
  const d = parseDate(dateStr), t = parseDate(tpl.date);
  if (tpl.repeat === "daily") return true;
  if (tpl.repeat === "weekdays") return d.getDay() >= 1 && d.getDay() <= 5;
  if (tpl.repeat === "weekly") return d.getDay() === t.getDay();
  return false;
}
function tasksForDay(tasks, dateStr) {
  const out = tasks.filter(t => !t.repeat && t.date === dateStr && !t.hidden);
  for (const tpl of tasks.filter(t => t.repeat)) {
    if (!repeatMatches(tpl, dateStr)) continue;
    if (tasks.some(o => o.repeatOf === tpl.id && o.date === dateStr)) continue;
    out.push({ title: tpl.title, emoji: tpl.emoji, time: tpl.time, status: "todo" });
  }
  out.sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99") || ((a.createdAt || 0) - (b.createdAt || 0)));
  return out;
}

// ── 위젯 구성 ──
function taskRow(w, t, size) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const sym = row.addText(SYM[t.status] || "○");
  sym.font = Font.boldRoundedSystemFont(size);
  sym.textColor = SYMCOLOR[t.status] || C.ink2;
  row.addSpacer(6);
  const doneish = t.status === "done" || t.status === "cancel";
  // 앱이 라인 아이콘 id(예: 'work')를 저장하는 경우는 표시 생략, 진짜 이모지만 표시
  const emoji = t.emoji && !/^[a-z][a-z0-9-]*$/.test(t.emoji) ? t.emoji + " " : "";
  const title = row.addText(emoji + t.title);
  title.font = doneish ? Font.regularRoundedSystemFont(size) : Font.mediumRoundedSystemFont(size);
  title.textColor = doneish ? C.ink2 : C.ink;
  title.lineLimit = 1;
  row.addSpacer();
  if (t.time) {
    const tm = row.addText(t.time);
    tm.font = Font.boldRoundedSystemFont(size - 2);
    tm.textColor = C.ink2;
  }
}

async function makeWidget() {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  w.setPadding(14, 16, 12, 16);

  let data = null;
  try { data = await loadBackup(); } catch (e) {}

  if (!data || !Array.isArray(data.tasks)) {
    const t1 = w.addText("HaruDoing");
    t1.font = Font.boldRoundedSystemFont(16);
    t1.textColor = C.accent;
    w.addSpacer(6);
    const t2 = w.addText("백업 파일을 찾지 못했어요.\n앱 Settings → Export data 후\n'파일에 저장'으로 아래 중 한 곳에:\n· iCloud Drive/Scriptable\n· 원하는 폴더 + 북마크 'HaruDoing'");
    t2.font = Font.regularRoundedSystemFont(11);
    t2.textColor = C.ink2;
    return w;
  }

  const now = new Date();
  const today = fmt(now);
  const list = tasksForDay(data.tasks, today);
  const dayInfo = (data.days || {})[today] || {};
  const remaining = list.filter(t => t.status === "todo" || t.status === "doing").length;
  const fam = config.widgetFamily || "medium";

  // ── 헤더: 날짜 + 기분 + 남은 개수 ──
  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const dateTxt = head.addText(`${MONTHS[now.getMonth()]} ${now.getDate()} (${WEEKDAYS[now.getDay()]})`);
  dateTxt.font = Font.heavyRoundedSystemFont(fam === "small" ? 13 : 15);
  dateTxt.textColor = C.ink;
  if (dayInfo.mood) {
    head.addSpacer(5);
    const mood = head.addText(dayInfo.mood);
    mood.font = Font.systemFont(fam === "small" ? 13 : 15);
  }
  head.addSpacer();
  if (fam !== "small") {
    const badge = head.addText(remaining > 0 ? `${remaining} left` : "All done 🎉");
    badge.font = Font.boldRoundedSystemFont(12);
    badge.textColor = remaining > 0 ? C.accent : C.done;
  }

  if (fam === "small") {
    // 작은 위젯: 남은 개수 크게
    w.addSpacer();
    const big = w.addText(remaining > 0 ? String(remaining) : "✓");
    big.font = Font.heavyRoundedSystemFont(40);
    big.textColor = remaining > 0 ? C.accent : C.done;
    const sub = w.addText(remaining > 0 ? (remaining === 1 ? "task left" : "tasks left") : "all done!");
    sub.font = Font.boldRoundedSystemFont(12);
    sub.textColor = C.ink2;
    w.addSpacer();
  } else {
    // 중간/큰 위젯: 할 일 목록
    w.addSpacer(8);
    const max = fam === "large" ? 9 : 4;
    // 안 끝난 일 먼저, 끝난 일은 뒤로
    const sorted = [...list.filter(t => t.status === "todo" || t.status === "doing"),
                    ...list.filter(t => t.status !== "todo" && t.status !== "doing")];
    if (!sorted.length) {
      w.addSpacer(4);
      const empty = w.addText("No tasks today ✎");
      empty.font = Font.regularRoundedSystemFont(13);
      empty.textColor = C.ink2;
    }
    for (const t of sorted.slice(0, max)) {
      taskRow(w, t, fam === "large" ? 13 : 13);
      w.addSpacer(fam === "large" ? 5 : 4);
    }
    if (sorted.length > max) {
      const more = w.addText(`+${sorted.length - max} more`);
      more.font = Font.boldRoundedSystemFont(11);
      more.textColor = C.ink2;
    }
    w.addSpacer();
    // 푸터: 마지막 Export 시각
    const m = data._modified;
    const foot = w.addText(`updated ${MONTHS[m.getMonth()]} ${m.getDate()} ${pad(m.getHours())}:${pad(m.getMinutes())}`);
    foot.font = Font.regularRoundedSystemFont(9);
    foot.textColor = C.ink2;
  }
  return w;
}

const widget = await makeWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
