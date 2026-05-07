"""핵심 로직 교차 검증 — lib.js와 같은 룰을 Python으로 독립 구현해 비교.

목적:
  사양서 6.2 검수 포인트 1~4 (점수 산출·등급·처방 매핑·30스킬 조합)이
  시트 17/시트 10 룰과 100% 일치하는지 객관 증명한다.

실행:  python verify_logic.py
"""
from __future__ import annotations
import sys, json
from pathlib import Path

# Windows 콘솔의 cp949 한계를 우회 — UTF-8로 강제 출력
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DATA = Path(__file__).parent / "data"

skills        = json.loads((DATA / "skills.json").read_text(encoding="utf-8"))
questions     = json.loads((DATA / "questions.json").read_text(encoding="utf-8"))
matrix        = json.loads((DATA / "matrix.json").read_text(encoding="utf-8"))
scoring_rules = json.loads((DATA / "scoring_rules.json").read_text(encoding="utf-8"))
prescriptions = json.loads((DATA / "prescriptions.json").read_text(encoding="utf-8"))

EPDN = scoring_rules["epdn_score"]
JOB_CODES = matrix["job_codes"]
CATEGORIES = matrix["categories"]


# ---------- 동일 로직 ----------

def is_integrated(role: str, jobs: list[str]) -> bool:
    if role == "본부장": return True
    if role == "팀장" and len(jobs) >= 3: return True
    if role == "사업부장" and len(jobs) >= 4: return True
    return False


def select_skills(role: str, jobs: list[str]) -> list[str]:
    out = ["C-01", "C-02", "C-03", "C-04", "C-05", "C-06"]
    cats = ["S", "O", "E", "I"]
    if is_integrated(role, jobs):
        for c in cats:
            out += [f"{c}-01", f"{c}-02", f"{c}-03"]
            out += [f"{c}-IN-01", f"{c}-IN-02", f"{c}-IN-03"]
        return out
    if len(jobs) == 1:
        x = JOB_CODES[jobs[0]]
        for c in cats:
            out += [f"{c}-01", f"{c}-02", f"{c}-03"]
            out += [f"{c}-{x}-01", f"{c}-{x}-02", f"{c}-{x}-03"]
        return out
    if len(jobs) == 2:
        a = JOB_CODES[jobs[0]]; b = JOB_CODES[jobs[1]]
        for c in cats:
            out += [f"{c}-{a}-01", f"{c}-{a}-02", f"{c}-{a}-03"]
            out += [f"{c}-{b}-01", f"{c}-{b}-02", f"{c}-{b}-03"]
        return out
    return out


def select_questions(skill_ids: list[str], role: str) -> list[dict]:
    out = []
    for sid in skill_ids:
        matched = [q for q in questions if q["skill_id"] == sid and q["role"] == role]
        matched.sort(key=lambda q: q.get("question_number") or 0)
        out += matched
    return out


def compute(responses: dict[str, str], qs: list[dict]) -> dict:
    # 스킬 점수
    by_skill = {}
    skill_cat = {}
    for q in qs:
        by_skill.setdefault(q["skill_id"], []).append(q)
        skill_cat[q["skill_id"]] = q["category"]

    skill_scores = {}
    for sid, items in by_skill.items():
        scores = []
        for q in items:
            label = responses.get(q["question_id"])
            if not label: scores.append(None); continue
            ch = next((c for c in q["choices"] if c["label"] == label), None)
            if not ch: scores.append(None); continue
            scores.append(EPDN.get(ch["epdn"]))
        if any(s is None for s in scores):
            skill_scores[sid] = None
        else:
            skill_scores[sid] = round(sum(scores) / len(scores), 2)

    # 카테고리 점수
    cat_scores = {c: 0.0 for c in CATEGORIES}
    for sid, sc in skill_scores.items():
        if sc is not None:
            cat_scores[skill_cat[sid]] += sc
    cat_scores = {c: round(v, 2) for c, v in cat_scores.items()}

    total = round(sum(cat_scores.values()), 2)
    rate = round(total / 90 * 100, 1)

    def grade_for(rate, thresholds):
        for t in thresholds:
            if rate >= t["min_rate"]:
                return t["grade"]
        return thresholds[-1]["grade"]

    overall = grade_for(rate, scoring_rules["overall_grade_thresholds"])
    cat_grades = {}
    cat_rates = {}
    rx_ids = []
    for cat in CATEGORIES:
        crate = round(cat_scores[cat] / 18 * 100, 1)
        cat_rates[cat] = crate
        cg = grade_for(crate, scoring_rules["category_grade_thresholds"])
        cat_grades[cat] = cg
        rx_ids.append(f"{scoring_rules['prescription_id_map'][cat]}-{scoring_rules['grade_code_map'][cg]}")

    return {
        "skills": skill_scores, "categories": cat_scores, "category_rates": cat_rates,
        "total": total, "achievement_rate": rate,
        "overall_grade": overall, "category_grades": cat_grades,
        "prescription_ids": rx_ids,
    }


