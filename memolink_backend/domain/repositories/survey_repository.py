"""
Survey repository - all SQLAlchemy queries for the evaluation survey.
"""
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import func

from memolink_backend.domain.models.survey import (
    SurveyQuestion, SurveyResponse, SurveyAnswer,
)


class SurveyRepository:
    def __init__(self, db: Session):
        self._db = db

    # ── Questions ────────────────────────────────────────────────────────────
    def list_questions(self, active_only: bool = False) -> List[SurveyQuestion]:
        q = self._db.query(SurveyQuestion)
        if active_only:
            q = q.filter(SurveyQuestion.active.is_(True))
        return q.order_by(SurveyQuestion.order_index, SurveyQuestion.id).all()

    def get_question(self, question_id: int) -> Optional[SurveyQuestion]:
        return self._db.query(SurveyQuestion).filter(SurveyQuestion.id == question_id).first()

    def get_question_by_key(self, key: str) -> Optional[SurveyQuestion]:
        return self._db.query(SurveyQuestion).filter(SurveyQuestion.question_key == key).first()

    def next_order_index(self) -> int:
        m = self._db.query(func.max(SurveyQuestion.order_index)).scalar()
        return (m or 0) + 1

    def create_question(self, **kwargs) -> SurveyQuestion:
        q = SurveyQuestion(**kwargs)
        self._db.add(q)
        self._db.commit()
        self._db.refresh(q)
        return q

    def update_question(self, question: SurveyQuestion, fields: dict) -> SurveyQuestion:
        for k, v in fields.items():
            if v is not None and hasattr(question, k):
                setattr(question, k, v)
        self._db.commit()
        self._db.refresh(question)
        return question

    def delete_question(self, question: SurveyQuestion) -> None:
        self._db.delete(question)
        self._db.commit()

    def count_questions(self) -> int:
        return self._db.query(func.count(SurveyQuestion.id)).scalar() or 0

    # ── Responses & answers ──────────────────────────────────────────────────
    def create_response(self, **kwargs) -> SurveyResponse:
        r = SurveyResponse(**kwargs)
        self._db.add(r)
        self._db.commit()
        self._db.refresh(r)
        return r

    def add_answer(self, **kwargs) -> SurveyAnswer:
        a = SurveyAnswer(**kwargs)
        self._db.add(a)
        return a

    def commit(self) -> None:
        self._db.commit()

    def list_responses(self) -> List[SurveyResponse]:
        return self._db.query(SurveyResponse).order_by(SurveyResponse.submitted_at.desc()).all()

    def get_response(self, response_id: int) -> Optional[SurveyResponse]:
        return self._db.query(SurveyResponse).filter(SurveyResponse.id == response_id).first()

    def get_response_by_user(self, user_id: int) -> Optional[SurveyResponse]:
        return (
            self._db.query(SurveyResponse)
            .filter(SurveyResponse.user_id == user_id)
            .order_by(SurveyResponse.id.asc())
            .first()
        )

    def delete_answers_for_response(self, response_id: int) -> None:
        self._db.query(SurveyAnswer).filter(
            SurveyAnswer.survey_response_id == response_id
        ).delete(synchronize_session=False)

    def answers_for_response(self, response_id: int) -> List[SurveyAnswer]:
        return (
            self._db.query(SurveyAnswer)
            .filter(SurveyAnswer.survey_response_id == response_id)
            .all()
        )

    def all_answers(self) -> List[SurveyAnswer]:
        return self._db.query(SurveyAnswer).all()

    def count_responses(self) -> int:
        return self._db.query(func.count(SurveyResponse.id)).scalar() or 0

    def max_participant_number(self) -> int:
        """Highest numeric suffix among auto-generated P### participant codes."""
        codes = (
            self._db.query(SurveyResponse.participant_code)
            .filter(SurveyResponse.participant_code.isnot(None))
            .all()
        )
        best = 0
        for (code,) in codes:
            if code and code.upper().startswith("P"):
                digits = code[1:]
                if digits.isdigit():
                    best = max(best, int(digits))
        return best
