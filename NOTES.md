# HaruDoing — 개발 인수인계 노트

개인용 데일리 플래너 PWA. 두잉두잉(불렛저널 투두) + Structured(타임라인) 스타일.
**다음 코워크 세션에서 이 파일을 먼저 읽으면 앱 구조를 바로 파악할 수 있습니다.**

> 새 세션 시작 멘트 예시: *"haru-doing 폴더의 앱을 이어서 수정하고 싶어. 먼저 NOTES.md를 읽어줘."*

---

## 1. 한 줄 요약
순수 정적 웹앱(빌드 도구 없음). HTML/CSS/JS만으로 동작하며 데이터는 브라우저 `localStorage`에만 저장. 오프라인 PWA로 폰 홈 화면에 설치 가능.

## 2. 파일 구조
| 파일 | 역할 |
|---|---|
| `index.html` | 앱 마크업(셸). 모든 화면 요소가 여기 있고 JS가 채움 |
| `app.js` | 모든 로직 (렌더링, 상태관리, 이벤트) |
| `style.css` | 모든 스타일 (디자인 토큰, 상태별 카드, 다크모드) |
| `icons.js` | `TASK_ICONS` 레지스트리 + `EMOJI_TO_ICON` fallback + `IconBadge`/`resolveIcon`/`iconSvg` 헬퍼 |
| `icons-data.js` | Lucide 라인 아이콘 SVG 69개 (PowerShell로 unpkg에서 생성한 데이터. 손으로 편집 X) |
| `work.js` | 출퇴근 기록 + 월별 근무 리포트 (app.js와 분리된 근무 로직 전체) |
| `sw.js` | 서비스 워커: 오프라인 캐시 + Windows 11 Edge 위젯 |
| `manifest.webmanifest` | PWA 설정 (이름 HaruDoing, 홈화면 아이콘, 바로가기, 위젯) |
| `scriptable-widget.js` | iOS Scriptable 위젯 스크립트 (아이폰은 네이티브 위젯 불가라 우회) |
| `serve.ps1` / `Start-HaruDoing.bat` | 로컬 실행용 PowerShell 서버 (localhost:8321). 온라인 배포엔 불필요 |
| `icons/` | icon-192.png, icon-512.png (앱 아이콘) |
| `widgets/` | today-card.json(Adaptive Card 템플릿), today-data.json(데이터) |

로드 순서: `icons-data.js` → `icons.js` → `app.js` (index.html 하단).

## 3. 데이터 모델 (localStorage)
- `hd.tasks` — 할 일 배열
- `hd.days` — `{ 'YYYY-MM-DD': { mood, diary } }`
- `hd.settings` — `{ font, size, theme, notify, view }`
- `hd.work` — 출퇴근 기록 (work.js 전용): `{ 'YYYY-MM-DD': { seg:[{s:'08:00', e:'17:00'|null}], home, type:'work|vacation|holiday|sick', note, entry:{s,e}(회사입력 수동 오버라이드), entered(입력완료 체크) } }`
- `hd.workSettings` — `{ base:[요일별 기준 분, getDay 인덱스], lunch:30, cap:120, opening(초기 잔고 분), openingMonth, autoFill }`

### task 객체 필드
```
id          고유 id
title       제목 (사용자 입력, 어떤 언어든 OK)
emoji       아이콘 id (예: 'coffee') 또는 예전 이모지(💼). resolveIcon()으로 해석
color       왼쪽 액센트 바 + 아이콘 틴트 색 (COLORS 팔레트)
note        메모
date        'YYYY-MM-DD' 또는 null(=인박스)
time        'HH:MM' 또는 null
dur         소요시간(분) 또는 null
status      todo | doing | done | defer | cancel
repeat      daily | weekdays | weekly (반복 템플릿) 또는 null
repeatOf    반복 템플릿의 id (구체화된 인스턴스)
carried     이월 처리됨 표시
carriedFrom 이월 원본 날짜
hidden      반복 인스턴스 소프트 삭제
important   (휴면) 스타일 훅. 설정 UI 없음. true면 코랄 바 + 별
createdAt   생성 시각 (인박스 정렬에 사용)
```

## 4. 핵심 동작 (건드릴 때 주의)
- **반복 일정**: 템플릿 1개 + `tasksForDay()`가 가상 인스턴스 생성. 상태 바꾸면 `materialize()`로 실제 레코드화
- **자동 이월(carryOver)**: 지난 날짜의 `doing`/`defer` 할 일을 오늘로 복사
- **이동 다이얼로그**: `doing`/`defer` 선택 시 "내일로 / 날짜 선택" 팝업
- **타임라인 = Structured식 순차 레이아웃** (`renderTimelineView`/`seqCard`): 24시간 고정 그리드가 아니라 task 수만큼 늘어나는 카드 목록. 겹침 없음, 빈 시간은 점선 커넥터(45분 이상이면 `07:10 – 23:00` 라벨, 클릭하면 그 시간으로 새 task). 카드에 시작–끝 시간 표기
- **타임라인 드래그**(`attachSeqDrag`): 카드를 길게 눌러(터치 250ms, 마우스 즉시) 위아래로 끌면 14px당 15분씩 시간 변경, 시간 라벨 실시간 갱신
- **스와이프 날짜 이동**: Today 화면에서 왼쪽 스와이프=전날, 오른쪽=다음날 (사용자 지정 방향)
- **Next up**: 오늘 화면 상단, 아직 안 끝난 가장 이른 일정 강조 (`nextUpcomingTask()` — 타임라인 NEXT 강조와 로직 공유)

