# BTXKOREA 직책자 스킬 진단 웹앱 (v1)

인사기획실 파일럿용 직책자 스킬 진단 도구.
시트 17·시트 10·시트 18 룰을 그대로 구현하여, 응답자가 90문항 4지선다에
응답하면 종합 점수·달성률·등급·카테고리 레이더 차트·70-20-10 처방을 출력하고
사양서 4.4 스키마의 JSON으로 결과를 내려받을 수 있습니다.

---

## 1. 빠른 시작 (즉시 실행 — 옵션 B)

빌드 도구 없이 동작합니다. Python만 있으면 됩니다.

```bash
# 1) 폴더로 이동
cd btxkorea-skill-app

# 2) (최초 1회 또는 엑셀 갱신 시) 엑셀 → JSON → standalone/data.js
python convert_excel_to_json.py
python build_standalone.py

# 3) 로컬 정적 서버 기동
cd standalone
python -m http.server 8765 --bind 127.0.0.1
```

브라우저에서 **http://127.0.0.1:8765** 접속.
첫 로드 시 esm.sh CDN에서 React 18 + htm을 받아 로딩하므로 인터넷 연결이
필요합니다(이후엔 브라우저 캐시 이용).

---

## 2. 폴더 구조

```
btxkorea-skill-app/
├─ README.md                     ← 본 문서
├─ convert_excel_to_json.py      ← 엑셀(v14) → 5개 JSON 변환
├─ build_standalone.py           ← data/ → standalone/data.js 임베드
├─ verify_logic.py               ← 핵심 로직 교차 검증 (Python, 58 PASS)
│
├─ data/                         ← 1단계 산출물 (마스터 데이터)
│   ├─ skills.json               (78개 스킬)
│   ├─ questions.json            (702개 문항)
│   ├─ matrix.json               (직책·직무 매트릭스 룰)
│   ├─ scoring_rules.json        (점수 산출·등급 임계값)
│   └─ prescriptions.json        (20개 육성 처방)
│
└─ standalone/                   ← 빌드 도구 없는 단일 페이지 React 앱
    ├─ index.html                (진입점, importmap으로 React 18+htm 로드)
    ├─ data.js                   (5개 JSON 임베드 — 자동 생성)
    ├─ styles.css                (BTXKOREA 디자인 시스템)
    ├─ lib.js                    (스킬·문항 선택 / 점수 / 등급 / 처방 / 다운로드)
    └─ app.js                    (5화면 React 컴포넌트 + 라우팅)
```

---

## 3. 5개 화면 흐름

| # | 화면 | 주요 컴포넌트 | 역할 |
|---|---|---|---|
| 1 | 시작 (정보 입력) | `<StartScreen />` | 이름·직책·소속·직무 입력 + 직책별 한도 검증 + DevTools 패널 |
| 2 | 진단 (90문항) | `<DiagnoseScreen />` | 한 페이지 1문항·진행률 바·이전/다음·미응답 검증 |
| 3 | 결과 요약 | `<ResultScreen />` | 종합 점수·달성률·등급 배지·한 줄 진단 |
| 4 | 카테고리 상세 | `<DetailsScreen />` | 5축 레이더 차트(SVG) + 5개 카테고리 카드(처방 한 줄 진단) |
| 5 | 육성 처방 | `<PrescriptionScreen />` | 카테고리별 처방 카드 5장(70-20-10) + JSON 다운로드 |

---

## 4. 핵심 룰 구현 위치

| 룰 | 위치 | 비고 |
|---|---|---|
| EPDN 환산표 (E=4·P=3·D=2·N=1) | `data/scoring_rules.json` `epdn_score` | 시트 17 Section 1 |
| 스킬 점수 = ROUND( (Q1+Q2+Q3)/3, 2 ) | `lib.js` `computeScores` | 시트 17 Section 2 |
| 카테고리 점수 = SUM(6스킬) | `lib.js` `computeScores` | 시트 17 Section 3 |
| 종합 점수 = SUM(5카테고리) | `lib.js` `computeScores` | 시트 17 Section 4 |
| 달성률 = ROUND(종합/90 × 100, 1) | `lib.js` `computeScores` | 시트 17 Section 4 |
| 등급 임계값 (120/100/80) | `data/scoring_rules.json` | 시트 17 Section 6·7 |
| 직책별 직무 한도 (팀장 1~2 / 사업부장 1~3 / 본부장 자동) | `data/matrix.json` `role_job_limits` + `lib.js` `isIntegrated` | 시트 10 매트릭스 1·2 |
| 30스킬 조합 (단일 / 2개 / 통합) | `data/matrix.json` `skill_selection` + `lib.js` `selectSkills` | 시트 10 매트릭스 3 |
| 직책별 문항 분기 (T·D·H) | `lib.js` `selectQuestions` | 시트 10 매트릭스 6 |
| 처방 ID = `[카테고리코드]-[등급코드]` | `data/scoring_rules.json` + `lib.js` `prescriptionIdFor` | 사양서 3.4 |
| 처방 라이브러리 20장 | `data/prescriptions.json` | 시트 18 |
| 결과 JSON 스키마 | `lib.js` `buildExportJson` | 사양서 4.4 |

