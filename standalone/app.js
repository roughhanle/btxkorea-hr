/* =====================================================================
 * BTXKOREA 직책자 스킬 진단 — 메인 앱
 *
 * Step 4: 화면 1(StartScreen) + 화면 2(DiagnoseScreen) 본문 구현
 *
 * 빌드 도구 없는 React 앱 (React 18 + htm).
 * ===================================================================== */

import React, {
  useState, useMemo, useCallback, useContext, createContext, useEffect,
} from "react";
import { createRoot } from "react-dom/client";
import htm from "htm";
import {
  skills, questions, matrix, scoring_rules, prescriptions, guide,
} from "./data.js";
import {
  selectSkills, selectQuestions, isIntegrated, caseFor,
  computeScores, gradeBadgeClass, gradeMessage,
  prescriptionById, categoryCardClass, skillById,
  buildExportJson, exportFilename, downloadJson,
} from "./lib.js";

const html = htm.bind(React.createElement);

// =====================================================================
// 화면 정의
// =====================================================================
const SCREENS = [
  { id: "start",     label: "정보 입력" },
  { id: "diagnose",  label: "진단" },
  { id: "result",    label: "결과 요약" },
  { id: "details",   label: "카테고리 상세" },
  { id: "prescribe", label: "육성 처방" },
];
const SCREEN_INDEX = Object.fromEntries(SCREENS.map((s, i) => [s.id, i]));

const ROLES = ["팀장", "사업부장", "본부장"];
const DIVISIONS = matrix.divisions; // ["군산","울산","인천","중부","창원","본사"]
const ALL_JOBS = ["사외물류", "사내물류", "조립·포장", "운송납품"]; // 사용자 선택용 (통합 제외)

// =====================================================================
// 전역 상태 — Context
// =====================================================================
const AppContext = createContext(null);
const useApp = () => useContext(AppContext);

