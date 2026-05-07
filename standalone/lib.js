/* =====================================================================
 * BTXKOREA 스킬 진단 — 핵심 로직 모듈
 *
 * 다음 5개 영역의 순수 함수를 모아 둠 (UI 비의존):
 *  - 스킬 선택   selectSkills(role, jobs, matrix)
 *  - 문항 선택   selectQuestions(skillIds, role, allQuestions)
 *  - 점수 산출   computeScores(responses, questions, scoringRules)
 *  - 등급 판정   gradeForRate(rate, thresholds)
 *  - 처방 매핑   prescriptionFor(category, grade)
 *
 * 시트 17(점수 산출 룰)과 시트 10(직책·직무 매트릭스)을 그대로 구현.
 * ===================================================================== */

import { matrix, scoring_rules, prescriptions, skills } from "./data.js";

// 스킬 ID로 정의·필요기술·필요지식·관리툴 등 메타데이터를 빠르게 조회.
const SKILL_INDEX = Object.fromEntries(skills.map((s) => [s.skill_id, s]));
export function skillById(id) {
  return SKILL_INDEX[id] || null;
}

// ---------------------------------------------------------------------
// 1. 스킬 선택 — 직책·직무에 따라 30스킬 ID 산출
// ---------------------------------------------------------------------

const ROLE_INTEGRATED_THRESHOLD = {
  "팀장":   3,  // 3개 이상 직무 선택 시 통합 자동
  "사업부장": 4, // 4개 이상 선택 시 통합 자동
};

/** 통합 트랙 케이스인지 판정 */
export function isIntegrated(role, jobs) {
  if (role === "본부장") return true;
  const n = jobs.length;
  if (role === "팀장" && n >= ROLE_INTEGRATED_THRESHOLD["팀장"]) return true;
  if (role === "사업부장" && n >= ROLE_INTEGRATED_THRESHOLD["사업부장"]) return true;
  return false;
}

/** 입력값에 대해 어떤 케이스가 적용되는지 (start 화면 안내용). */
export function caseFor(role, jobs) {
  if (isIntegrated(role, jobs)) return "integrated";
  if (jobs.length === 1) return "single";
  if (jobs.length === 2) return "two";
  return "invalid";
}

/**
 * 30스킬 ID 배열을 산출. (시트 10 매트릭스 룰 그대로)
 * 본부장 또는 한도 초과 → 통합 트랙
 * 팀장·사업부장 1개 직무   → 공통 6 + (공통 3 + 직무전용 3) × 4카테고리 = 30
 * 팀장·사업부장 2개 직무   → 공통 6 + (직무A 3 + 직무B 3) × 4카테고리 = 30
 * 통합 트랙              → 공통 6 + (공통 3 + 통합전용 3) × 4카테고리 = 30
 */
export function selectSkills(role, jobs) {
  const codes = matrix.job_codes;
  const out = ["C-01", "C-02", "C-03", "C-04", "C-05", "C-06"];
  const cats = ["S", "O", "E", "I"]; // 설계·운영·평가·개선

  if (isIntegrated(role, jobs)) {
    for (const c of cats) {
      out.push(`${c}-01`, `${c}-02`, `${c}-03`);
      out.push(`${c}-IN-01`, `${c}-IN-02`, `${c}-IN-03`);
    }
    return out;
  }
  if (jobs.length === 1) {
    const x = codes[jobs[0]];
    for (const c of cats) {
      out.push(`${c}-01`, `${c}-02`, `${c}-03`);
      out.push(`${c}-${x}-01`, `${c}-${x}-02`, `${c}-${x}-03`);
    }
    return out;
  }
  if (jobs.length === 2) {
    const a = codes[jobs[0]];
    const b = codes[jobs[1]];
    for (const c of cats) {
      out.push(`${c}-${a}-01`, `${c}-${a}-02`, `${c}-${a}-03`);
      out.push(`${c}-${b}-01`, `${c}-${b}-02`, `${c}-${b}-03`);
    }
    return out;
  }
  // jobs.length === 0 또는 3+ (팀장 3+은 위에서 통합으로 처리됨) — 폴백
  return out;
}

// ---------------------------------------------------------------------
// 2. 문항 선택 — 30스킬 × 3문항 = 90문항
// ---------------------------------------------------------------------

/** 직책 한글 → 코드 (T/D/H). 문항 ID 형식 [skillId]-[code]-Q[n]. */
export const ROLE_CODE = { "팀장": "T", "사업부장": "D", "본부장": "H" };

