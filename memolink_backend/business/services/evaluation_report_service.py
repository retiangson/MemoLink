"""
EvaluationReportService — admin-only aggregation, export, and report generation.
"""
import io
import csv
import zipfile
from typing import Optional, List, Dict

from memolink_backend.domain.repositories.evaluation_repository import EvaluationRepository
from memolink_backend.domain.models.evaluation import (
    EvaluationSession, EvaluationTask, EvaluationEvent, EvaluationAiMetric,
    EvaluationUserRating, EvaluationFeatureUsage,
)
from sqlalchemy import text

from memolink_backend.contracts.evaluation_dtos import (
    EvaluationSummaryDTO, ConfidenceAlignmentRow, GeneratedReportDTO,
    ParticipantBudgetRow, ParticipantBudgetList,
)
from memolink_backend.business.services.evaluation_service import DEFAULT_BUDGET_SECONDS

_EXPORT_TABLES = [
    ("sessions", EvaluationSession),
    ("tasks", EvaluationTask),
    ("events", EvaluationEvent),
    ("ai_metrics", EvaluationAiMetric),
    ("ratings", EvaluationUserRating),
    ("feature_usage", EvaluationFeatureUsage),
]


# Core workflow tasks used to compute per-participant completion (coverage).
CORE_TASK_KEYS = ["create_note", "ask_rag_question", "check_citation", "create_reminder", "complete_survey"]


def _avg(values: List[float]) -> Optional[float]:
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals), 2) if vals else None