function AppProvider({ children }) {
  const [screen, setScreen] = useState("start");

  const [respondent, setRespondent] = useState({
    name: "", role: "", division: "", jobs: [],
  });

  const [responses, setResponses] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);

  // 직책·직무 → 30스킬 → 90문항 (응답자 정보가 정의된 후에만 산출)
  const selectedSkillIds = useMemo(() => {
    if (!respondent.role) return [];
    if (respondent.role === "본부장") return selectSkills(respondent.role, []);
    if (!respondent.jobs.length) return [];
    return selectSkills(respondent.role, respondent.jobs);
  }, [respondent.role, respondent.jobs]);

  const currentQuestions = useMemo(() => {
    if (!respondent.role || !selectedSkillIds.length) return [];
    return selectQuestions(selectedSkillIds, respondent.role, questions);
  }, [respondent.role, selectedSkillIds]);

  // 모든 90문항이 응답되었을 때만 점수 결과 계산 (미응답이면 null)
  const scoreResult = useMemo(() => {
    if (!currentQuestions.length) return null;
    const answered = currentQuestions.every((q) => responses[q.question_id]);
    if (!answered) return null;
    return computeScores(responses, currentQuestions);
  }, [currentQuestions, responses]);

  const goto = useCallback((s) => {
    if (SCREEN_INDEX[s] !== undefined) {
      setScreen(s);
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, []);

  const updateRespondent = useCallback((patch) => {
    setRespondent((prev) => ({ ...prev, ...patch }));
  }, []);

  const setResponse = useCallback((questionId, label) => {
    setResponses((prev) => ({ ...prev, [questionId]: label }));
  }, []);

  // 다중 응답을 한 번에 설정 (개발자 테스트 패널 / 자동 검증용)
  const fillResponses = useCallback((entries) => {
    setResponses(entries);
    setCurrentIndex(0);
  }, []);

  const reset = useCallback(() => {
    setRespondent({ name: "", role: "", division: "", jobs: [] });
    setResponses({});
    setCurrentIndex(0);
    setScreen("start");
  }, []);

  const value = useMemo(() => ({
    screen, goto,
    respondent, updateRespondent,
    responses, setResponse, fillResponses,
    currentIndex, setCurrentIndex,
    selectedSkillIds, currentQuestions, scoreResult,
    reset,
  }), [
    screen, respondent, responses, currentIndex,
    selectedSkillIds, currentQuestions, scoreResult,
    goto, updateRespondent, setResponse, fillResponses, reset,
  ]);

  return html`<${AppContext.Provider} value=${value}>${children}</${AppContext.Provider}>`;
}

// =====================================================================
// 작성자 안내 카드 — 시트 2 본문을 자동 렌더
//
// 시트 2(작성자 안내)의 raw row/cell 데이터를 패턴 기반으로 단순 마크업한다.
// - 1번째 행: 큰 제목 (title)
// - 2번째 행: 부제 (subtitle)
// - "1.", "2." ... 로 시작 → h3 (큰 섹션)
// - "3.1", "3.2" 처럼 점이 두 번 → h4 (서브섹션)
// - 셀이 2개 이상 → 표 (key/val grid)
// - "[ ... ]" 으로 감싼 줄 → 강조 박스
// - "Q1.", "A." 패턴 → FAQ
// - 그 외 → paragraph
// =====================================================================

const GUIDE_PATTERNS = {
  H3:    /^\d+\.\s+/,
  H4:    /^\d+\.\d+\s+/,
  BOX:   /^\[.+\]$/,
  FAQ_Q: /^Q\d+\./,
  FAQ_A: /^A\.\s+/,
};

function renderGuideRow(row, idx, prevType) {
  const cells = row.cells || [];
  if (cells.length === 0) return null;        // 빈 줄
  // 표 — 셀이 2개 이상이면 key/val 한 줄
  if (cells.length >= 2) {
    return {
      type: "tableRow",
      key: cells[0],
      val: cells.slice(1).join(" · "),
    };
  }
  const text = cells[0];
  if (idx === 0)                       return { type: "title", text };
  if (idx === 1 && !GUIDE_PATTERNS.H3.test(text)) return { type: "subtitle", text };
  if (GUIDE_PATTERNS.H4.test(text))    return { type: "h4", text };
  if (GUIDE_PATTERNS.H3.test(text))    return { type: "h3", text };
  if (GUIDE_PATTERNS.FAQ_Q.test(text)) return { type: "faqQ", text };
  if (GUIDE_PATTERNS.FAQ_A.test(text)) return { type: "faqA", text };
  if (GUIDE_PATTERNS.BOX.test(text))   return { type: "box", text };
  return { type: "p", text };
}

function GuideContent({ rows }) {
  // 인접한 tableRow들을 하나의 그리드로 묶기 위해 1차 변환 후 그룹핑
  const items = rows
    .map((r, i) => renderGuideRow(r, i))
    .filter(Boolean);

  // tableRow를 연속 그룹핑
  const blocks = [];
  let pendingTable = null;
  for (const it of items) {
    if (it.type === "tableRow") {
      if (!pendingTable) { pendingTable = { type: "table", rows: [] }; blocks.push(pendingTable); }
      pendingTable.rows.push({ key: it.key, val: it.val });
    } else {
      pendingTable = null;
      blocks.push(it);
    }
  }

  // FAQ Q와 A를 묶어 표시하기 위해 인접 처리
  return html`
    <div class="guide-body">
      ${blocks.map((b, i) => {
        if (b.type === "title")    return html`<h2 class="guide-card__title" key=${i}>${b.text}</h2>`;
        if (b.type === "subtitle") return html`<p class="guide-card__sub" key=${i}>${b.text}</p>`;
        if (b.type === "h3")       return html`<h3 key=${i}>${b.text}</h3>`;
        if (b.type === "h4")       return html`<h4 key=${i}>${b.text}</h4>`;
        if (b.type === "box")      return html`<div class="guide-callout" key=${i}>${b.text}</div>`;
        if (b.type === "faqQ")     return html`<p class="guide-faq__q" key=${i}>${b.text}</p>`;
        if (b.type === "faqA")     return html`<p class="guide-faq__a" key=${i} style=${{ marginBottom: 12 }}>${b.text}</p>`;
        if (b.type === "table") {
          return html`
            <div class="guide-table" key=${i}>
              ${b.rows.map((r, j) => html`
                <div class="guide-table__key" key=${"k"+j}>${r.key}</div>
                <div class="guide-table__val" key=${"v"+j}>${r.val}</div>
              `)}
            </div>
          `;
        }
        return html`<p key=${i}>${b.text}</p>`;
      })}
    </div>
  `;
}

function GuideCard() {
  const [open, setOpen] = useState(true); // 기본 펼침 — 시작 전 필독 강조
  const rows = guide?.respondent_guide || [];
  if (!rows.length) return null;
  return html`
    <section class="guide-card">
      <div class="guide-card__head">
        <div>
          <h2 class="guide-card__title">작성자 안내 (시작 전 필독)</h2>
          <p class="guide-card__sub">
            엑셀 시트 2 "작성자 안내" 본문 — 점검 목적·절차·솔직한 응답 원칙·핵심 용어·FAQ
          </p>
        </div>
        <button class="btn btn--ghost guide-toggle" onClick=${() => setOpen((v) => !v)}>
          ${open ? "접기 ▴" : "펼치기 ▾"}
        </button>
      </div>
      ${open ? html`<${GuideContent} rows=${rows} />` : null}
    </section>
  `;
}

// =====================================================================
// 진단 화면용 스킬 상세 정보 토글
// =====================================================================
function SkillInfoPanel({ skillId }) {
  const [open, setOpen] = useState(false);
  const sk = skillById(skillId);
  if (!sk) return null;
  return html`
    <div class="skill-info">
      <button class="skill-info__toggle" onClick=${() => setOpen((v) => !v)}
        aria-expanded=${open}>
        <span>스킬 상세 정보 ${sk.skill_id} · ${sk.skill_name}</span>
        <span class="skill-info__caret">${open ? "▴ 접기" : "▾ 펼치기"}</span>
      </button>
      ${open ? html`
        <div class="skill-info__body">
          <div class="skill-info__key">정의</div>
          <div class="skill-info__val">${sk.definition || "—"}</div>

          <div class="skill-info__key">필요 기술</div>
          <div class="skill-info__val">${sk.skills || "—"}</div>

          <div class="skill-info__key">필요 지식</div>
          <div class="skill-info__val">${sk.knowledge || "—"}</div>

          <div class="skill-info__key">관리툴 (증빙 산출물)</div>
          <div class="skill-info__val">${sk.tools || "—"}</div>
        </div>
      ` : null}
    </div>
  `;
}

// =====================================================================
// 공통 셸
// =====================================================================
function AppShell({ children }) {
  const { screen } = useApp();
  const idx = SCREEN_INDEX[screen];
  return html`
    <div class="app-shell">
      <header class="app-header">
        <div>
          <div class="app-header__title">BTXKOREA 직책자 스킬 진단</div>
          <div class="app-header__sub">인사기획실 · 파일럿 v1</div>
        </div>
        <div class="app-header__sub">${idx + 1} / ${SCREENS.length} · ${SCREENS[idx].label}</div>
      </header>
      <main class="app-main">${children}</main>
      <footer class="app-footer">
        © BTXKOREA 인사기획실 · 응답 데이터는 브라우저 메모리에서만 처리됩니다.
      </footer>
    </div>
  `;
}

function PlaceholderBody({ note }) {
  return html`
    <div style=${{
      padding: "24px",
      background: "var(--color-bg-alt)",
      borderRadius: "var(--radius)",
      border: "1px dashed var(--color-border-strong)",
      color: "var(--color-text-muted)",
      fontSize: "13.5px",
      lineHeight: "1.7",
    }}>${note}</div>
  `;
}

// =====================================================================
// 개발자 테스트 패널 — 90문항 자동 응답 + 결과 화면 즉시 이동
//
// 사양 검수자가 매번 90문항을 직접 누르지 않고도 5화면 흐름과
// 등급별 출력을 검증할 수 있도록 제공.
// 운영 배포 시 isProductionMode() 같은 플래그로 가릴 수 있다.
// =====================================================================
const DEV_PRESETS = [
  {
    id: "perfect-E", label: "전체 E (우수)",
    desc: "모든 문항 E 매핑 선택 → 종합 120/120, 달성률 133.3%, 우수",
    role: "팀장", division: "인천", jobs: ["사외물류"], pattern: "E",
  },
  {
    id: "balanced-P", label: "전체 P (안정)",
    desc: "모든 문항 P 매핑 선택 → 종합 90/120, 달성률 100%, 안정",
    role: "팀장", division: "인천", jobs: ["사내물류"], pattern: "P",
  },
  {
    id: "weak-D", label: "전체 D (집중 육성)",
    desc: "모든 문항 D 매핑 선택 → 종합 60/120, 달성률 66.7%, 집중 육성",
    role: "사업부장", division: "창원", jobs: ["조립·포장"], pattern: "D",
  },
  {
    id: "mixed", label: "혼합 (사업부장 2직무)",
    desc: "카테고리별 다른 패턴 (E·P·P·D·N) — 보완 필요/혼합 등급",
    role: "사업부장", division: "군산", jobs: ["사외물류", "사내물류"], pattern: "mixed",
  },
  {
    id: "head-integrated", label: "본부장 통합 (혼합)",
    desc: "본부장 자동 통합 트랙 + 카테고리별 차등 응답 → 안정/보완 혼합",
    role: "본부장", division: "본사", jobs: [], pattern: "mixed-head",
  },
];

function pickEpdnLabel(question, code) {
  const ch = question.choices.find((c) => c.epdn === code);
  return ch ? ch.label : question.choices[0].label;
}

function buildAutoResponses(qs, pattern) {
  const out = {};
  // 카테고리 순서 인덱스
  const catIdx = (cat) => matrix.categories.indexOf(cat);
  for (const q of qs) {
    let target;
    if (pattern === "E" || pattern === "P" || pattern === "D" || pattern === "N") {
      target = pattern;
    } else if (pattern === "mixed") {
      // 공통 E / 설계 P / 운영 P / 평가 D / 개선 N
      target = ["E", "P", "P", "D", "N"][catIdx(q.category)] || "P";
    } else if (pattern === "mixed-head") {
      // 본부장: 공통 P / 설계 P / 운영 E / 평가 D / 개선 P
      target = ["P", "P", "E", "D", "P"][catIdx(q.category)] || "P";
    } else {
      target = "P";
    }
    out[q.question_id] = pickEpdnLabel(q, target);
  }
  return out;
}

function DevTools() {
  const { updateRespondent, fillResponses, goto } = useApp();
  const [open, setOpen] = useState(false);

  const runPreset = (preset, jumpTo = "result") => {
    updateRespondent({
      name: "테스트 응답자", role: preset.role,
      division: preset.division, jobs: preset.jobs,
    });
    const skillIds = selectSkills(preset.role, preset.jobs);
    const qs = selectQuestions(skillIds, preset.role, questions);
    const auto = buildAutoResponses(qs, preset.pattern);
    fillResponses(auto);
    // useMemo가 새 respondent로 currentQuestions / scoreResult 재산출하도록 다음 tick에 이동
    setTimeout(() => goto(jumpTo), 50);
  };

  return html`
    <section class="card" style=${{ marginTop: 18, borderStyle: "dashed" }}>
      <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 class="section-title" style=${{
          margin: 0, padding: 0, border: "none",
          fontSize: 14, color: "var(--color-text-muted)", letterSpacing: "0.3px",
        }}>
          개발자 테스트 패널 (검수용)
        </h2>
        <button class="btn btn--ghost" style=${{ padding: "6px 14px", fontSize: 12 }}
          onClick=${() => setOpen((v) => !v)}>
          ${open ? "닫기" : "열기"}
        </button>
      </div>
      ${open ? html`
        <p class="section-sub" style=${{ margin: "12px 0 14px" }}>
          90문항을 자동 응답해 즉시 결과·상세·처방 화면을 검증합니다. 응답 패턴별로 시트 17 등급 임계값이 정확히 적용되는지 확인 가능.
        </p>
        <div style=${{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          ${DEV_PRESETS.map((p) => html`
            <div key=${p.id} style=${{
              padding: "12px 14px", border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)", background: "var(--color-bg-alt)",
            }}>
              <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style=${{ fontWeight: 600, fontSize: 13, color: "var(--color-primary)" }}>${p.label}</div>
                  <div style=${{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>
                    ${p.role} · ${p.division} · ${p.jobs.length ? p.jobs.join("/") : "통합 자동"} · ${p.desc}
                  </div>
                </div>
                <div style=${{ display: "flex", gap: 6 }}>
                  <button class="btn btn--ghost" style=${{ padding: "6px 12px", fontSize: 12 }}
                    onClick=${() => runPreset(p, "diagnose")}>진단부터</button>
                  <button class="btn btn--primary" style=${{ padding: "6px 12px", fontSize: 12 }}
                    onClick=${() => runPreset(p, "result")}>결과 바로</button>
                </div>
              </div>
            </div>
          `)}
        </div>
      ` : null}
    </section>
  `;
}

// =====================================================================
// 화면 1: StartScreen — 응답자 정보 입력
// =====================================================================
function StartScreen() {
  const { goto, respondent, updateRespondent } = useApp();
  const [touched, setTouched] = useState(false);

  const { name, role, division, jobs } = respondent;

  // 직책·직무 변경 시 자동으로 본부장은 직무 비움, 한도 초과 정리는 사용자 토글 시 처리
  const integrated = useMemo(
    () => (role ? isIntegrated(role, jobs) : false),
    [role, jobs]
  );

  // 본부장 선택 시 직무 자동 초기화
  useEffect(() => {
    if (role === "본부장" && jobs.length > 0) {
      updateRespondent({ jobs: [] });
    }
  }, [role, jobs.length, updateRespondent]);

  const toggleJob = useCallback((job) => {
    if (role === "본부장") return; // 비활성
    const has = jobs.includes(job);
    let next;
    if (has) {
      next = jobs.filter((j) => j !== job);
    } else {
      next = [...jobs, job];
    }
    updateRespondent({ jobs: next });
  }, [role, jobs, updateRespondent]);

  // 검증
  const errors = useMemo(() => {
    const e = {};
    if (!name.trim()) e.name = "이름을 입력하세요.";
    if (!role) e.role = "직책을 선택하세요.";
    if (!division) e.division = "소속 사업본부를 선택하세요.";
    if (role === "팀장") {
      if (jobs.length === 0) e.jobs = "직무를 1~2개 선택하세요. (3개 이상 시 통합 자동 적용)";
    } else if (role === "사업부장") {
      if (jobs.length === 0) e.jobs = "직무를 1~3개 선택하세요. (4개 이상 시 통합 자동 적용)";
    }
    // 본부장은 자동 통합이라 직무 검증 면제
    return e;
  }, [name, role, division, jobs]);

  const canStart = Object.keys(errors).length === 0;

  // 직무 선택에 따른 안내 메시지
  const caseHint = useMemo(() => {
    if (!role) return null;
    if (role === "본부장") return "본부장은 통합 트랙이 자동 적용됩니다 (총 30스킬 × 3문항 = 90문항).";
    if (jobs.length === 0) return null;
    const c = caseFor(role, jobs);
    if (c === "single") return `단일 직무 케이스 — 공통 18스킬 + ${jobs[0]} 직무전용 12스킬 = 30스킬 (90문항).`;
    if (c === "two")    return `2개 직무 케이스 — 공통 6스킬 + ${jobs[0]}·${jobs[1]} 각 12스킬 = 30스킬 (90문항).`;
    if (c === "integrated") return `직무 ${jobs.length}개 선택 → 통합 트랙 자동 적용 (총 30스킬 × 3문항).`;
    return null;
  }, [role, jobs]);

  const onStart = () => {
    setTouched(true);
    if (canStart) goto("diagnose");
  };

  return html`
    <${React.Fragment}>
    <${GuideCard} />
    <section class="card">
      <h2 class="section-title">응답자 정보 입력</h2>
      <p class="section-sub">진단을 시작하기 전 본인 정보를 입력하세요. 모든 항목 입력 시 진단이 시작됩니다.</p>

      <div class="form-row">
        <label for="name">이름</label>
        <input
          id="name"
          type="text"
          value=${name}
          maxLength=${30}
          onChange=${(e) => updateRespondent({ name: e.target.value })}
          placeholder="예: 홍길동" />
        ${touched && errors.name ? html`<div class="form-error">${errors.name}</div>` : null}
      </div>

      <div class="form-row">
        <label for="role">직책</label>
        <select
          id="role"
          value=${role}
          onChange=${(e) => updateRespondent({ role: e.target.value })}>
          <option value="">— 선택하세요 —</option>
          ${ROLES.map((r) => html`<option key=${r} value=${r}>${r}</option>`)}
        </select>
        ${touched && errors.role ? html`<div class="form-error">${errors.role}</div>` : null}
      </div>

      <div class="form-row">
        <label for="division">소속 사업본부</label>
        <select
          id="division"
          value=${division}
          onChange=${(e) => updateRespondent({ division: e.target.value })}>
          <option value="">— 선택하세요 —</option>
          ${DIVISIONS.map((d) => html`<option key=${d} value=${d}>${d}</option>`)}
        </select>
        ${touched && errors.division ? html`<div class="form-error">${errors.division}</div>` : null}
      </div>

      <div class="form-row">
        <label>직무 ${role === "본부장" ? "(자동 적용)" : "(중복 선택 가능)"}</label>
        <div class="job-chips">
          ${role === "본부장" ? html`
            <span class="job-chip job-chip--auto">통합 트랙 자동</span>
          ` : ALL_JOBS.map((j) => {
            const active = jobs.includes(j);
            return html`
              <button
                key=${j}
                type="button"
                class=${"job-chip" + (active ? " job-chip--active" : "") + (!role ? " job-chip--disabled" : "")}
                disabled=${!role}
                onClick=${() => toggleJob(j)}>
                ${j}
              </button>
            `;
          })}
        </div>
        ${caseHint ? html`<div class="form-help">${caseHint}</div>` : null}
        ${touched && errors.jobs ? html`<div class="form-error">${errors.jobs}</div>` : null}
      </div>

      <div class="btn-row">
        <button class="btn btn--primary" onClick=${onStart} disabled=${!canStart && touched}>
          진단 시작 →
        </button>
      </div>
    </section>
    <${DevTools} />
    </${React.Fragment}>
  `;
}

// =====================================================================
// 화면 2: DiagnoseScreen — 90문항 4지선다
// =====================================================================
function DiagnoseScreen() {
  const {
    goto, respondent, currentQuestions, responses, setResponse,
    currentIndex, setCurrentIndex,
  } = useApp();

  // 직접 진입 방어 — 응답자 정보가 비었으면 시작화면으로
  useEffect(() => {
    if (!respondent.role) goto("start");
  }, [respondent.role, goto]);

  const total = currentQuestions.length;
  const q = currentQuestions[currentIndex];

  const answeredCount = useMemo(
    () => currentQuestions.filter((qq) => responses[qq.question_id]).length,
    [currentQuestions, responses]
  );

  const progressPct = total ? Math.round((answeredCount / total) * 1000) / 10 : 0;
  const isLast = currentIndex === total - 1;
  const currentAnswered = q ? !!responses[q.question_id] : false;

  // 미응답 문항 목록 (마지막 화면에서 결과 보기 시 안내용)
  const unansweredFirstIndex = useMemo(() => {
    for (let i = 0; i < currentQuestions.length; i++) {
      if (!responses[currentQuestions[i].question_id]) return i;
    }
    return -1;
  }, [currentQuestions, responses]);

  if (!q) {
    return html`<section class="card"><div class="loading">진단 문항을 준비하는 중...</div></section>`;
  }

  const onPick = (label) => setResponse(q.question_id, label);

  const onPrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
    else goto("start");
  };

  // 자유 이동: 응답 여부와 무관하게 다음으로 이동 가능 (테스트·검수 편의).
  // 마지막 문항에서는 모든 응답이 채워졌을 때만 결과 화면으로 이동하고,
  // 미응답이 있으면 첫 미응답 문항으로 점프해 응답을 유도한다.
  const onNext = () => {
    if (!isLast) {
      setCurrentIndex(currentIndex + 1);
      return;
    }
    if (unansweredFirstIndex >= 0) {
      setCurrentIndex(unansweredFirstIndex);
      return;
    }
    goto("result");
  };

  // 카테고리 단위 빠른 점프 (검수자가 특정 카테고리 위치에서 시작·이동)
  const jumpToCategory = (cat) => {
    const idx = currentQuestions.findIndex((qq) => qq.category === cat);
    if (idx >= 0) setCurrentIndex(idx);
  };
  const categoryStarts = useMemo(() => {
    const seen = new Set();
    const list = [];
    currentQuestions.forEach((qq, i) => {
      if (!seen.has(qq.category)) {
        seen.add(qq.category);
        list.push({ category: qq.category, index: i });
      }
    });
    return list;
  }, [currentQuestions]);

  // 카테고리 색상 클래스 (q-meta 배경)
  const catBgMap = {
    "Ⅰ. 공통": "var(--cat-1)",
    "Ⅱ. 설계": "var(--cat-2)",
    "Ⅲ. 운영": "var(--cat-3)",
    "Ⅳ. 평가": "var(--cat-4)",
    "Ⅴ. 개선": "var(--cat-5)",
  };

  return html`
    <section class="card">
      <div class="progress-meta">
        <span>${currentIndex + 1} / ${total} 문항 · 응답 완료 ${answeredCount}건</span>
        <span>${progressPct.toFixed(1)}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-bar__fill" style=${{ width: `${(answeredCount / total) * 100}%` }}></div>
      </div>

      <div class="q-meta" style=${{ marginTop: 24 }}>
        <span class="q-meta__cat" style=${{ background: catBgMap[q.category] }}>${q.category}</span>
        <span>${q.skill_id} · ${q.skill_name} · ${q.question_role}</span>
      </div>
      <div class="q-text">${q.question_text}</div>

      <${SkillInfoPanel} skillId=${q.skill_id} />

      <div class="choices" role="radiogroup" aria-label="선택지">
        ${q.choices.map((c) => {
          const selected = responses[q.question_id] === c.label;
          return html`
            <div
              key=${c.label}
              role="radio"
              tabIndex=${0}
              aria-checked=${selected}
              class=${"choice" + (selected ? " choice--selected" : "")}
              onClick=${() => onPick(c.label)}
              onKeyDown=${(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(c.label); } }}>
              <span class="choice__label">${c.label}</span>
              <span class="choice__text">${c.text}</span>
            </div>
          `;
        })}
      </div>

      ${isLast && unansweredFirstIndex >= 0 ? html`
        <div class="form-error" style=${{ marginTop: 12 }}>
          미응답 문항이 ${total - answeredCount}건 있습니다. "결과 보기"를 누르면 첫 미응답 문항으로 이동합니다.
        </div>
      ` : null}

      <div class="btn-row btn-row--between">
        <button class="btn btn--ghost" onClick=${onPrev}>
          ${currentIndex === 0 ? "← 처음으로" : "← 이전"}
        </button>
        <button
          class=${"btn " + (isLast && answeredCount === total ? "btn--accent" : "btn--primary")}
          onClick=${onNext}>
          ${isLast
            ? (answeredCount === total ? "결과 보기 →" : "미응답 확인 →")
            : (currentAnswered ? "다음 →" : "건너뛰고 다음 →")}
        </button>
      </div>

      <div style=${{
        marginTop: 18, paddingTop: 14, borderTop: "1px dashed var(--color-border)",
        fontSize: 12, color: "var(--color-text-muted)",
      }}>
        <div style=${{ marginBottom: 6 }}>
          카테고리 빠른 이동 (테스트·검수 편의):
        </div>
        <div style=${{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          ${categoryStarts.map(({ category, index }) => {
            const active = q.category === category;
            return html`
              <button
                key=${category}
                type="button"
                class=${"job-chip" + (active ? " job-chip--active" : "")}
                style=${{ fontSize: 11, padding: "4px 10px" }}
                onClick=${() => jumpToCategory(category)}>
                ${category}
              </button>
            `;
          })}
          <span style=${{ alignSelf: "center", marginLeft: 8 }}>
            (응답하지 않아도 자유 이동 가능)
          </span>
        </div>
      </div>
    </section>
  `;
}

// =====================================================================
// 5축 레이더 차트 (SVG, 외부 라이브러리 의존 없음)
// =====================================================================
function RadarChart({ scores, expected = 18, max = 24, categories }) {
  const W = 480, H = 480;
  const cx = W / 2, cy = H / 2;
  const radius = 170;
  const labelOffset = 28;
  const N = categories.length;

  const angleFor = (i) => -Math.PI / 2 + (2 * Math.PI / N) * i;

  const pointFor = (value, i) => {
    const a = angleFor(i);
    const r = (Math.max(0, Math.min(value, max)) / max) * radius;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  const ringFracs = [0.25, 0.5, 0.75, 1.0];
  const grids = ringFracs.map((frac, gi) => {
    const pts = categories
      .map((_, i) => pointFor(max * frac, i))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
    return html`<polygon key=${"g"+gi} points=${pts} class="radar-grid" />`;
  });

  const axes = categories.map((_, i) => {
    const [x, y] = pointFor(max, i);
    return html`<line key=${"a"+i} x1=${cx} y1=${cy} x2=${x.toFixed(1)} y2=${y.toFixed(1)} class="radar-axis" />`;
  });

  const labels = categories.map((cat, i) => {
    const a = angleFor(i);
    const r = radius + labelOffset;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a) + 4;
    // 카테고리명에서 로마 숫자 + 점 + 공백 제거 — "Ⅰ. 공통" → "공통"
    const short = cat.replace(/^[ⅠⅡⅢⅣⅤ]\.\s*/, "");
    return html`<text key=${"l"+i} x=${x.toFixed(1)} y=${y.toFixed(1)} class="radar-label">${short}</text>`;
  });

  // 기대선 (P=18)
  const expectedPts = categories
    .map((_, i) => pointFor(expected, i))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  // 본인 점수
  const actualPts = categories
    .map((cat, i) => pointFor(scores[cat] || 0, i))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  const actualDots = categories.map((cat, i) => {
    const [x, y] = pointFor(scores[cat] || 0, i);
    return html`<circle key=${"p"+i} cx=${x.toFixed(1)} cy=${y.toFixed(1)} r="4.5" class="radar-point" />`;
  });

  // 만점 24점 기준 눈금 텍스트 (위쪽 축에만 — 6/12/18/24)
  const tickLabels = ringFracs.map((frac, ti) => {
    const v = (max * frac).toFixed(0);
    const r = radius * frac;
    const y = cy - r + 1;
    return html`<text key=${"t"+ti} x=${cx + 6} y=${y.toFixed(1)}
      style=${{ fontSize: 10, fill: "var(--color-text-light)" }}>${v}</text>`;
  });

  return html`
    <div>
      <div class="radar-wrap">
        <svg class="radar-svg" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="카테고리 레이더 차트">
          ${grids}
          ${axes}
          ${tickLabels}
          <polygon points=${expectedPts} class="radar-expected" />
          <polygon points=${actualPts} class="radar-actual" />
          ${actualDots}
          ${labels}
        </svg>
      </div>
      <div class="radar-legend">
        <div class="radar-legend__item">
          <span class="radar-legend__swatch" style=${{ background: "var(--color-primary)" }}></span>
          본인 점수
        </div>
        <div class="radar-legend__item">
          <span class="radar-legend__swatch" style=${{ background: "var(--color-accent)" }}></span>
          기대선 (P · 18점)
        </div>
      </div>
    </div>
  `;
}

// =====================================================================
// 응답자 정보 메타 (3·4·5 화면 공통)
// =====================================================================
function RespondentMeta() {
  const { respondent } = useApp();
  const jobsText = respondent.role === "본부장"
    ? "통합 트랙 자동"
    : (respondent.jobs.length ? respondent.jobs.join(" · ") : "—");
  return html`
    <div style=${{
      display: "flex", flexWrap: "wrap", gap: "18px",
      fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "18px",
    }}>
      <span><strong style=${{ color: "var(--color-text)" }}>${respondent.name || "응답자"}</strong></span>
      <span>직책: ${respondent.role}</span>
      <span>소속: ${respondent.division}</span>
      <span>직무: ${jobsText}</span>
    </div>
  `;
}

// =====================================================================
// 화면 3: ResultScreen — 결과 요약
// =====================================================================
function ResultScreen() {
  const { goto, respondent, scoreResult } = useApp();

  // 미진단 상태로 직접 진입 방어
  useEffect(() => {
    if (!scoreResult) {
      // 응답자 정보부터 없으면 시작으로, 응답이 부족하면 진단 화면으로
      if (!respondent.role) goto("start");
      else goto("diagnose");
    }
  }, [scoreResult, respondent.role, goto]);

  if (!scoreResult) {
    return html`<section class="card"><div class="loading">결과를 계산하는 중...</div></section>`;
  }

  const { total, achievementRate, overallGrade } = scoreResult;
  const badgeClass = gradeBadgeClass(overallGrade);

  return html`
    <section class="card">
      <h2 class="section-title">결과 요약</h2>
      <${RespondentMeta} />

      <div class="result-hero">
        <div class="result-hero__score">
          ${total.toFixed(0)}<span class="result-hero__score-unit"> / 120점</span>
        </div>
        <div class="result-hero__rate">
          달성률 <strong>${achievementRate.toFixed(1)}%</strong>
        </div>
        <div>
          <span class=${"grade-badge grade-badge--lg " + badgeClass}>${overallGrade}</span>
        </div>
        <div class="diagnosis-line">${gradeMessage(overallGrade)}</div>
      </div>

      <div class="btn-row btn-row--between">
        <button class="btn btn--ghost" onClick=${() => goto("diagnose")}>← 진단 다시 보기</button>
        <button class="btn btn--primary" onClick=${() => goto("details")}>카테고리 상세 보기 →</button>
      </div>
    </section>
  `;
}

function DetailsScreen() {
  const { goto, scoreResult, respondent } = useApp();

  useEffect(() => {
    if (!scoreResult) {
      if (!respondent.role) goto("start");
      else goto("diagnose");
    }
  }, [scoreResult, respondent.role, goto]);

  if (!scoreResult) {
    return html`<section class="card"><div class="loading">결과를 준비하는 중...</div></section>`;
  }

  const { categories, categoryRates, categoryGrades, prescriptionIds } = scoreResult;
  const cats = matrix.categories;

  // 카테고리별 처방 핵심 진단 한 줄 (시트 18 diagnosis의 첫 마침표 또는 60자까지)
  const shortDiagnosis = (text) => {
    if (!text) return "";
    // "—" 같은 구분자 이후 또는 첫 마침표·물음표 직후로 자르기
    const dashIdx = text.indexOf("—");
    if (dashIdx > 0 && dashIdx < 80) return text.slice(0, dashIdx).trim();
    const sentEnd = text.search(/[.。!?]/);
    if (sentEnd > 0 && sentEnd < 80) return text.slice(0, sentEnd + 1).trim();
    return text.length > 80 ? text.slice(0, 78) + "…" : text;
  };

  return html`
    <section class="card">
      <h2 class="section-title">카테고리 상세</h2>
      <${RespondentMeta} />

      <${RadarChart} scores=${categories} expected=${18} max=${24} categories=${cats} />

      <p class="section-sub" style=${{ marginTop: 24 }}>
        만점 24점 기준 5축 레이더. 점선은 직책 기대선(P 수준 = 18점), 채움은 본인 점수입니다.
      </p>

      <div class="cat-grid">
        ${cats.map((cat, i) => {
          const score = categories[cat];
          const rate = categoryRates[cat];
          const grade = categoryGrades[cat];
          const rx = prescriptionById(prescriptionIds[i]);
          return html`
            <div key=${cat} class=${"cat-card " + categoryCardClass(cat)}>
              <div class="cat-card__name">${cat}</div>
              <div class="cat-card__score">
                ${score.toFixed(1)}<span class="cat-card__score-unit"> / 24점</span>
              </div>
              <div class="cat-card__rate">달성률 ${rate.toFixed(1)}%</div>
              <span class=${"grade-badge " + gradeBadgeClass(grade)}>${grade}</span>
              ${rx ? html`<div class="cat-card__diagnosis">${shortDiagnosis(rx.diagnosis)}</div>` : null}
            </div>
          `;
        })}
      </div>

      <div class="btn-row btn-row--between" style=${{ marginTop: 24 }}>
        <button class="btn btn--ghost" onClick=${() => goto("result")}>← 요약</button>
        <button class="btn btn--primary" onClick=${() => goto("prescribe")}>육성 처방 →</button>
      </div>
    </section>
  `;
}

// =====================================================================
// 처방 카드 (5장 카테고리별)
// =====================================================================
function PrescriptionCard({ category, grade, prescriptionId }) {
  const rx = prescriptionById(prescriptionId);
  const badgeClass = gradeBadgeClass(grade);

  if (!rx) {
    return html`
      <article class="rx-card">
        <div class="rx-card__head">
          <div>
            <div class="rx-card__id">${prescriptionId}</div>
            <div class="rx-card__title">${category}</div>
          </div>
          <span class=${"grade-badge " + badgeClass}>${grade}</span>
        </div>
        <div class="rx-card__diagnosis">처방 데이터를 찾을 수 없습니다 (ID: ${prescriptionId}).</div>
      </article>
    `;
  }

  return html`
    <article class="rx-card">
      <div class="rx-card__head">
        <div>
          <div class="rx-card__id">${rx.prescription_id}</div>
          <div class="rx-card__title">${rx.category}</div>
        </div>
        <span class=${"grade-badge " + badgeClass}>${rx.grade}</span>
      </div>

      <div class="rx-card__diagnosis">${rx.diagnosis}</div>

      <div class="rx-actions">
        <div class="rx-action">
          <div class="rx-action__label">OJT 70%</div>
          <div class="rx-action__body">${rx.ojt_70}</div>
        </div>
        <div class="rx-action">
          <div class="rx-action__label">코칭 20%</div>
          <div class="rx-action__body">${rx.coaching_20}</div>
        </div>
        <div class="rx-action">
          <div class="rx-action__label">사외교육 10%</div>
          <div class="rx-action__body">${rx.education_10}</div>
        </div>
      </div>

      <div class="rx-card__meta">
        <span>추천 기간: <strong>${rx.period}</strong></span>
        ${rx.note ? html`<span>비고: ${rx.note}</span>` : null}
        ${rx.score_range ? html`<span>점수 범위: ${rx.score_range}</span>` : null}
      </div>
    </article>
  `;
}

// =====================================================================
// 화면 5: PrescriptionScreen — 카테고리별 처방 + JSON 다운로드
// =====================================================================
function PrescriptionScreen() {
  const { goto, reset, scoreResult, respondent } = useApp();

  useEffect(() => {
    if (!scoreResult) {
      if (!respondent.role) goto("start");
      else goto("diagnose");
    }
  }, [scoreResult, respondent.role, goto]);

  if (!scoreResult) {
    return html`<section class="card"><div class="loading">처방을 준비하는 중...</div></section>`;
  }

  const { categoryGrades, prescriptionIds } = scoreResult;
  const categories = matrix.categories;

  const onDownload = () => {
    const data = buildExportJson(scoreResult, respondent);
    const filename = exportFilename(respondent.name, respondent.role);
    downloadJson(data, filename);
  };

  return html`
    <section class="card">
      <h2 class="section-title">육성 처방 (70-20-10)</h2>
      <${RespondentMeta} />

      <p class="section-sub" style=${{ marginTop: 0 }}>
        카테고리별 등급에 따라 시트 18 처방 라이브러리에서 자동 매칭된 5장 카드입니다.
      </p>

      ${categories.map((cat, i) => html`
        <${PrescriptionCard}
          key=${cat}
          category=${cat}
          grade=${categoryGrades[cat]}
          prescriptionId=${prescriptionIds[i]} />
      `)}

      <div class="btn-row btn-row--between">
        <button class="btn btn--ghost" onClick=${() => goto("details")}>← 카테고리 상세</button>
        <div style=${{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button class="btn btn--accent" onClick=${onDownload}>결과 JSON 다운로드</button>
          <button class="btn btn--ghost" onClick=${reset}>처음으로</button>
        </div>
      </div>
    </section>
  `;
}

// =====================================================================
// 라우터
// =====================================================================
function Router() {
  const { screen } = useApp();
  switch (screen) {
    case "start":     return html`<${StartScreen} />`;
    case "diagnose":  return html`<${DiagnoseScreen} />`;
    case "result":    return html`<${ResultScreen} />`;
    case "details":   return html`<${DetailsScreen} />`;
    case "prescribe": return html`<${PrescriptionScreen} />`;
    default:          return html`<${StartScreen} />`;
  }
}

// =====================================================================
// 진입점
// =====================================================================
function App() {
  return html`
    <${AppProvider}>
      <${AppShell}>
        <${Router} />
      </${AppShell}>
    </${AppProvider}>
  `;
}

const rootEl = document.getElementById("app");
const root = createRoot(rootEl);
root.render(html`<${App} />`);