## 5. 화면(탭) 구조 — 절대 임의로 바꾸지 말 것
`Today` / `Inbox` / `All`(월별+검색) / `Settings` — 4탭 고정.
탭 전환은 `render()`가 섹션 hidden 토글로 처리 (SPA, 페이지 이동 없음).

## 6. 디자인 토큰 (style.css `:root`)
- **60/30/10 원칙**: 60% 배경 `#f6f5f3` / 30% 흰 카드 / 10% 코랄 강조 `#e05b3c`
- 주요 변수: `--bg --card --ink --ink2 --line --accent --accent-soft --accent-ink`
- 상태색: `--done #3fa372 --doing #4e80c9 --defer #d99a3d --cancel`
- **다크모드**: `[data-theme="dark"]`에서 전부 재정의. 새 색은 반드시 변수로 (하드코딩 hex 금지)
- **폰트**: Nunito (둥근 기하 산세리프). 설정에 손글씨 3종 옵션
- **아이콘**: Lucide 라인 아이콘 한 패밀리로 통일 (stroke 2, round). 이모지 아이콘 쓰지 말 것 (기분 mood 이모지만 예외)
- 카드: 14px 라운드, 부드러운 그림자. 인라인 `--tcolor`(태스크 색)를 border-left에 사용

### 카드 상태 (task-row 클래스)
`sched`(예정: 흰 카드+그림자+시간칩) / `unsched`(미예정: 가벼움) / `st-done`·`st-cancel`(완료: 평평+회색 바+취소선) / `important`(휴면)

## 7. 규칙 (지금까지 지켜온 것)
- **UI 텍스트는 영어만**. 사용자가 입력하는 데이터는 어떤 언어든 OK
- 기능/구조/데이터 저장 방식은 요청 없이 바꾸지 않기
- 빌드/린트 도구 없음 → **브라우저 프리뷰 실행 + eval로 검증**하고 콘솔 오류 0 확인
- 시간 입력이 "오전 09:30"처럼 보이는 건 네이티브 `<input type=time>`의 로케일 표시라 못 바꿈(정상)

## 8. 배포 (GitHub Pages)
- 저장소: `nij-621/haru-doing` (Public) → 공개되는 건 코드뿐, **할 일 데이터는 폰/PC에만 저장**
- 공개 URL: https://nij-621.github.io/haru-doing/
- **업데이트 방법**: GitHub에서 Add file → Upload files → 바뀐 파일 드래그(같은 이름은 자동 교체) → Commit changes → 1~2분 뒤 반영
- **폰 반영**: 앱을 완전히 종료 후 다시 열기. 안 되면 한 번 더 (서비스워커 캐시 때문)
- ⚠️ **셸 파일(html/css/js) 수정 후엔 `sw.js`의 `CACHE` 상수 버전을 올리면**(예: hd-shell-v2 → v3) 폰에서 새 버전이 더 확실히 적용됨

## 9. 로컬 실행/테스트
- `Start-HaruDoing.bat` 더블클릭 또는 `serve.ps1` 실행 → http://localhost:8321
- Node/Python 불필요 (PowerShell `HttpListener` 사용)

## 10. 아이콘 추가하려면
1. `icons.js`의 `TASK_ICONS` 배열에 `{ id, label, category }` 추가
2. `icons-data.js`에 해당 Lucide SVG 데이터 추가 — Lucide 아이콘 이름을 골라 `https://unpkg.com/lucide-static@latest/icons/<name>.svg`에서 내부 path만 넣기 (기존 생성 스크립트 방식 참고)
3. 필요하면 `EMOJI_TO_ICON`에 옛 이모지 매핑 추가

## 11. 백로그 (검토 완료, 미진행 — Emil 디자인 리뷰 2·3순위)
`.claude/skills/emil-design-eng` 스킬 기준으로 리뷰한 결과. 1순위(버그 4건)는 이력 18번에서 완료.

**2순위 — 등장 애니메이션 (현재 모달·팝오버가 hidden 토글로 즉시 등장):**
- New task 바텀시트: translateY(100%)→0, 300~350ms, drawer 커브 `cubic-bezier(0.32,0.72,0,1)` + dim 페이드
- 상태 팝오버: scale(0.95)+opacity, 150ms ease-out, transform-origin을 불렛 위치로
- Move 다이얼로그: scale(0.96)+opacity, 200ms ease-out, origin 중앙 유지 (모달은 예외)
- 커스텀 이징 토큰 추가: `--ease-out: cubic-bezier(0.23,1,0.32,1)` / 전부 300ms 이하
- `prefers-reduced-motion` 대응 (움직임 제거, opacity만)
- 주의: 탭 전환·날짜 스와이프는 하루 수십 번 쓰므로 애니메이션 넣지 말 것 (Emil 빈도 프레임워크)

