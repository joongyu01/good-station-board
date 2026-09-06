# 착한주유소 현황판 — 인수인계

작성일 **2026-09-06** · 데이터 기준일 2026-09-05

> **판정 규칙·화면 구성·세팅·명령은 [README.md](README.md) 에 있습니다.**
> 이 문서는 그 위에 얹는 것 — **남은 일**과 **이미 당한 함정**만 다룹니다.
> 둘이 어긋나면 README 가 최신입니다.

---

## 1. 무엇인가

한국석유관리원 **착한주유소 472곳**이 자기 시·도 시세에 견줘 싸게 팔고 있는지를
신호등으로 보여주는 **정적 현황판**.

| | |
|---|---|
| 저장소 | `joongyu01/good-station-board` |
| 배포 | https://joongyu01.github.io/good-station-board/ (GitHub Pages) |
| 작업 폴더 | `C:\Users\Shin\Desktop\kpetro_ai\project\wip\opms` |
| 관리 화면 | 같은 주소 `#/admin` · 접근코드 하나로 로그인 (계정 없음) |

### ⚠ 건드리면 안 되는 것

**`joongyu01/opms` (opms.kpetro.or.kr) 는 운영 중인 별개 시스템입니다.**
이 프로젝트는 그 저장소의 수집기 아이디어만 참고했을 뿐, 코드를 고치거나
배포해서는 안 됩니다.

---

## 2. 판정 규칙 — 요약