**절대 변경 금지** (사양서 6.3): 위 룰은 코드 내부에서만 변경 가능하며, 운영 데이터 갱신 시에는 엑셀(v14)을 다시 내보내고 `convert_excel_to_json.py`만 다시 실행해 `data/*.json`을 갱신합니다.

---

## 5. 검수 가이드

### 5.1 DevTools 테스트 패널 (시작 화면 하단, "열기" 버튼)

90문항을 매번 클릭하지 않고도 5화면 흐름과 등급별 출력을 빠르게 검수할 수
있도록 5개 프리셋을 제공합니다. 각 프리셋마다 "결과 바로" 버튼 클릭 시
화면 3·4·5의 출력을 즉시 확인할 수 있습니다.

| 프리셋 | 직책·직무 | 패턴 | 기대 |
|---|---|---|---|
| 전체 E | 팀장·사외물류 | 모두 E | 종합 120·달성률 133.3%·**우수** |
| 전체 P | 팀장·사내물류 | 모두 P | 종합 90·달성률 100%·**안정** |
| 전체 D | 사업부장·조립·포장 | 모두 D | 종합 60·달성률 66.7%·**집중 육성** |
| 혼합 | 사업부장·사외+사내 (2직무) | 카테고리별 E·P·P·D·N | **혼합 등급** |
| 본부장 통합 | 본부장(자동 통합) | 카테고리별 P·P·E·D·P | **혼합 등급** |

### 5.2 핵심 로직 교차 검증 (Python)

`lib.js`와 동일한 룰을 Python으로 독립 구현해 결과를 비교합니다.
시트 17·10·18 산식·임계값·매핑이 100% 일치하는지 객관 증명용.

```bash
python verify_logic.py
```

기대 출력: **`Total: 58 pass / 0 fail`**

검증 대상:
1. `is_integrated` 판정 (6건)
2. `selectSkills` 모든 케이스 + 실재 스킬 ID 매칭 (22건)
3. `selectQuestions` 90문항·30스킬 (3건)
4. `computeScores` E/P/D 패턴 종합·달성률·등급·처방 (15건)
5. 등급 임계값 경계 (120/119.9/100/99.9/80/79.9 — 6건)
6. 처방 ID 풀 일치 (시트 18의 20개 ID 모두) (1건)
7. JSON export 스키마 (사양서 4.4 키 일치, 5건)

### 5.3 사양서 6.2 검수 포인트 매핑

| # | 검수 항목 | 합격 기준 | 검증 방법 |
|---|---|---|---|
| 1 | 점수 산출 정확도 | 시트 17 산식 100% 일치 | `verify_logic.py` 통과 + DevTools 전체 P/E/D |
| 2 | 등급 판정 정확도 | 시트 17 임계값 100% 일치 | 임계값 경계 6건 PASS + DevTools 시각 검수 |
| 3 | 처방 매핑 정확도 | 시트 18 데이터 100% 일치 | 처방 ID 풀 검증 + 처방 화면 직접 비교 |
| 4 | 30스킬 조합 | 시트 10 매트릭스 룰 준수 | 11개 케이스(직무 1~3+통합·본부장) 모두 30 = 90문항 검증 |
| 5 | UI 디자인 톤 | 임원 보고 기준 (아이콘·이모지 없음) | 전 화면 시각 점검 — 텍스트·기호만 사용 |
| 6 | 반응형 | 데스크톱·태블릿·모바일 정상 | 768/480px 미디어쿼리, SVG viewBox |
| 7 | JSON 다운로드 | 4.4 스키마 준수 | `buildExportJson` 키 검증 + 다운로드 파일 확인 |
| 8 | 성능 | 초기 로드 5초 이내 | CDN 첫 로드 후 즉시(이후 브라우저 캐시) |
| 9 | 응답 영속화 | 새로고침 시 유지(선택사항) | **v1 미구현** (사양서 5.5 LocalStorage 금지 우선) |
| 10 | 보안 | 외부 통신 없음, LocalStorage 미사용 | 응답 데이터 메모리만, 다운로드만 외부로 (사용자 의도) |

---

## 6. 데이터 갱신 (엑셀 변경 시)

엑셀 v14가 v15·v16…으로 갱신되면 다음 두 명령으로 즉시 반영됩니다.

```bash
# 1) 엑셀 → 5개 JSON
python convert_excel_to_json.py

# 2) JSON → standalone/data.js
python build_standalone.py
```

엑셀 시트 구조가 바뀌지 않는 한 코드(`lib.js`, `app.js`) 수정은 필요 없습니다.
시트 컬럼이 바뀌면 `convert_excel_to_json.py`의 `build_skills` /
`build_questions` / `build_prescriptions` 함수만 수정하면 됩니다.