/**
 * 선택된 스킬 ID들과 응답자 직책에 매칭되는 문항만 추출.
 * 정렬: 입력 skillIds 순서 → 문항 번호(1,2,3) 순서.
 */
export function selectQuestions(skillIds, role, allQuestions) {
  const out = [];
  for (const sid of skillIds) {
    const matching = allQuestions
      .filter((q) => q.skill_id === sid && q.role === role)
      .sort((a, b) => (a.question_number || 0) - (b.question_number || 0));
    out.push(...matching);
  }
  return out;
}

// ---------------------------------------------------------------------
// 3. 점수 산출 — 시트 17 룰 그대로
// ---------------------------------------------------------------------

const EPDN = scoring_rules.epdn_score; // {E:4, P:3, D:2, N:1}
const CATEGORIES = matrix.categories;  // 5개

/** 라벨 ① 등을 EPDN 코드로 변환. 매핑 없으면 null. */
export function epdnFor(question, label) {
  const choice = question.choices.find((c) => c.label === label);
  return choice ? choice.epdn : null;
}

/** EPDN 코드를 점수(1~4)로. 없으면 null. */
export function scoreForEpdn(code) {
  return code != null && EPDN[code] != null ? EPDN[code] : null;
}

/** 두 자리 반올림. */
function round2(x) { return Math.round(x * 100) / 100; }
function round1(x) { return Math.round(x * 10) / 10; }

/**
 * 응답 객체로부터 종합 결과 산출.
 * @param responses { [qid]: "①"|"②"|"③"|"④" }
 * @param qs 진단 대상 90문항
 * @returns 점수·등급·처방·원본 응답을 모두 포함한 결과 객체
 */
export function computeScores(responses, qs) {
  // 스킬별로 문항 그룹핑
  const bySkill = new Map();
  const responseDetails = [];
  for (const q of qs) {
    if (!bySkill.has(q.skill_id)) bySkill.set(q.skill_id, []);
    bySkill.get(q.skill_id).push(q);

    const label = responses[q.question_id] || null;
    const epdn = label ? epdnFor(q, label) : null;
    const sc = scoreForEpdn(epdn);
    responseDetails.push({
      question_id: q.question_id,
      skill_id: q.skill_id,
      category: q.category,
      selected_choice: label,
      selected_epdn: epdn,
      score: sc,
    });
  }

  // 스킬 점수 (3문항 평균, 둘째 자리 반올림)
  const skillScores = {};
  const skillCategory = {};
  for (const [sid, items] of bySkill.entries()) {
    const scores = items.map((q) => {
      const r = responses[q.question_id];
      const e = r ? epdnFor(q, r) : null;
      return scoreForEpdn(e);
    });
    if (scores.some((s) => s == null)) {
      skillScores[sid] = null;
      skillCategory[sid] = items[0]?.category;
      continue;
    }
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    skillScores[sid] = round2(avg);
    skillCategory[sid] = items[0].category;
  }

  // 카테고리 점수 (6스킬 합산)
  const categoryScores = {};
  for (const cat of CATEGORIES) categoryScores[cat] = 0;
  for (const sid of Object.keys(skillScores)) {
    const cat = skillCategory[sid];
    const s = skillScores[sid];
    if (cat && s != null) categoryScores[cat] += s;
  }
  // 둘째 자리 반올림 (부동소수 안전)
  for (const cat of CATEGORIES) categoryScores[cat] = round2(categoryScores[cat]);

  // 종합 점수 (5카테고리 합)
  const total = round2(
    CATEGORIES.reduce((sum, cat) => sum + categoryScores[cat], 0)
  );

  // 달성률 (직책 무관 90점 기대선)
  const rate = round1((total / 90) * 100);

  // 종합 등급 + 카테고리 등급 + 처방 ID
  const overallGrade = gradeForRate(rate, scoring_rules.overall_grade_thresholds);
  const categoryGrades = {};
  const categoryRates = {};
  const prescriptionIds = [];
  for (const cat of CATEGORIES) {
    const cRate = round1((categoryScores[cat] / 18) * 100);
    categoryRates[cat] = cRate;
    const cGrade = gradeForRate(cRate, scoring_rules.category_grade_thresholds);
    categoryGrades[cat] = cGrade;
    prescriptionIds.push(prescriptionIdFor(cat, cGrade));
  }

  return {
    skills: skillScores,
    categories: categoryScores,
    categoryRates,
    total,
    achievementRate: rate,
    overallGrade,
    categoryGrades,
    prescriptionIds,
    responseDetails,
  };
}