**3순위 — 선택:**
- 드래그 놓을 때 카드가 새 위치로 200ms ease-out 스냅 (지금은 순간이동)
- 타임라인 카드 불렛(오른쪽)이 화면 하단에서 FAB에 가려짐 — 여백 or 불렛 위치 재검토 (리스트 뷰는 왼쪽 불렛이라 일관성 이슈)
- 완료 시 불렛 체크 마이크로 피드백 (아주 절제해서)

## 12. 지금까지의 작업 이력 (이 세션에서 만든 것)
1. 앱 기본 구축: Today(리스트/타임라인)·Inbox·All·Settings, 기분/한줄일기, 이미지 저장, 백업(내보내기/가져오기)
2. All 탭에 할 일 검색 (과거에 언제 했는지 찾기)
3. GitHub Pages 배포 + 폰 홈화면 설치
4. 전체 영어화 (HaruDoing)
5. 타임라인 드래그 앤 드롭으로 시간 변경
6. Doing/Defer 시 이동 다이얼로그
7. iOS Scriptable 위젯
8. 비주얼 리스킨 (코랄 팔레트 + Nunito, 60/30/10)
9. Lucide 라인 아이콘 시스템 통일
10. Today "Next up" 섹션
11. List/Timeline 세그먼트 컨트롤
12. 타임라인 강화 (현재 시각 칩, 지난 시간 음영, NEXT 강조)
13. 작업 카드 상태 구분 (예정/미예정/완료/중요)
14. New Task 시트 계층 개선 (Date/Time을 위로, Icon/Color를 아래 2차 영역으로)
15. Inbox 폴리시 (빈 상태 "Inbox is clear", Recent/Oldest 정렬)
16. 타임라인을 Structured식 순차 레이아웃으로 전면 교체 (겹침 없음, 빈 시간 압축, 시작–끝 시간 표기) + 스와이프 날짜 이동 + cooking/vacuum 아이콘 + FAB 중앙정렬 + 모바일 버튼 확대 (sw 캐시 v3)
17. chef-hat 아이콘, 날짜 2줄 위계(큰 날짜 + 작은 요일·Today 강조), 🥱 Tired 기분 추가, 타임라인 스크롤을 네이티브로 복원(touch-action pan-y, preventDefault는 드래그 중에만) + 자동 스크롤은 날짜/뷰 변경 첫 렌더에만 (sw 캐시 v4)
18. Emil 디자인 리뷰 1순위 수정: All 탭 아이콘 id 텍스트 노출 버그, 기분 없는 날 '·' 제거, iOS에서 이모지로 렌더되는 글리프(↕ ✎) 제거, 알림 토글을 iOS식 스위치로 (sw 캐시 v5). 프로젝트 폴더가 "Claude 작업실\haru-doing"으로 이동됨 — launch.json 경로도 갱신
19. **출퇴근 기록 + 월별 근무 리포트** (`work.js` 신규, sw 캐시 v6). 회사 근태 입력 프로세스 자동화용:
    - Today 탭 펀치 카드: Start/End work 버튼(하루 여러 구간 가능), Home office 스위치, 실시간 순근무·당일±·당월± 표시, 어제 퇴근 누락 경고
    - 하루 편집 모달(`#work-modal`): 구간 추가/수정/삭제, Day type(Work/Vacation/Holiday/Sick), 회사입력 수동 오버라이드, 메모(출장지)
    - Work report 오버레이(`#work-report`): 월별 Days/Entry 뷰, 요약 4종(Worked/target, Actual·Entered overtime, Left overtime), 기록 없는 평일 경고, CSV 내보내기
    - **계산 규칙**: 순근무 = 구간 합 − 점심 30분(구간 사이 30분+ 공백이 있으면 공제 안 함 — 공백이 곧 점심. **6시간 이하 근무일도 공제 없음** — AZG 휴게 의무가 6시간 초과부터라 회사 시스템도 동일, 사용자 확인. Entry 블록도 6시간 초과일 때만 +점심을 더해 구성). 기준 월–목 8h·금 6.5h. Entry 추천 = 하루 한 블록, 종료 = 시작 + 순근무 + 점심(회사 시스템이 공제), 15분 반올림, 초과근무 상한 +2h, 상한 초과분·반올림 차이는 Left overtime 잔고로 순차 적립. autoFill 켜면 부족한 날을 잔고에서 채움(퇴근 전인 오늘은 제외). 초기 잔고/기산월은 Settings의 Work tracking에서 입력
    - app.js 훅 4곳만 수정: renderToday 끝에서 renderWorkCard 호출, 백업 내보내기/가져오기에 work 데이터 포함, 전체 삭제에 hd.work 키 포함. 나머지 로직은 전부 work.js에 격리
