"""
Survey service — business logic for the MemoLink Evaluation Survey.

Keeps research data (survey_*) separate from product feedback (feedback table).
Questions are fully dynamic and admin-editable; answers are stored long-format
for easy aggregation and CSV export.
"""
import io
import csv
import json
import re
from typing import Optional, List, Dict, Any

from memolink_backend.domain.repositories.survey_repository import SurveyRepository
from memolink_backend.domain.survey_seed import (
    DEFAULT_SURVEY_QUESTIONS, SURVEY_CONSENT_TEXT, SURVEY_INTRO,
)
from memolink_backend.contracts.survey_dtos import (
    SurveyQuestionDTO, SurveySectionDTO, ActiveSurveyDTO,
    SurveySubmitRequest, SurveySubmitResponse,
    QuestionUpsertRequest,
    QuestionReportDTO, SurveyReportDTO,
    SurveyResponseRowDTO, SurveyResponsesDTO,
)

SURVEY_TITLE = "MemoLink Prototype Evaluation Survey"
_TEXT_TYPES = {"short", "long"}
_VALID_TYPES = {"likert", "single", "multi", "short", "long"}
_LIKERT_KEYS = ["1", "2", "3", "4", "5"]


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return (s[:60] or "question")


def _to_dto(q) -> SurveyQuestionDTO:
    return SurveyQuestionDTO(
        id=q.id,
        section=q.section,
        question_key=q.question_key,
        question_text=q.question_text,
        answer_type=q.answer_type,
        options=list(q.options or []),
        order_index=q.order_index,
        required=q.required,
        active=q.active,
    )


def _parse_stored(value: Optional[str], answer_type: str) -> Any:
    """Multi answers are stored as a JSON array string; everything else as text."""
    if value is None:
        return [] if answer_type == "multi" else ""
    if answer_type == "multi":
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else [str(parsed)]
        except (ValueError, TypeError):
            return [v.strip() for v in value.split(";") if v.strip()]
    return value