// ---------------------------------------------------------------------
// 4. 등급 판정
// ---------------------------------------------------------------------

/** 달성률을 임계값 배열에 비교해 등급 라벨 반환. */
export function gradeForRate(rate, thresholds) {
  // thresholds는 min_rate 내림차순으로 정의되어 있음
  for (const t of thresholds) {
    if (rate >= t.min_rate) return t.grade;
  }
  return thresholds[thresholds.length - 1].grade;
}

// ---------------------------------------------------------------------
// 5. 처방 매핑
// ---------------------------------------------------------------------

const CAT_TO_RX = scoring_rules.prescription_id_map;
const GRADE_TO_CODE = scoring_rules.grade_code_map;

/** "Ⅲ. 운영" + "안정" → "OPS-S" */
export function prescriptionIdFor(category, grade) {
  const cat = CAT_TO_RX[category];
  const gc = GRADE_TO_CODE[grade];
  return `${cat}-${gc}`;
}

const PRESCRIPTION_INDEX = Object.fromEntries(
  prescriptions.map((p) => [p.prescription_id, p])
);

/** prescription_id로 처방 객체 조회. 없으면 null. */
export function prescriptionById(id) {
  return PRESCRIPTION_INDEX[id] || null;
}

// ---------------------------------------------------------------------
// 6. 헬퍼: 등급 → CSS 변종 클래스
// ---------------------------------------------------------------------

const GRADE_CLASS = {
  "우수":     "grade-badge--excellent",
  "안정":     "grade-badge--stable",
  "보완 필요": "grade-badge--needs",
  "집중 육성": "grade-badge--focus",
};
export function gradeBadgeClass(grade) {
  return GRADE_CLASS[grade] || "";
}

// ---------------------------------------------------------------------
// 7. 카테고리 → 카테고리 카드 변종
// ---------------------------------------------------------------------
const CAT_CLASS = {
  "Ⅰ. 공통": "cat-card--c1",
  "Ⅱ. 설계": "cat-card--c2",
  "Ⅲ. 운영": "cat-card--c3",
  "Ⅳ. 평가": "cat-card--c4",
  "Ⅴ. 개선": "cat-card--c5",
};
export function categoryCardClass(cat) {
  return CAT_CLASS[cat] || "";
}

// ---------------------------------------------------------------------
// 8. 등급별 한 줄 진단 메시지
// ---------------------------------------------------------------------
export function gradeMessage(grade) {
  return scoring_rules.grade_messages[grade] || "";
}

// ---------------------------------------------------------------------
// 9. 결과 → 사양서 4.4 스키마 JSON 직렬화
// ---------------------------------------------------------------------

/** Date → ISO 8601 with KST(+09:00) 표기. */
function toKSTIso(date) {
  // 사용자 로컬이 KST가 아닐 수도 있으므로 UTC 시각 + 09:00 오프셋으로 강제 변환
  const utcMs = date.getTime();
  const kst = new Date(utcMs + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}` +
    `T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}+09:00`
  );
}

/** 사양서 4.4 스키마에 맞춰 직렬화. */
export function buildExportJson(result, respondent, when = new Date()) {
  return {
    respondent: {
      name: respondent.name,
      role: respondent.role,
      division: respondent.division,
      // 본부장은 jobs 비어 있는 상태인데, 통합 자동 적용을 명시적으로 표기
      jobs: respondent.jobs && respondent.jobs.length ? respondent.jobs : ["통합"],
      submitted_at: toKSTIso(when),
    },
    responses: result.responseDetails,
    scores: {
      skills: result.skills,
      categories: result.categories,
      total: result.total,
      achievement_rate: result.achievementRate,
    },
    grades: {
      overall: result.overallGrade,
      categories: result.categoryGrades,
    },
    prescriptions: result.prescriptionIds,
  };
}

/** "진단결과_[이름]_[직책]_[YYYYMMDD_HHMMSS].json" 파일명 생성. */
export function exportFilename(name, role, when = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const ts =
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `_${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  const safeName = (name || "응답자").replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
  const safeRole = role || "직책";
  return `진단결과_${safeName}_${safeRole}_${ts}.json`;
}

/** Blob을 만들어 사용자 다운로드 트리거. */
export function downloadJson(data, filename) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
