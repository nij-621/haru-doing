# HaruDoing

개인용 데일리 플래너 PWA. 두잉두잉(불렛저널 투두: 완료/진행중/연기/취소 상태, 자동 이월, 기분+한줄일기)과 Structured(순차 타임라인, 시간 블록, 아이콘)를 합친 앱.
사용자 1명(제작자 본인)만 쓰는 앱이며, 폰 홈 화면에 설치해 사용한다.

상세 문서: **작업 전 `NOTES.md`를 먼저 읽을 것** (데이터 모델, 핵심 동작, 디자인 토큰, 작업 이력).

## 기술 스택

- **순수 정적 웹앱**: HTML + CSS + Vanilla JS. 빌드 도구/프레임워크/npm 없음
- **PWA**: 서비스 워커 오프라인 캐시(`sw.js`), 매니페스트, 홈 화면 설치
- **데이터**: `localStorage`만 사용 (`hd.tasks`, `hd.days`, `hd.settings`) — 서버 없음
- **아이콘**: Lucide 라인 아이콘을 인라인 SVG 데이터로 내장 (`icons-data.js`, CDN 런타임 의존 없음)
- **폰트**: Google Fonts (Nunito + 손글씨 옵션 3종)
- **배포**: GitHub Pages (`nij-621/haru-doing` → https://nij-621.github.io/haru-doing/), 파일 업로드로 갱신
- **로컬 실행**: `serve.ps1` (PowerShell HttpListener, localhost:8321) — Node/Python 불필요

## 폴더 구조

```
haru-doing/
├─ index.html            앱 셸 마크업 (4개 탭 섹션 + 모달들)
├─ app.js                모든 로직: 렌더링·상태·이벤트 (탭 전환은 hidden 토글, SPA)
├─ style.css             모든 스타일 (:root 디자인 토큰, [data-theme=dark] 다크모드)
├─ icons.js              TASK_ICONS 레지스트리 + resolveIcon/iconSvg/IconBadge 헬퍼
├─ icons-data.js         Lucide SVG 데이터 (생성 파일 — 손으로 편집하지 말 것)
├─ sw.js                 서비스 워커 (캐시 상수 CACHE 버전 관리)
├─ manifest.webmanifest  PWA 설정 (이름·아이콘·바로가기·Windows 위젯)
├─ scriptable-widget.js  iOS Scriptable 위젯 (앱과 별개 실행 환경)
├─ serve.ps1 / Start-HaruDoing.bat  로컬 서버 (배포와 무관)
├─ icons/                앱 아이콘 PNG (192/512)
├─ widgets/              Windows 11 위젯 템플릿/데이터
├─ NOTES.md              개발 인수인계 문서 (데이터 모델·동작·이력)
└─ CLAUDE.md             이 파일
```

## 작업 규칙

1. **한 번에 한 가지만 수정한다.**
2. **수정 후 기존 기능이 깨지지 않았는지 확인한다.** — 빌드/린트 도구가 없으므로 브라우저 프리뷰(launch.json의 `haru-doing` 서버)를 띄워 실제 실행 + 콘솔 오류 0 확인으로 검증한다.
3. **사용자가 요청하지 않은 파일은 수정하지 않는다.**

### 기존 컨벤션 (지금까지 지켜온 것)

- UI 텍스트는 **영어만**. 사용자가 입력하는 데이터(할 일 제목 등)는 어떤 언어든 허용
- 탭 구조(Today/Inbox/All/Settings)·데이터 저장 방식·기능은 요청 없이 바꾸지 않는다
- 색상은 하드코딩하지 말고 CSS 변수 사용 (다크모드 자동 대응). 60/30/10 원칙: 배경 60 / 흰 카드 30 / 코랄 `--accent` 강조 10
- 앱 UI에 이모지 아이콘 금지 — Lucide 라인 아이콘으로 통일 (기분 mood 이모지만 예외)
- 기존 저장 데이터와의 호환을 깨지 않는다 (예: 옛 이모지 값은 `resolveIcon()` fallback으로 처리)
- `index.html`/`app.js`/`style.css`를 수정하면 `sw.js`의 `CACHE` 버전을 올린다 (폰 캐시 갱신용)
- 큰 변경 후에는 `NOTES.md`의 작업 이력을 갱신한다
- 배포 반영은 사용자가 GitHub 웹에서 직접 업로드하므로, 마지막에 **어떤 파일을 올려야 하는지** 알려준다