class SurveyService:
    def __init__(self, repo: SurveyRepository):
        self._repo = repo

    # ── User: active survey + submit ─────────────────────────────────────────
    def get_active_survey(self) -> ActiveSurveyDTO:
        questions = self._repo.list_questions(active_only=True)
        sections: List[SurveySectionDTO] = []
        by_section: Dict[str, List[SurveyQuestionDTO]] = {}
        order: List[str] = []
        for q in questions:
            if q.section not in by_section:
                by_section[q.section] = []
                order.append(q.section)
            by_section[q.section].append(_to_dto(q))
        for sec in order:
            sections.append(SurveySectionDTO(section=sec, questions=by_section[sec]))
        return ActiveSurveyDTO(
            title=SURVEY_TITLE,
            intro=SURVEY_INTRO,
            consent_text=SURVEY_CONSENT_TEXT,
            sections=sections,
        )

    def submit(self, user_id: Optional[int], req: SurveySubmitRequest) -> SurveySubmitResponse:
        if not req.consent_confirmed:
            raise ValueError("Consent is required before submitting the survey.")

        code = f"P{self._repo.max_participant_number() + 1:03d}"

        # Pull background fields onto the response row for convenient reporting/export
        answer_map = {a.question_key: a.answer_value for a in req.answers}
        role = answer_map.get("role")
        freq = answer_map.get("ai_tool_usage_frequency")

        response = self._repo.create_response(
            user_id=user_id,
            workspace_id=req.workspace_id,
            participant_code=code,
            role=str(role) if isinstance(role, str) else None,
            ai_tool_usage_frequency=str(freq) if isinstance(freq, str) else None,
            consent_confirmed=True,
        )

        for ans in req.answers:
            q = self._repo.get_question_by_key(ans.question_key)
            answer_type = q.answer_type if q else "short"
            val = ans.answer_value
            if isinstance(val, list):
                stored = json.dumps([str(v) for v in val])
            elif val is None:
                stored = None
            else:
                stored = str(val)
            if stored in (None, "", "[]"):
                continue  # skip blanks
            self._repo.add_answer(
                survey_response_id=response.id,
                question_key=ans.question_key,
                question_text=q.question_text if q else ans.question_key,
                answer_type=answer_type,
                answer_value=stored,
            )
        self._repo.commit()
        return SurveySubmitResponse(ok=True, response_id=response.id, participant_code=code)

    # ── Admin: question management ───────────────────────────────────────────
    def list_questions(self) -> List[SurveyQuestionDTO]:
        return [_to_dto(q) for q in self._repo.list_questions(active_only=False)]

    def create_question(self, body: QuestionUpsertRequest) -> SurveyQuestionDTO:
        if body.answer_type not in _VALID_TYPES:
            raise ValueError(f"Invalid answer_type. Must be one of: {', '.join(sorted(_VALID_TYPES))}")
        key = (body.question_key or _slugify(body.question_text)).strip()
        # Ensure unique key
        base, n = key, 2
        while self._repo.get_question_by_key(key):
            key = f"{base}_{n}"
            n += 1
        q = self._repo.create_question(
            section=body.section or "General",
            question_key=key,
            question_text=body.question_text,
            answer_type=body.answer_type,
            options=body.options if body.answer_type in ("single", "multi") else [],
            order_index=body.order_index if body.order_index is not None else self._repo.next_order_index(),
            required=body.required,
            active=body.active,
        )
        return _to_dto(q)

    def update_question(self, question_id: int, body: QuestionUpsertRequest) -> SurveyQuestionDTO:
        q = self._repo.get_question(question_id)
        if not q:
            raise ValueError("Question not found")
        if body.answer_type and body.answer_type not in _VALID_TYPES:
            raise ValueError(f"Invalid answer_type. Must be one of: {', '.join(sorted(_VALID_TYPES))}")
        fields = {
            "section": body.section,
            "question_text": body.question_text,
            "answer_type": body.answer_type,
            "options": body.options if body.answer_type in ("single", "multi") else [],
            "required": body.required,
            "active": body.active,
        }
        if body.order_index is not None:
            fields["order_index"] = body.order_index
        if body.question_key:
            fields["question_key"] = body.question_key
        q = self._repo.update_question(q, fields)
        return _to_dto(q)

    def delete_question(self, question_id: int) -> None:
        q = self._repo.get_question(question_id)
        if not q:
            raise ValueError("Question not found")
        self._repo.delete_question(q)

    def reset_default_questions(self) -> int:
        """Re-seed any default questions that are missing (idempotent)."""
        added = 0
        for i, qd in enumerate(DEFAULT_SURVEY_QUESTIONS):
            if not self._repo.get_question_by_key(qd["question_key"]):
                self._repo.create_question(
                    section=qd["section"],
                    question_key=qd["question_key"],
                    question_text=qd["question_text"],
                    answer_type=qd["answer_type"],
                    options=qd.get("options", []),
                    order_index=i,
                    required=qd.get("required", False),
                    active=True,
                )
                added += 1
        return added

    # ── Admin: reporting ─────────────────────────────────────────────────────
    def get_report(self) -> SurveyReportDTO:
        questions = self._repo.list_questions(active_only=False)
        answers = self._repo.all_answers()
        grouped: Dict[str, List[str]] = {}
        for a in answers:
            grouped.setdefault(a.question_key, []).append(a.answer_value)

        out: List[QuestionReportDTO] = []
        for q in questions:
            vals = grouped.get(q.question_key, [])
            dist: Dict[str, int] = {}
            avg: Optional[float] = None
            texts: List[str] = []

            if q.answer_type == "likert":
                dist = {k: 0 for k in _LIKERT_KEYS}
                nums: List[int] = []
                for v in vals:
                    sv = str(v).strip()
                    if sv in dist:
                        dist[sv] += 1
                        nums.append(int(sv))
                if nums:
                    avg = round(sum(nums) / len(nums), 2)
            elif q.answer_type == "single":
                for opt in (q.options or []):
                    dist[opt] = 0
                for v in vals:
                    sv = str(v).strip()
                    dist[sv] = dist.get(sv, 0) + 1
            elif q.answer_type == "multi":
                for opt in (q.options or []):
                    dist[opt] = 0
                for v in vals:
                    for item in _parse_stored(v, "multi"):
                        dist[item] = dist.get(item, 0) + 1
            else:  # short / long
                texts = [str(v).strip() for v in vals if str(v).strip()]

            out.append(QuestionReportDTO(
                question_key=q.question_key,
                question_text=q.question_text,
                section=q.section,
                answer_type=q.answer_type,
                response_count=len(vals),
                distribution=dist,
                average=avg,
                text_answers=texts,
            ))
        return SurveyReportDTO(total_responses=self._repo.count_responses(), questions=out)

    def get_responses(self) -> SurveyResponsesDTO:
        responses = self._repo.list_responses()
        rows: List[SurveyResponseRowDTO] = []
        for r in responses:
            ans = self._repo.answers_for_response(r.id)
            amap: Dict[str, Any] = {}
            for a in ans:
                amap[a.question_key] = _parse_stored(a.answer_value, a.answer_type or "short")
            rows.append(SurveyResponseRowDTO(
                id=r.id,
                participant_code=r.participant_code,
                role=r.role,
                ai_tool_usage_frequency=r.ai_tool_usage_frequency,
                consent_confirmed=r.consent_confirmed,
                submitted_at=str(r.submitted_at) if r.submitted_at else None,
                answers=amap,
            ))
        return SurveyResponsesDTO(total=len(rows), responses=rows)

    def export_csv(self) -> str:
        """Wide CSV — one row per response, one column per question."""
        questions = self._repo.list_questions(active_only=False)
        responses = self._repo.list_responses()

        headers = ["participant_code", "role", "ai_tool_usage_frequency",
                   "consent_confirmed", "submitted_at"]
        headers += [q.question_key for q in questions]

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(headers)

        for r in responses:
            ans = {a.question_key: _parse_stored(a.answer_value, a.answer_type or "short")
                   for a in self._repo.answers_for_response(r.id)}
            row = [
                r.participant_code or "",
                r.role or "",
                r.ai_tool_usage_frequency or "",
                "yes" if r.consent_confirmed else "no",
                str(r.submitted_at) if r.submitted_at else "",
            ]
            for q in questions:
                v = ans.get(q.question_key, "")
                if isinstance(v, list):
                    v = "; ".join(v)
                row.append(v)
            writer.writerow(row)
        return buf.getvalue()