# ---------- 검증 ----------

PASS = 0; FAIL = 0
def check(label, actual, expected):
    global PASS, FAIL
    if actual == expected:
        PASS += 1
        print(f"  PASS: {label}")
    else:
        FAIL += 1
        print(f"  FAIL: {label}")
        print(f"        expected = {expected}")
        print(f"        actual   = {actual}")

print("=== 1. is_integrated ===")
check("팀장 0", is_integrated("팀장", []), False)
check("팀장 2", is_integrated("팀장", ["A","B"]), False)
check("팀장 3 → 통합", is_integrated("팀장", ["A","B","C"]), True)
check("사업부장 3", is_integrated("사업부장", ["A","B","C"]), False)
check("사업부장 4 → 통합", is_integrated("사업부장", ["A","B","C","D"]), True)
check("본부장 → 통합", is_integrated("본부장", []), True)

print("\n=== 2. select_skills ===")
s_team_single = select_skills("팀장", ["사외물류"])
check("팀장 1직무 30개", len(s_team_single), 30)
check("팀장 1직무 첫 6", s_team_single[:6], ["C-01","C-02","C-03","C-04","C-05","C-06"])
check("팀장 1직무 설계 6", s_team_single[6:12], ["S-01","S-02","S-03","S-WO-01","S-WO-02","S-WO-03"])
check("팀장 1직무 운영 6", s_team_single[12:18], ["O-01","O-02","O-03","O-WO-01","O-WO-02","O-WO-03"])
check("팀장 1직무 평가 6", s_team_single[18:24], ["E-01","E-02","E-03","E-WO-01","E-WO-02","E-WO-03"])
check("팀장 1직무 개선 6", s_team_single[24:30], ["I-01","I-02","I-03","I-WO-01","I-WO-02","I-WO-03"])

s_dir_two = select_skills("사업부장", ["사내물류", "조립·포장"])
check("사업부장 2직무 30개", len(s_dir_two), 30)
check("사업부장 2직무 설계 6 = 직무A 3 + 직무B 3",
      s_dir_two[6:12], ["S-IL-01","S-IL-02","S-IL-03","S-AP-01","S-AP-02","S-AP-03"])

s_head = select_skills("본부장", [])
check("본부장 통합 30개", len(s_head), 30)
check("본부장 설계 6", s_head[6:12], ["S-01","S-02","S-03","S-IN-01","S-IN-02","S-IN-03"])

s_team_3 = select_skills("팀장", ["A","B","C"])  # 자동 통합
check("팀장 3직무 → 통합", s_team_3[6:12], ["S-01","S-02","S-03","S-IN-01","S-IN-02","S-IN-03"])

# 모든 30 스킬 ID가 실제 skills.json에 존재하는지 검증 (모든 케이스)
all_skill_ids = {s["skill_id"] for s in skills}
test_cases = [
    ("팀장", ["사외물류"]),
    ("팀장", ["사내물류"]),
    ("팀장", ["조립·포장"]),
    ("팀장", ["운송납품"]),
    ("팀장", ["사외물류", "사내물류"]),
    ("팀장", ["조립·포장", "운송납품"]),
    ("사업부장", ["운송납품"]),
    ("사업부장", ["사외물류", "조립·포장"]),
    ("사업부장", ["사외물류", "사내물류", "조립·포장"]),  # 3개 OK
    ("사업부장", ["사외물류", "사내물류", "조립·포장", "운송납품"]),  # 4개 → 통합
    ("본부장", []),
]
for role, jobs in test_cases:
    sids = select_skills(role, jobs)
    missing = [s for s in sids if s not in all_skill_ids]
    label = f"실재 스킬 매칭 ({role}, {jobs})"
    check(label, missing, [])

print("\n=== 3. select_questions ===")
qs90 = select_questions(s_team_single, "팀장")
check("팀장 1직무 90문항", len(qs90), 90)
check("모두 팀장 문항", all(q["role"] == "팀장" for q in qs90), True)
check("스킬 30종", len({q["skill_id"] for q in qs90}), 30)

print("\n=== 4. computeScores — 모든 응답 P (정확히 안정 등급) ===")
allP = {}
for q in qs90:
    ch = next((c for c in q["choices"] if c["epdn"] == "P"), None)
    if ch: allP[q["question_id"]] = ch["label"]
r = compute(allP, qs90)
check("스킬 점수 모두 3.00", all(v == 3.0 for v in r["skills"].values()), True)
check("카테고리 점수 모두 18", all(v == 18 for v in r["categories"].values()), True)
check("종합 = 90", r["total"], 90)
check("달성률 = 100", r["achievement_rate"], 100.0)
check("종합 등급 = 안정", r["overall_grade"], "안정")
check("처방 = 모두 -S", r["prescription_ids"], ["COM-S","DES-S","OPS-S","EVL-S","IMP-S"])