자세한 것은 [README.md](README.md#판정-규칙). 핵심만:

- 비교 모집단은 **시·도**. 시·군·구로 쪼개면 관내 두세 곳뿐인 곳이 생긴다.
- **조밀 순위** — 1위가 셋이면 다음은 2위. 커트라인도 *N번째로 싼 가격*이다.
- 서울·경기 10위, 그 밖 5위 이내가 적합. 2배까지가 근접.
- 계수는 커트라인을 **1**로 둔 비율. **소수 넷째 자리** — 셋째로는 1원 차이가
  안 보인다(3,608과 3,609가 둘 다 1.002 였다).
- 다섯 칸: 적합 / 근접 / 초과 / **과거 미신고**(거른 이력 있음) / **가격정보 없음**
  (오늘 값 없음). 뒤 둘은 성격이 달라 나눠 둔 것이니 다시 합치지 말 것.
- 고급휘발유·실내등유는 다루지 않는다.

판정 방식을 바꿨다면 **`npm run backfill` → `npm run ranks` 를 반드시 같이**
돌리세요. 원본이 다 있어 3.4초입니다. 시계열만 다시 내고 순위표를 그대로 두면
검증 창의 커트라인과 화면의 계수가 어긋납니다.

## 3. 파이프라인

```
① normalize   stations.csv          → data/good-stations.json
② collect     오피넷 opDownload.do  → data/raw/{날짜}.json.gz + data/station-index.json
③ match       명단 ↔ 오피넷 코드    → data/station-mapping.json
④ aggregate   ②③ + 좌표 + 임계값    → client/public/data/latest.json
                                     → client/public/data/history.json (하루씩 누적)
                                     → client/public/data/rank-{날짜}.json
⑤ push        판정 결과             → Supabase gs_daily (보관용, 화면은 안 읽음)
```

`⓪ supabase:pull` 이 ① 앞에 붙어 Supabase 에서 명단·임계값·API 키를 내려받습니다.

### 수집 주기 — 하루 두 번, 전부 GitHub Actions

**Claude 는 이 파이프라인에 전혀 관여하지 않습니다.** GitHub Actions 러너가
Node 스크립트와 Playwright 만 돌립니다. LLM 호출도, API 키도 없습니다.

| 시각 (KST) | 잡히는 날짜 |
|---|---|
| 10:20 | 대개 전일분 |
| 19:30 | 대개 당일분 |

`collect` 는 **어제~오늘을 기간 조회로 한 번에** 받아 그중 다 올라온 가장 최근
날짜를 씁니다. 오피넷은 당일분을 하루에 걸쳐 채우는데(9/5 17시에 이미 10,223건,
전날 10,237건), 예전처럼 '어제'만 받으면 현황판이 늘 하루 뒤처집니다.

오늘 치가 전날 건수의 80%(`COMPLETE_RATIO`)에 못 미치면 아직 올라오는 중으로 보고
**그 날짜는 원본으로 저장하지도 않고** 전날로 물러섭니다. 덜 채워진 하루가 원본에
남으면 나중에 그걸로 재계산할 때 순위가 통째로 틀어지기 때문입니다. 그래서 하루
한 날짜는 완성본으로 한 번만 기록됩니다(같은 날 다시 받으면 덮어씀).

### 데이터 파일

| 파일 | 커밋 | 내용 |
|---|---|---|
| `stations.csv` | O | 명단 원본 472곳 (기관 제공, 저장소 루트) |
| `data/good-stations.json` | O | 정규화된 명단 |
| `data/station-mapping.json` | O | seq → 오피넷 코드 |
| `data/station-index.json` | O | 오피넷 코드 → 상호·주소·지역 (수집분 누적) |
| `data/station-coords.json` | O | 코드 → 좌표 |
| `data/manual-coords.json` | O | 지오코더가 못 찾는 2곳 수기 좌표 |
| `data/thresholds.json` | O | 임계값 (10 / 5 / ×2) — Supabase 값이 있으면 덮인다 |
| `data/history.json` | O | 시계열 원본 (화면용 사본은 `client/public`) |
| `data/raw/*.json.gz` | **O** | 전국 원본 (하루 317KB, gzip) |
| `client/public/data/latest.json` | O | 화면이 읽는 판정 결과 |
| `client/public/data/history.json` | O | 차트가 읽는 시계열 |
| `client/public/data/board-{날짜}.json` | O | 그날의 판정 스냅샷 (최근 30일) |
| `client/public/data/rank-{날짜}.json` | O | 계수 검증용 순위표 (하루 200KB) |
| `client/public/data/index.json` | O | 보유 날짜 목록 `{dates, ranks}` |
| `client/public/data/geo-*.json` | O | 단순화한 행정구역 경계 |

**원본을 보관합니다.** 안 남겼더니 판정식을 바꿀 때마다 두 달치를 다시 긁느라
세 시간씩 썼습니다. gzip 이 8.7% 로 줄여 연 113MB 입니다. 보관분을 읽어 다시
계산하는 것이 `backfill`·`ranks`·`reindex` 셋이고, 오피넷을 다시 긁는 것은
`-- --redownload` 를 붙였을 때뿐입니다.

---

## 4. 현재 상태 (2026-09-05 판매가 기준 · 2026-09-06 확인)

```
주유소   472 / 472 매칭 / 472 좌표
판정     적합 90 · 근접 60 · 초과 299 · 과거 미신고 19 · 가격정보 없음 4  (합 472)
폴       SK 123 · HD 100 · SOIL 73 · GS 71 · AL 69 · NH 28 · PB 5 · EX 3
원본     67일 (7/1 ~ 9/5) · 20MB · 빠진 날 없음
시계열   67일 · 판정 없는 날 없음
순위표   67일
스냅샷   3일 (9/2 · 9/4 · 9/5) — aggregate 가 돈 날만 남는다
```

`board-{날짜}.json` 이 세 개뿐인 것은 정상입니다. 백필은 시계열과 순위표만 채우고
그날의 판정 스냅샷은 만들지 않습니다. 화면이 읽는 것은 `latest.json` 이라
영향이 없습니다.

## 5. 소스 지도

```
client/src/
  App.tsx                  상태 총괄 — 기준·드릴다운·정렬·필터·창 열기
  components/
    KoreaMap.tsx           4단계 드릴다운 지도
    StationTable.tsx       목록 표 (모바일에서는 카드)
    PriceChart.tsx         판매가·계수 추이 창
    RankWindow.tsx         계수 검증 순위표 창
    MobileSheet.tsx        모바일 전체화면 시트 (지도·목록). 추이·순위표 창은
                           같은 `.sheet` CSS 를 직접 쓴다
    SplitLayout.tsx        지도↔목록 폭 조절
    Admin.tsx              관리 화면
  lib/
    board.ts               데이터 로딩 · applyMode() · 지역 집계 · 색·라벨
    table.ts               정렬 · CSV
    labels.ts              라벨 배치
    basemap.ts             배경 지도 타일 (VITE_TILE_*)
    useNarrow.ts           720px 판별 — 모바일 분기의 유일한 기준
    supabase.ts            관리 화면용 RPC 호출

src/lib/                   화면과 스크립트가 공유
  signal.ts                판정 · 조밀 순위 · 계수 (COEF_DIGITS)
  history.ts               시계열 · 기준 충족 일수 (COMPLIANCE_FROM)
  rank.ts                  검증용 순위표 (RANK_TOP_K)
  raw.ts                   원본 gzip 보관
  region.ts                주소 → 시·도/시·군·구 정규화
  station-csv.ts           명단 파서 (빌드·관리화면 공용)
  match.ts                 명단 ↔ 오피넷 코드 매칭 규칙
  brand.ts                 폴 코드 (HD/SOIL/SK/GS/AL/NH/EX/PB)
  coords.ts                좌표 유틸
  types.ts                 공유 타입
  supa-admin.ts            스크립트용 Supabase 접근
  opinet/                  스크래퍼 · 파서

scripts/                   README 「명령」과 1:1
supabase/schema.sql        테이블 + SECURITY DEFINER RPC 전부. 여러 번 실행해도 안전
```

화면 동작은 [README.md](README.md#화면) 에 있습니다.

## 6. 지금 남은 일

### 🔴 Supabase 명단이 아직 옛 449곳

가장 급한 항목입니다. **2026-09-06 현재도 그대로**입니다(마지막 수집 로그 확인).

```
##[warning]Supabase 명단(449곳)에 폴 정보가 없습니다. 저장소 명단(472곳)을 그대로 씁니다.
```

**할 일** — 관리 화면(`#/admin`) → 착한주유소 명단 → **CSV 올리기** 로
`stations.csv` 를 업로드. 또는 저장소에서:

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... GS_ACCESS_CODE=... npm run supabase:seed
```

`gs_station_replace` RPC 는 **이미 DB 에 있습니다**(확인함). 업로드가 바로 됩니다.

> 지금은 가드 덕분에 화면이 정상이지만, **관리 화면에서 명단을 고쳐도 파이프라인에
> 반영되지 않습니다.** 저장소 파일이 기준이 되어 있기 때문입니다. 업로드하면 풀립니다.

### 🟡 오피넷 API 키 미활성

`avgAllPrice.do` 가 빈 응답입니다. 승인 상태 확인이 필요합니다
(오피넷 마이페이지 · `(052) 216-2514` · `price@knoc.co.kr`).

**가격 수집에는 영향이 없습니다.** 수집은 API 가 아니라 `opDownload.do` 스크래핑을
씁니다. 키는 좌표 보강용인데 그것도 브이월드로 이미 채웠습니다.

### 🟡 명단 원본 오류 1건

`KH에너지㈜직영 대복주유소` — 명단 주소는 `경기 양주시 부흥로 1807` 인데
**실제 등록 주소는 부흥로 1809** 입니다. 좌표는 `data/manual-coords.json` 으로
맞춰 뒀지만 원본을 고치는 편이 좋습니다.

### 🟡 순위표가 정리되지 않고 쌓인다

`aggregate` 의 보관 정리(`KEEP_DAYS = 30`)는 **`board-*.json` 이 있는 날짜만**
훑습니다. 백필로 만든 순위표는 짝이 되는 스냅샷이 없어 영원히 남습니다 — 지금
67개 14MB 이고 하루 200KB 씩 늡니다(연 73MB). 배포되는 사이트 용량이라 언젠가는
손봐야 합니다. `rank-*.json` 목록을 직접 훑어 자르거나, 검증용이니 보관 기간을
따로 두면 됩니다.

### ⚪ 유종별 계수 추이 (미구현)

추이 창의 계수 그래프는 **통합 기준 하나뿐**입니다. 기준을 휘발유로 바꿔도 계수는
통합값입니다. 유종별 계수 추이가 필요하면 `src/lib/history.ts` 의 `sampleDay()` 를
넓히고 `npm run backfill` 로 다시 내면 됩니다. 원본이 있는 날짜는 몇 초로 끝납니다
(67일 재계산에 3.4초).

### ⚪ 정해 둘 것 두 가지

- **집계 시작일이 8/1 고정**입니다(`COMPLIANCE_FROM`). 시간이 지나면 구간이 계속
  길어집니다. "최근 30일" 같은 이동 구간으로 바꾸려면 그 상수만 고치면 됩니다.
- **결측 이력 규칙** — 한 번이라도 가격이 빈 적 있으면 무조건 '과거 미신고' 로
  뺍니다. 두 달 전 하루 걸렀는데 오늘 1위인 곳도 제외됩니다. 완화하려면
  `scripts/aggregate.ts` 의 `gaps > 0` 조건을 손보면 됩니다.

---

## 7. 반드시 알아야 할 함정

이미 한 번씩 당한 것들입니다.

### npm 이 옵션을 먹는다

`npm run backfill --redownload` 는 **아무 일도 하지 않습니다.** npm 이 `--redownload`
를 자기 옵션으로 가져가 스크립트까지 오지 않습니다. `npm run backfill -- --redownload`
처럼 `--` 를 넣으세요. 날짜 인자(`npm run backfill 20260701 20260703`)는 그냥 넘어갑니다.

### 백필을 하고도 옛 값이 남는다

원본을 다시 계산할 때 **기간 끝을 하루라도 짧게 잡으면 그 날짜만 옛 규칙으로
남습니다.** 실제로 9/4 하루가 경쟁 순위·소수 셋째 자리 시절 값으로 남아 있었습니다
(계수 455건·판정 83건이 틀렸고, 기준 충족 일수가 적합 +29 / 근접 +34 / 초과 −63
움직였습니다). 9/5 는 그날 `aggregate` 가 다시 냈고 9/3 이전은 백필 범위였는데
9/4 만 그 사이에 끼어 있었습니다.

판정식을 바꿨으면 **범위를 전체로 잡고**(인자 없이) `npm run backfill` → `npm run ranks`
를 도세요. 원본이 다 있어 3.4초입니다. 아끼지 마세요. 오늘 치는 `aggregate` 가
따로 다시 냅니다.

### 배포해도 옛 데이터가 보인다

GitHub Pages 가 `Cache-Control: max-age=600` 을 붙입니다. 번들에는 내용 해시가
붙어 캐시가 끊기지만 `data/*.json` 은 이름이 그대로라 10분간 옛 것이 쓰입니다.

파일 이름에 `?v=` 를 붙이는 것만으로는 **부족합니다.** 그 값이 번들 안에 박혀
있어, `index.html` 이 캐시돼 있으면 옛 번들 → 옛 `?v=` → 옛 데이터가 됩니다.
실제로 두 번 당했습니다. 지금은 `fetchData()` 가 `cache: "no-cache"` 로 매번
검증합니다. 데이터 요청은 반드시 이걸 쓰세요.

### 수집 결과 푸시가 사람 커밋과 부딪힌다

러너가 체크아웃하고 집계를 마치고 미는 사이(1분)에 누가 `main` 에 푸시하면
non-fast-forward 로 거절되고 배포 잡이 통째로 건너뛰어집니다. 지금은 당겨서
세 번까지 다시 밉니다. **10:20 · 19:30 KST 근처에는 푸시를 피하세요.**

### `supabase:pull` 이 명단을 덮어쓴다

`gs_station` 이 원본이고 저장소 파일은 사본입니다. 저장소 명단만 바꾸고 Supabase 를
갱신하지 않으면 **다음 수집에서 옛 명단으로 되돌아가고 배포까지 되돌아갑니다.**
실제로 472곳이 449곳으로 돌아갔습니다.

지금은 `pullStations()` 가 **폴(상표) 정보 유무로 판별**해 막고 있습니다.
Supabase 쪽에 상표가 하나도 없으면 덮어쓰지 않습니다.

### `pull` 의 세 조각은 독립이어야 한다

명단 / 임계값 / API 키. 한 곳에서 `return` 하면 뒤가 통째로 건너뛰어집니다.
**두 번 당했습니다** — 설정 조회 실패 때 한 번, 명단 가드 때 한 번.
`main()` 이 셋을 각각 `catch` 로 감싸 돌립니다.

### 오피넷 기간 조회는 3일이 한계

`opDownload.do` 는 기간 조회를 지원하지만 **7일치는 10분을 기다려도 파일이
떨어지지 않습니다.** 3일치(30,714행·4MB)는 정상입니다. `backfill` 이 3일씩 끊습니다.

### 브이월드는 GitHub 러너에서 막힌다

미국 IP 에서 호출하면 `fetch failed` / `502` 로 **전건 실패**합니다(446건 전부).
국내에서는 정상입니다. 그래서 좌표 수집은 CI 에서 뺐습니다 — 국내에서 한 번
`npm run coords:vworld` 로 채워 커밋하면 그 파일을 계속 씁니다.

### 수기 매핑은 seq 로 걸린다

`data/manual-mapping.json` 은 seq 가 키입니다. 명단을 갈아끼우면 seq 가 통째로
밀려 **엉뚱한 주유소를 가리킵니다**(실제로 446건이 잘못 붙었습니다). 그래서
매칭 순서가 `csv` → `manual` 이고, 명단 교체 때 이 파일을 지웠습니다. 지금은
472곳 전건이 CSV 코드로 붙어 파일이 아예 없습니다. 다시 만들 일이 생기면
seq 가 아니라 오피넷 코드를 키로 두는 편이 안전합니다.

### 원본이 gzip 이라는 것을 잊지 말 것

`data/raw` 를 읽는 코드는 **반드시 `src/lib/raw.ts` 를 거쳐야** 합니다.
`readdirSync(...)` 로 `.json` 만 찾는 코드는 이제 아무것도 못 봅니다 — `reindex`
가 실제로 그래서 죽어 있었습니다(2026-09-06 고침). `listRawDates` / `readRaw` /
`writeRaw` 를 쓰세요.

### 엑셀 CSV 는 BOM 이 필요하다

없으면 한글이 전부 깨집니다. `downloadCsv()` 첫 인자가 BOM 입니다 — 눈에 보이지
않으니 지우지 마세요. **검증할 때 `Blob.text()` 를 쓰면 안 됩니다** — BOM 을
벗겨내서 없는 것처럼 보입니다. `arrayBuffer()` 로 바이트를 직접 확인하세요.

### 지도 클릭이 안 될 때

`pointerdown` 에서 곧바로 `setPointerCapture` 를 하면 이어지는 `click` 의 타깃이
`<path>` 가 아니라 `<svg>` 가 되어 **드릴다운이 통째로 죽습니다.**
5px 넘게 끈 뒤에만 캡처합니다.

> 검증할 때 `dispatchEvent` 로 path 에 직접 이벤트를 쏘면 이 버그를 못 잡습니다.
> 실제 좌표를 클릭해서 확인하세요.

### 라벨 배치는 두 가지 방식

- **지역 칩** — `relaxChips()`, 서로 밀어내기. 경계는 SVG 상자가 아니라
  **지금 보이는 범위**여야 합니다. 확대율이 1이 아니면 둘이 달라집니다.
- **핀 이름표** — `placePinLabels()`, 후보 자리 중 고르기. 이름표를 키우자
  밀어내기가 수렴하지 않아 바꿨습니다(밀린 이름표가 남의 아이콘 위에 내려앉음).

### 모바일 CSS 가 PC 를 건드리면 실패다

분기 기준은 `@media (max-width: 720px)` 와 `useNarrow()` 둘뿐이고 같은 값을 씁니다.
한 번 당한 방식이 이렇습니다 — `.panel-inner` 같은 공용 규칙을 미디어 쿼리 *뒤에*
두면 같은 특정도에서 나중 것이 이겨 모바일까지 따라옵니다. 공용 규칙은
`@media (min-width: 1241px)` 로 감싸 두세요.

### 통합시 표기

`전남광주통합특별시` 는 **실재하는 명칭**입니다. 광주광역시 + 전라남도 통합.
오피넷도 `전남광주` 로 내려줍니다. 오타로 오해하지 마세요.
인천 서구는 검단구·서해구로 분구되었습니다 — 그래서 집계 지역은 명단 주소가
아니라 **오피넷이 말하는 현재 소재지**를 씁니다.

---

## 8. 자주 쓰는 명령

전체 목록과 처음 세팅(Node 22 · 키가 사는 곳)은 [README.md](README.md#처음-세팅).

```bash
npm run check          # 타입 검사 — 커밋 전에 반드시
npm run dev            # 개발 서버 (5173)

npm run aggregate      # 판정 다시 (data/raw 에 그날 원본이 있어야 함)
npm run backfill       # 7/1 ~ 어제 전체 재계산 (원본이 있으면 3.4초)
npm run ranks          # 순위표 전체 재생성
npm run reindex        # region.ts 를 고쳤을 때 원본 재정규화
```

### 배포

```bash
gh workflow run collect.yml                      # 수집부터 전부
gh workflow run collect.yml -f skip_collect=true # 커밋된 데이터로 배포만 (~1분)
```

자동 실행은 매일 **10:20 · 19:30 KST** 두 번. 코드만 바꿨을 때는 `skip_collect` 를
쓰세요 — NetFunnel 대기열이 길면 20분 넘게 잡힙니다.

**배포 후 확인할 때 브라우저 캐시를 조심하세요.** `?cb=<타임스탬프>` 를 붙이거나
Ctrl+F5. 옛 번들이 그대로 나와 "안 바뀌었다"고 오판하기 쉽습니다.

### 로컬에서 aggregate 를 돌릴 때

`data/raw/*.json.gz` 는 커밋돼 있으니 `git pull` 만 해두면 로컬에도 원본이 있습니다.
다만 **`aggregate` 는 날짜를 안 주면 가장 최근 원본으로 `latest.json` 을 덮어씁니다.**
CI 가 방금 오늘 치를 올렸는데 로컬이 안 당겨져 있으면 하루 뒤로 되돌립니다.
돌리기 전에 `git pull` 하세요.

---

## 9. Supabase

RLS 를 켜고 **정책을 하나도 만들지 않았습니다.** anon 키로는 테이블을 읽지도 쓰지도
못합니다. 모든 접근은 `SECURITY DEFINER` 함수를 통해서만 이뤄집니다. 그래서
접근코드와 API 키가 브라우저로 내려오지 않습니다.

| 테이블 | 용도 |
|---|---|
| `gs_config` | 접근코드, 판정 임계값 |
| `gs_secret` | 오피넷·브이월드 API 키 (값은 절대 브라우저로 안 감) |
| `gs_station` | 명단 (**아직 449곳 — 6장 참고**) |
| `gs_daily` | 일별 판정 결과 보관 (화면은 안 읽음) |
| `gs_session` | 8시간 세션 토큰 |
| `gs_daily_by_fuel` | 유종별로 쌓던 옛 테이블. 지우지 않고 보관 |

RPC 는 `gs_login` / `gs_ping` / `gs_logout` / `gs_stations` / `gs_station_save` /
`gs_station_replace` / `gs_station_delete` / `gs_config_get` / `gs_config_save` /
`gs_code_change` / `gs_secrets` / `gs_secret_save` / `gs_secret_delete` 입니다.
전부 첫 인자가 세션 토큰입니다.

스키마를 바꿨으면 **SQL Editor 에서 `supabase/schema.sql` 을 다시 실행**해야
합니다. 여러 번 돌려도 안전하게 써 뒀습니다.

> `client/public/config.js` 에는 **anon(publishable) 키만** 넣습니다.
> service_role / secret 키는 절대 넣지 마세요 — 공개 저장소에 그대로 올라갑니다.

---

## 10. 미해결로 남은 질문

**추이 차트 참고 사진** — "첨부된 사진처럼" 이라고 하셨는데 이미지가 전달되지
않았습니다. 지금은 왼쪽에 판매가·계수 그래프 둘, 오른쪽에 날짜별 기록표 형태로
만들어 두었습니다. 원하시는 형태가 따로 있으면 사진을 다시 올려주셔야 합니다.

**브이월드 키 재발급** — 키 값이 대화 중에 그대로 오갔습니다. 재발급을 권합니다.
지금 실제 값은 Supabase `gs_secret` 과 GitHub Secrets 에만 두고 있습니다.