class EvaluationReportService:
    def __init__(self, repo: EvaluationRepository):
        self._repo = repo

    def get_summary(self) -> EvaluationSummaryDTO:
        sessions = self._repo.list_sessions()
        tasks = self._repo.list_tasks()
        ratings = self._repo.list_ratings()
        metrics = self._repo.list_ai_metrics()
        usage = self._repo.list_feature_usage()

        completed_sessions = sum(1 for s in sessions if s.completed)
        total_tasks = len(tasks)
        completed_tasks = sum(1 for t in tasks if t.completed)

        # Core-workflow coverage: per session, how many of the core tasks were done.
        core_by_session: Dict[int, set] = {}
        for t in tasks:
            if t.task_key in CORE_TASK_KEYS:
                core_by_session.setdefault(t.session_id, set()).add(t.task_key)
        if core_by_session:
            coverage = _avg([len(keys) / len(CORE_TASK_KEYS) for keys in core_by_session.values()])
        else:
            coverage = None

        # ratings by type — choice-based questions are tallied, not averaged
        by_type: Dict[str, List[int]] = {}
        supported_by_notes: Dict[str, int] = {}
        trust_by_msg: Dict[int, int] = {}
        relevance_by_msg: Dict[int, int] = {}
        for r in ratings:
            if r.rating_type == "answer_supported_by_notes":
                key = r.choice_value or "not_sure"
                supported_by_notes[key] = supported_by_notes.get(key, 0) + 1
                continue
            by_type.setdefault(r.rating_type, []).append(r.rating_value)
            if r.message_id is not None:
                if r.rating_type == "answer_trust":
                    trust_by_msg[r.message_id] = r.rating_value
                elif r.rating_type == "answer_relevance":
                    relevance_by_msg[r.message_id] = r.rating_value
        ratings_by_type = {k: round(sum(v) / len(v), 2) for k, v in by_type.items() if v}

        # response time by feature
        rt_by_feature: Dict[str, List[int]] = {}
        for m in metrics:
            if m.total_response_time_ms is not None:
                rt_by_feature.setdefault(m.feature_name, []).append(m.total_response_time_ms)
        response_time_by_feature = {k: round(sum(v) / len(v), 1) for k, v in rt_by_feature.items() if v}

        # confidence alignment
        conf_groups: Dict[str, Dict[str, List[int]]] = {}
        for m in metrics:
            lvl = m.confidence_level or "UNKNOWN"
            g = conf_groups.setdefault(lvl, {"count": [], "trust": [], "relevance": []})
            g["count"].append(1)
            if m.message_id in trust_by_msg:
                g["trust"].append(trust_by_msg[m.message_id])
            if m.message_id in relevance_by_msg:
                g["relevance"].append(relevance_by_msg[m.message_id])
        confidence_alignment = [
            ConfidenceAlignmentRow(
                confidence_level=lvl,
                count=len(g["count"]),
                avg_trust=_avg(g["trust"]),
                avg_relevance=_avg(g["relevance"]),
            )
            for lvl, g in sorted(conf_groups.items())
        ]

        # feature usage totals
        feature_usage: Dict[str, int] = {}
        for u in usage:
            feature_usage[u.feature_name] = feature_usage.get(u.feature_name, 0) + u.count

        fallback_count = sum(1 for m in metrics if m.fallback_used)

        return EvaluationSummaryDTO(
            total_participants=self._repo.count_participants(),
            total_sessions=len(sessions),
            completed_sessions=completed_sessions,
            avg_session_time_seconds=_avg([s.total_time_seconds for s in sessions]),
            task_completion_rate=coverage,
            total_tasks=total_tasks,
            completed_tasks=completed_tasks,
            avg_response_time_ms=_avg([m.total_response_time_ms for m in metrics]),
            avg_first_token_latency_ms=_avg([m.first_token_latency_ms for m in metrics]),
            avg_relevance_rating=ratings_by_type.get("answer_relevance"),
            avg_citation_rating=ratings_by_type.get("citation_usefulness"),
            avg_trust_rating=ratings_by_type.get("answer_trust"),
            fallback_rate=round(fallback_count / len(metrics), 3) if metrics else None,
            ai_metric_count=len(metrics),
            confidence_alignment=confidence_alignment,
            ratings_by_type=ratings_by_type,
            supported_by_notes=supported_by_notes,
            response_time_by_feature=response_time_by_feature,
            feature_usage=feature_usage,
        )

    def list_participants(self) -> ParticipantBudgetList:
        """Per-user consumption + budget, for admin management in the Users tab."""
        emails: dict = {}
        try:
            for uid, email in self._repo.db.execute(text("SELECT id, email FROM users")).fetchall():
                emails[uid] = email
        except Exception:
            pass
        rows = []
        for s in self._repo.list_sessions():
            if s.user_id is None:
                continue
            consumed = int(s.total_time_seconds or 0)
            budget = int(s.budget_seconds) if s.budget_seconds else DEFAULT_BUDGET_SECONDS
            rows.append(ParticipantBudgetRow(
                user_id=s.user_id,
                email=emails.get(s.user_id),
                participant_code=s.participant_code,
                consumed_seconds=consumed,
                budget_seconds=budget,
                remaining_seconds=max(0, budget - consumed),
                exhausted=consumed >= budget,
            ))
        rows.sort(key=lambda r: r.user_id)
        return ParticipantBudgetList(default_budget_minutes=DEFAULT_BUDGET_SECONDS // 60, participants=rows)

    # ── Exports ──────────────────────────────────────────────────────────────
    def export_csv_zip(self) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, model in _EXPORT_TABLES:
                rows = self._repo.db.query(model).all()
                cols = [c.name for c in model.__table__.columns]
                sbuf = io.StringIO()
                w = csv.writer(sbuf)
                w.writerow(cols)
                for r in rows:
                    w.writerow([getattr(r, c.key if hasattr(r, c.key) else c.name, "") for c in model.__table__.columns])
                zf.writestr(f"evaluation_{name}.csv", sbuf.getvalue())
        return buf.getvalue()

    def export_json(self) -> dict:
        summary = self.get_summary()
        return {"summary": summary.model_dump(), "markdown": self._markdown(summary)}

    def generate_report(self) -> GeneratedReportDTO:
        summary = self.get_summary()
        return GeneratedReportDTO(markdown=self._markdown(summary), summary=summary)

    # ── Markdown report (paste into Assessment 2) ────────────────────────────
    def _markdown(self, s: EvaluationSummaryDTO) -> str:
        def num(v, suffix="", dash="N/A"):
            return f"{v}{suffix}" if v is not None else dash

        pct = num(round(s.task_completion_rate * 100, 1) if s.task_completion_rate is not None else None, "%")
        rt_s = num(round(s.avg_response_time_ms / 1000, 2) if s.avg_response_time_ms is not None else None, " s")

        # confidence comparison line
        conf_map = {c.confidence_level: c for c in s.confidence_alignment}
        high = conf_map.get("HIGH")
        low = conf_map.get("LOW")
        conf_line = ""
        if high and high.avg_trust is not None and low and low.avg_trust is not None:
            conf_line = (f"HIGH-confidence answers received an average trust rating of {high.avg_trust}/5 "
                         f"compared with {low.avg_trust}/5 for LOW-confidence answers. ")

        lines = [
            "## Quantitative Evaluation Results",
            "",
            f"Quantitative evaluation data was collected from **{s.total_participants}** participant "
            f"session(s) ({s.completed_sessions} completed). The core workflow achieved a task "
            f"completion rate of **{pct}** across {s.total_tasks} assigned task(s). "
            f"The average AI answer received a relevance rating of **{num(s.avg_relevance_rating)}/5**, "
            f"citation usefulness of **{num(s.avg_citation_rating)}/5**, and trust rating of "
            f"**{num(s.avg_trust_rating)}/5**. {conf_line}"
            f"The average AI response time was **{num(s.avg_response_time_ms,' ms')}** "
            f"({rt_s}), with first-token latency of **{num(s.avg_first_token_latency_ms,' ms')}**. "
            f"The model fallback rate was **{num(round(s.fallback_rate*100,1) if s.fallback_rate is not None else None,'%')}**. "
            "These results suggest that MemoLink's core workflow supports contextual retrieval and "
            "task support, although further testing with a larger participant group is required.",
            "",
            "### Summary metrics",
            "",
            "| Metric | Value |",
            "| --- | --- |",
            f"| Participants | {s.total_participants} |",
            f"| Completed sessions | {s.completed_sessions} / {s.total_sessions} |",
            f"| Avg session time | {num(s.avg_session_time_seconds, ' s')} |",
            f"| Task completion rate | {pct} |",
            f"| Avg relevance rating | {num(s.avg_relevance_rating)}/5 |",
            f"| Avg citation usefulness | {num(s.avg_citation_rating)}/5 |",
            f"| Avg trust rating | {num(s.avg_trust_rating)}/5 |",
            f"| Avg response time | {num(s.avg_response_time_ms, ' ms')} |",
            f"| Avg first-token latency | {num(s.avg_first_token_latency_ms, ' ms')} |",
            f"| Fallback rate | {num(round(s.fallback_rate*100,1) if s.fallback_rate is not None else None, '%')} |",
            f"| AI metric samples | {s.ai_metric_count} |",
            "",
            "### Confidence alignment",
            "",
            "| Confidence | Count | Avg trust | Avg relevance |",
            "| --- | --- | --- | --- |",
        ]
        for c in s.confidence_alignment:
            lines.append(f"| {c.confidence_level} | {c.count} | {num(c.avg_trust)} | {num(c.avg_relevance)} |")
        lines += [
            "",
            "### Limitations",
            "",
            "- Small participant sample; results are indicative, not statistically conclusive.",
            "- Timings depend on network and provider load at test time.",
            "- Ratings are self-reported and subject to individual interpretation.",
        ]
        return "\n".join(lines)