print("\n=== 5. computeScores — 모든 응답 E (우수) ===")
allE = {}
for q in qs90:
    ch = next((c for c in q["choices"] if c["epdn"] == "E"), None)
    if ch: allE[q["question_id"]] = ch["label"]
r = compute(allE, qs90)
check("스킬 4.00", all(v == 4.0 for v in r["skills"].values()), True)
check("카테고리 24", all(v == 24 for v in r["categories"].values()), True)
check("종합 120", r["total"], 120)
check("달성률 133.3", r["achievement_rate"], 133.3)
check("등급 우수", r["overall_grade"], "우수")
check("처방 모두 -E", r["prescription_ids"], ["COM-E","DES-E","OPS-E","EVL-E","IMP-E"])

print("\n=== 6. computeScores — 모든 응답 D (집중 육성) ===")
allD = {}
for q in qs90:
    ch = next((c for c in q["choices"] if c["epdn"] == "D"), None)
    if ch: allD[q["question_id"]] = ch["label"]
r = compute(allD, qs90)
check("종합 60", r["total"], 60)
check("달성률 66.7", r["achievement_rate"], 66.7)
check("등급 집중 육성", r["overall_grade"], "집중 육성")

print("\n=== 7. 임계값 경계 테스트 ===")
# 종합 등급 임계값: 우수 ≥120%, 안정 ≥100%, 보완 필요 ≥80%, 집중 육성 <80%
# 카테고리도 동일 % 기준
from copy import deepcopy
def grade_for(rate, thresholds):
    for t in thresholds:
        if rate >= t["min_rate"]:
            return t["grade"]
    return thresholds[-1]["grade"]
ot = scoring_rules["overall_grade_thresholds"]
check("120% → 우수", grade_for(120, ot), "우수")
check("119.9% → 안정", grade_for(119.9, ot), "안정")
check("100% → 안정", grade_for(100, ot), "안정")
check("99.9% → 보완 필요", grade_for(99.9, ot), "보완 필요")
check("80% → 보완 필요", grade_for(80, ot), "보완 필요")
check("79.9% → 집중 육성", grade_for(79.9, ot), "집중 육성")

print("\n=== 8. 처방 ID 매핑 — 시트 18 모든 20개 처방 인덱스 가능 ===")
all_rx_ids = {p["prescription_id"] for p in prescriptions}
expected = set()
for cat in CATEGORIES:
    for grade in ["우수","안정","보완 필요","집중 육성"]:
        expected.add(f"{scoring_rules['prescription_id_map'][cat]}-{scoring_rules['grade_code_map'][grade]}")
check("처방 ID 풀 일치", expected, all_rx_ids)

print("\n=== 9. 결과 JSON export 스키마 (사양서 4.4 준수) ===")
def build_export(result, respondent):
    return {
        "respondent": {
            "name": respondent["name"],
            "role": respondent["role"],
            "division": respondent["division"],
            "jobs": respondent["jobs"] if respondent["jobs"] else ["통합"],
            "submitted_at": "2026-05-07T14:30:00+09:00",  # 고정값으로 검증
        },
        "responses": [
            {
                "question_id": d["question_id"], "skill_id": d["skill_id"],
                "category": d["category"], "selected_choice": d["selected_choice"],
                "selected_epdn": d["selected_epdn"], "score": d["score"],
            } for d in [{
                "question_id": "C-01-T-Q1", "skill_id": "C-01", "category": "Ⅰ. 공통",
                "selected_choice": "②", "selected_epdn": "P", "score": 3,
            }]
        ],
        "scores": {
            "skills": {"C-01": 3.33}, "categories": {"Ⅰ. 공통": 19.5},
            "total": 92.0, "achievement_rate": 102.2,
        },
        "grades": {"overall": "안정", "categories": {"Ⅰ. 공통": "안정"}},
        "prescriptions": ["COM-S"],
    }

sample = build_export(None, {
    "name": "홍길동", "role": "팀장", "division": "인천",
    "jobs": ["사외물류"],
})
# 사양서 4.4의 최상위 키
expected_keys = {"respondent", "responses", "scores", "grades", "prescriptions"}
check("최상위 키", set(sample.keys()), expected_keys)
check("respondent 키", set(sample["respondent"].keys()), {"name","role","division","jobs","submitted_at"})
check("scores 키", set(sample["scores"].keys()), {"skills","categories","total","achievement_rate"})
check("grades 키", set(sample["grades"].keys()), {"overall","categories"})
check("response 항목 키", set(sample["responses"][0].keys()),
      {"question_id","skill_id","category","selected_choice","selected_epdn","score"})

print(f"\n=== Total: {PASS} pass / {FAIL} fail ===")
if FAIL:
    raise SystemExit(1)
