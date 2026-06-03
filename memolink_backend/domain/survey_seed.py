"""
Default MemoLink Prototype Evaluation Survey
============================================
Seed questions transcribed from "Survey Feature.txt" (Sections A–G).
Inserted on startup when the survey_questions table is empty, and reusable by
the admin "Reset to default" action. Questions remain fully editable by admins.

answer_type values:
  likert → 1–5 scale (Strongly Disagree … Strongly Agree)
  single → radio, one of `options`
  multi  → checkboxes, any of `options`
  short  → single-line free text
  long   → multi-line free text
"""

DEFAULT_SURVEY_QUESTIONS = [
    # ── Section A: Participant Background ─────────────────────────────────────
    {
        "section": "A. Participant Background",
        "question_key": "role",
        "question_text": "What best describes your role?",
        "answer_type": "single",
        "options": [
            "Student",
            "Software developer / IT professional",
            "Office / admin worker",
            "Researcher",
            "Teacher / educator",
            "Other",
        ],
        "required": True,
    },
    {
        "section": "A. Participant Background",
        "question_key": "ai_tool_usage_frequency",
        "question_text": "How often do you use AI tools such as ChatGPT, Gemini, Copilot, or similar tools?",
        "answer_type": "single",
        "options": ["Never", "Rarely", "Sometimes", "Often", "Very often"],
        "required": True,
    },
    {
        "section": "A. Participant Background",
        "question_key": "current_tools",
        "question_text": "What tools do you normally use for notes, reminders, or study/work organisation?",
        "answer_type": "multi",
        "options": [
            "Microsoft Word / Google Docs",
            "OneNote / Notion / Evernote",
            "Calendar / reminders app",
            "Email",
            "ChatGPT or other AI tools",
            "Other",
        ],
    },

    # ── Section B: Knowledge Capture ─────────────────────────────────────────
    {
        "section": "B. Knowledge Capture",
        "question_key": "kc_easy_add",
        "question_text": "MemoLink made it easy to add study or work information such as notes, files, transcripts, or recordings.",
        "answer_type": "likert",
    },
    {
        "section": "B. Knowledge Capture",
        "question_key": "kc_notes_clear",
        "question_text": "The generated or stored notes were clear and well-structured.",
        "answer_type": "likert",
    },
    {
        "section": "B. Knowledge Capture",
        "question_key": "kc_better_organise",
        "question_text": "MemoLink helped organise information better than my usual method.",
        "answer_type": "likert",
    },
    {
        "section": "B. Knowledge Capture",
        "question_key": "kc_comment",
        "question_text": "What did you like or dislike about adding information into MemoLink?",
        "answer_type": "short",
    },

    # ── Section C: Contextual Retrieval and AI Answers ───────────────────────
    {
        "section": "C. Contextual Retrieval & AI Answers",
        "question_key": "cr_relevant",
        "question_text": "The AI answers were relevant to the notes or materials I provided.",
        "answer_type": "likert",
    },
    {
        "section": "C. Contextual Retrieval & AI Answers",
        "question_key": "cr_citations_understand",
        "question_text": "The source citations helped me understand where the answer came from.",
        "answer_type": "likert",
    },
    {
        "section": "C. Contextual Retrieval & AI Answers",
        "question_key": "cr_citations_trust",
        "question_text": "The citations made the AI answer feel more trustworthy.",
        "answer_type": "likert",
    },
    {
        "section": "C. Contextual Retrieval & AI Answers",
        "question_key": "cr_less_effort",
        "question_text": "MemoLink reduced the effort needed to search through notes or files manually.",
        "answer_type": "likert",
    },
    {
        "section": "C. Contextual Retrieval & AI Answers",
        "question_key": "cr_wrong_answer",
        "question_text": "Did you notice any answer that seemed wrong, incomplete, or unsupported?",
        "answer_type": "single",
        "options": ["Yes", "No", "Not sure"],
    },
    {
        "section": "C. Contextual Retrieval & AI Answers",
        "question_key": "cr_wrong_explain",
        "question_text": "If yes, please explain.",
        "answer_type": "short",
    },

    # ── Section D: Task Support and Reminders ────────────────────────────────
    {
        "section": "D. Task Support & Reminders",
        "question_key": "ts_reminders_useful",
        "question_text": "The generated reminders or action items were useful.",
        "answer_type": "likert",
    },
    {
        "section": "D. Task Support & Reminders",
        "question_key": "ts_identified_tasks",
        "question_text": "The system correctly identified important tasks, deadlines, or next steps.",
        "answer_type": "likert",
    },
    {
        "section": "D. Task Support & Reminders",
        "question_key": "ts_info_to_action",
        "question_text": "MemoLink helped me move from information to action.",
        "answer_type": "likert",
    },
    {
        "section": "D. Task Support & Reminders",
        "question_key": "ts_missed",
        "question_text": "Were any important reminders or action items missed?",
        "answer_type": "single",
        "options": ["Yes", "No", "Not sure"],
    },
    {
        "section": "D. Task Support & Reminders",
        "question_key": "ts_missed_explain",
        "question_text": "Please explain.",
        "answer_type": "short",
    },

    # ── Section E: Usability and User Experience ─────────────────────────────
    {
        "section": "E. Usability & User Experience",
        "question_key": "ux_easy",
        "question_text": "MemoLink was easy to understand and use.",
        "answer_type": "likert",
    },
    {
        "section": "E. Usability & User Experience",
        "question_key": "ux_clear",
        "question_text": "The interface was clear and not confusing.",
        "answer_type": "likert",
    },
    {
        "section": "E. Usability & User Experience",
        "question_key": "ux_fast",
        "question_text": "The system responded fast enough for normal study or work use.",
        "answer_type": "likert",
    },
    {
        "section": "E. Usability & User Experience",
        "question_key": "ux_comfortable",
        "question_text": "I would feel comfortable using MemoLink for real study or work tasks.",
        "answer_type": "likert",
    },
    {
        "section": "E. Usability & User Experience",
        "question_key": "ux_easiest",
        "question_text": "What part of MemoLink was easiest to use?",
        "answer_type": "short",
    },
    {
        "section": "E. Usability & User Experience",
        "question_key": "ux_confusing",
        "question_text": "What part of MemoLink was confusing or difficult to use?",
        "answer_type": "short",
    },

    # ── Section F: Trust, Privacy, and Ethics ────────────────────────────────
    {
        "section": "F. Trust, Privacy & Ethics",
        "question_key": "tp_upload_comfort",
        "question_text": "I would feel comfortable uploading non-sensitive study or work materials into MemoLink.",
        "answer_type": "likert",
    },
    {
        "section": "F. Trust, Privacy & Ethics",
        "question_key": "tp_human_review",
        "question_text": "I understand that AI-generated answers should still be reviewed by a human.",
        "answer_type": "likert",
    },
    {
        "section": "F. Trust, Privacy & Ethics",
        "question_key": "tp_privacy_important",
        "question_text": "Privacy and data security are important concerns when using an AI companion like MemoLink.",
        "answer_type": "likert",
    },
    {
        "section": "F. Trust, Privacy & Ethics",
        "question_key": "tp_concern",
        "question_text": "What privacy or security concern would you have when using MemoLink?",
        "answer_type": "short",
    },

    # ── Section G: Overall Evaluation ────────────────────────────────────────
    {
        "section": "G. Overall Evaluation",
        "question_key": "ov_useful",
        "question_text": "Overall, MemoLink is useful for study or work productivity.",
        "answer_type": "likert",
    },
    {
        "section": "G. Overall Evaluation",
        "question_key": "ov_reduce_switching",
        "question_text": "MemoLink helps reduce switching between separate tools for notes, searching, and reminders.",
        "answer_type": "likert",
    },
    {
        "section": "G. Overall Evaluation",
        "question_key": "ov_use_again",
        "question_text": "I would use MemoLink again if it were available.",
        "answer_type": "likert",
    },
    {
        "section": "G. Overall Evaluation",
        "question_key": "ov_most_useful",
        "question_text": "What is the most useful feature of MemoLink?",
        "answer_type": "short",
    },
    {
        "section": "G. Overall Evaluation",
        "question_key": "ov_improvement",
        "question_text": "What is one improvement you would suggest?",
        "answer_type": "short",
    },
    {
        "section": "G. Overall Evaluation",
        "question_key": "ov_additional",
        "question_text": "Any additional comments?",
        "answer_type": "long",
    },
]

# Consent text shown before the survey (privacy rule from the spec).
SURVEY_CONSENT_TEXT = (
    "I understand that this survey is for academic evaluation of the MemoLink "
    "prototype. I will not include private, confidential, or sensitive "
    "information in my responses."
)

SURVEY_INTRO = (
    "This survey gathers feedback about the MemoLink prototype after you complete "
    "selected tasks. It evaluates usability, usefulness, trust, note quality, "
    "contextual retrieval, and task/reminder support. Please do not include "
    "private, confidential, or sensitive information in your answers."
)