---

## 7. 배포 (정적 호스팅)

`standalone/` 폴더가 그대로 빌드 결과입니다. 별도 빌드 단계 없음.

### 7.1 GitHub Pages 자동 배포 (권장)

이 저장소에는 `.github/workflows/deploy.yml` 워크플로가 포함되어 있어,
**main 브랜치에 push될 때마다 `standalone/` 폴더가 자동으로 GitHub Pages에
배포**됩니다.

**최초 1회 설정:**

```bash
# 1) GitHub에서 새 저장소 생성 (웹 또는 GitHub Desktop)
#    예: github.com/<username>/btxkorea-skill-app

# 2) 로컬에 remote 등록 + main 브랜치 push
git remote add origin https://github.com/<username>/btxkorea-skill-app.git
git push -u origin main
```

3) 저장소 **Settings → Pages → Source**에서 **"GitHub Actions"** 선택
4) Actions 탭에서 워크플로 실행 완료 대기 (~1-2분)
5) 발급 URL: `https://<username>.github.io/btxkorea-skill-app/`

이후 코드 변경 후 `git push`만 하면 1-2분 내 자동 재배포됩니다.

> 비공개 저장소의 GitHub Pages는 GitHub Pro/Team 이상 플랜 필요. 인사기획실
> 내부 도구라면 사내 서버 호스팅(§7.3)을 권장합니다.

### 7.2 기타 정적 호스팅

- **Netlify Drop**: 로그인 없이 `standalone/` 폴더 zip을 https://app.netlify.com/drop
  에 드래그-드롭 → 즉시 임시 URL (24시간, 로그인 시 영구).
- **Vercel**: Build command 없이 Output directory를 `standalone`로 지정.
- **Cloudflare Pages**: Build output을 `standalone`로 지정.

### 7.3 사내 정적 서버 (사양서 5.5 보안 요건 최우선)

`standalone/` 디렉토리 통째로 IIS·Nginx·Apache의 document root에 복사.
외부 통신 없이 사내망에서만 접근 가능 — 사양서 5.5 "외부 서버 통신 없음"
원칙에 가장 부합. 검수·운영 단계에서 권장.

> file:// 프로토콜로 직접 열면 ESM importmap이 동작하지 않습니다. 반드시 정적
> 서버를 통해 접속해 주세요. (CORS·MIME 타입 제약)

---

## 8. 보안·프라이버시

사양서 5.5 보안 요건 준수:

- **응답 데이터는 브라우저 메모리에만 보관** — LocalStorage·세션 스토리지·쿠키 미사용
- 외부 서버 전송 없음 — JSON 다운로드는 브라우저 내부 Blob URL을 사용한 사용자 의도 다운로드
- 응답자 정보(이름·직책·소속·직무)는 다운로드 JSON에만 기록되며, 페이지 새로고침 시 모두 폐기
- React/htm은 esm.sh CDN에서 받지만, 응답 데이터는 외부로 전송되지 않음

새로고침 시 데이터가 폐기되는 것은 의도된 보안 동작입니다(사양서 5.5).

---

## 9. (추후) 옵션 A — Vite + React 마이그레이션 가이드

Node.js 설치 후 사양서 5.1 기술 스택(Vite + React)으로 추가 빌드를 원하시면:

```bash
# 1) Node.js 설치 후 새 폴더에 Vite 프로젝트 생성
npm create vite@latest btxkorea-skill-vite -- --template react
cd btxkorea-skill-vite
npm install
npm install react-router-dom recharts
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# 2) 기존 파일 이식
#    standalone/lib.js  → src/lib.js (그대로)
#    standalone/app.js  → src/App.jsx (htm 백틱 → JSX 변환)
#    standalone/data.js → src/data.js (그대로) 또는 public/data/*.json
#    standalone/styles.css → src/index.css (그대로)

# 3) main.jsx에서 App import 후 createRoot 렌더 (현재 standalone/app.js 진입점 부분)

# 4) 빌드
npm run build      # → dist/ 생성, 정적 호스팅 가능
```

`lib.js`와 `data.js`는 옵션 A에서도 **변경 없이** 그대로 사용 가능합니다.
`app.js`만 htm 백틱 템플릿을 JSX 문법으로 변환하면 됩니다 (1:1 대응).

옵션 B(현재)는 첫 진입 시 esm.sh CDN을 한 번 받지만, 옵션 A는 번들된 자바스크립트를 한 파일로 제공하므로 사내망 폐쇄 환경에 더 적합합니다.

---

## 10. 라이선스 & 변경 이력

본 도구는 BTXKOREA 인사기획실 내부용입니다.

- **v1.0 (2026-05-07)** — 초기 파일럿 빌드. 5화면·90문항 진단·JSON 다운로드.
