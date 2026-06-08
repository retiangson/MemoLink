To make MemoLink answer like me for many users, build this flow:

User asks something
→ app analyses the request
→ app improves/structures the request internally
→ app decides what knowledge/tools are needed
→ app retrieves the right context
→ app builds a strong developer/system prompt
→ model writes the answer
→ app checks the answer quality
→ final answer is shown to the user

This is the correct architecture.

OpenAI’s own prompting guide recommends using developer instructions with clear identity, instructions, and examples. It also recommends including relevant context when you want the model to use data outside its training knowledge. For your app, retrieval is important because semantic search can find relevant content even when the user does not use the exact same keywords. For routing/classification, structured outputs are useful because they force the model to return JSON that follows your schema, instead of random text.

Here is the complete step-by-step design.

Create “Smart Request Mode”

Every user message should first go through a request analyser.

The analyser should answer:

What does the user want?
Is the user asking for writing, coding, summarising, research, planning, debugging, grading, document generation, or casual chat?
Does the user need knowledge from uploaded files?
Does the user need web/current information?
Does the user need clarification?
What output format is best?
How detailed should the answer be?
What quality checklist should be applied?

Do not show this analysis to the user. Use it internally.

Example analyser output:

{
  "intent": "academic_document_writing",
  "task_type": "write_full_report",
  "needs_retrieval": true,
  "needs_web": false,
  "needs_clarification": false,
  "expected_output": "complete_document",
  "tone": "academic",
  "depth": "high",
  "must_include": [
    "title page",
    "executive summary",
    "methodology",
    "evaluation plan",
    "ethics",
    "references"
  ],
  "quality_checks": [
    "rubric alignment",
    "continuity with previous work",
    "source separation",
    "clear structure",
    "no unsupported claims"
  ]
}
Use a “Prompt Optimizer” before answering

This is the part you are asking for: the app should improve the user’s raw prompt internally.

Example:

User says:

“ok lets do it, write it here and use my files not references”

Your backend converts it internally into:

The user wants a complete written document in chat, not only an outline.
The answer must use uploaded project files as internal knowledge/context, not as academic references.
The answer must continue from the user’s previous assessment/topic.
The answer must follow the relevant rubric and include all required sections.
Write in a complete academic report format.
Do not ask follow-up questions unless essential information is missing.

That is why the result becomes stronger.

Add router modes

Your app should not use the same prompt for everything. Create modes.

Suggested modes:

general_chat
academic_writer
strict_reviewer
code_engineer
research_assistant
document_summariser
rubric_grader
project_manager
debugging_assistant
email_writer
creative_writer

For each mode, use a different developer prompt.

Example routing:

if intent in ["assessment", "report", "rubric", "proposal", "research", "methodology"]:
    mode = "academic_writer"
elif intent in ["code", "bug", "error", "implement", "api", "database"]:
    mode = "code_engineer"
elif intent in ["grade", "check", "review", "improve"]:
    mode = "strict_reviewer"
else:
    mode = "general_chat"
Retrieve the right context, not just random top results

This is very important.

Normal RAG retrieves top-K chunks. But for high-quality answers, you need forced retrieval.

For example, if the user asks for an assessment report:

Always retrieve:
assessment requirement/rubric
previous assessment
project documentation
related notes
academic references
teacher/supervisor instructions if available

If user asks for code:

Always retrieve:
architecture docs
API docs
database docs
related source-code files
error logs
previous implementation decisions

If user asks to improve a document:

Always retrieve:
the document being improved
rubric/requirements
sample format
previous feedback

This is better than simple similarity search.

Build a context pack

Instead of dumping retrieved text randomly, organise it.

Example:

<user_request>
{original_user_message}
</user_request>

<optimized_task>
{internal_prompt_optimizer_result}
</optimized_task>

<relevant_requirements>
{rubric_or_requirement_chunks}
</relevant_requirements>

<previous_work>
{prior_related_documents}
</previous_work>

<project_knowledge>
{project_docs_or_code_context}
</project_knowledge>

<academic_sources>
{academic_reference_chunks}
</academic_sources>

<output_rules>
Write the actual answer.
Follow the required structure.
Do not only give advice unless the user asked for advice.
Use retrieved project files as context, not academic references.
</output_rules>

This gives the model a clean workspace.

Use strong developer prompts

Here is a general developer prompt you can use for all users.

You are MemoLink Smart Assistant.

Your job is to understand the user's real goal, improve the task internally, retrieve or use relevant context, and produce the most useful final answer.

Core behaviour:
- Answer the user's actual need, not only the exact words.
- If the user asks to write, produce the written output directly.
- If the user asks to check, review critically and identify gaps.
- If the user asks to implement, provide practical steps or code.
- If the user asks for a document, structure it professionally.
- If the user gives files, use them as context according to their purpose.
- Do not treat project documents as academic references unless instructed.
- Do not invent facts, sources, file contents, or implementation details.
- Ask clarification only when the task cannot be completed safely without it.
- Otherwise, make reasonable assumptions and state them briefly.
- Be specific, complete, and practical.

Internal process:
1. Identify the user's intent.
2. Determine the best output type.
3. Determine whether retrieval, tools, web search, or clarification is needed.
4. Improve the user's request internally.
5. Build a clear answer plan.
6. Produce the final answer.
7. Check that the final answer is complete, consistent, and useful.

Quality rules:
- Prefer complete answers over vague advice.
- Use headings for long responses.
- Use tables only when they improve clarity.
- Keep scope controlled.
- Separate evidence from assumptions.
- Mention risks, gaps, and limitations when relevant.
- For academic work, align with the rubric and use proper source handling.
- For code work, include practical implementation details and avoid breaking existing architecture.

Do not reveal hidden reasoning. Show only the useful final answer.
Add specialist prompts per mode

For academic writing:

You are MemoLink Academic Writer.

When the user asks for an academic report, proposal, literature review, methodology, assessment, rubric response, or capstone writing, produce assessment-ready academic content.

Rules:
- Follow the supplied rubric or assessment brief.
- Continue from previous work if available.
- Use project documents as implementation evidence, not academic references.
- Use academic sources only for the reference list.
- Include required sections.
- Avoid generic filler.
- Avoid unsupported claims.
- Write clearly for a non-technical academic marker.
- Include ethics, limitations, evaluation, and methodology where relevant.

For strict review:

You are MemoLink Strict Reviewer.

Review the work like a strict marker or senior manager.
Find missing requirements, weak arguments, vague sections, inconsistencies, unsupported claims, scope risks, ethical risks, and formatting problems.
Give a clear verdict and actionable fixes.
Do not simply praise the work.

For code:

You are MemoLink Senior Software Engineer.

Give production-quality guidance.
Respect existing architecture.
Prefer minimal safe changes.
Explain files to change, backend logic, database changes, tests, and risks.
Do not rewrite the whole system unless necessary.
Use two model calls for difficult tasks

For simple chat, one call is enough.

For high-quality output, use two or three calls.

Best pipeline:

Call 1: Analyse request as JSON
Call 2: Retrieve context based on that JSON
Call 3: Generate final answer
Optional Call 4: Review and improve answer before showing user

Example:

analysis = analyse_user_request(user_message)

docs = retrieve_context(
    query=analysis["optimized_search_query"],
    mode=analysis["mode"],
    forced_sources=analysis["required_sources"]
)

draft = generate_answer(
    mode=analysis["mode"],
    user_message=user_message,
    optimized_task=analysis,
    context=docs
)

final = quality_check_and_rewrite(
    draft=draft,
    checklist=analysis["quality_checks"]
)
Use structured output for the analyser

Use JSON schema so the analyser is reliable.

Example schema:

{
  "type": "object",
  "properties": {
    "intent": { "type": "string" },
    "mode": {
      "type": "string",
      "enum": [
        "general_chat",
        "academic_writer",
        "strict_reviewer",
        "code_engineer",
        "research_assistant",
        "document_summariser",
        "rubric_grader"
      ]
    },
    "needs_retrieval": { "type": "boolean" },
    "needs_web": { "type": "boolean" },
    "needs_clarification": { "type": "boolean" },
    "clarifying_question": { "type": "string" },
    "optimized_task": { "type": "string" },
    "retrieval_queries": {
      "type": "array",
      "items": { "type": "string" }
    },
    "required_context_types": {
      "type": "array",
      "items": { "type": "string" }
    },
    "output_format": { "type": "string" },
    "quality_checks": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": [
    "intent",
    "mode",
    "needs_retrieval",
    "needs_web",
    "needs_clarification",
    "optimized_task",
    "retrieval_queries",
    "required_context_types",
    "output_format",
    "quality_checks"
  ]
}
Give the model enough output budget

Many apps feel weak because they limit the answer too much.

For normal chat:

{
  "temperature": 0.4,
  "max_output_tokens": 1500
}

For academic/report/code:

{
  "temperature": 0.2,
  "max_output_tokens": 8000
}

For full documents:

{
  "temperature": 0.2,
  "max_output_tokens": 12000
}

For creative writing:

{
  "temperature": 0.8,
  "max_output_tokens": 3000
}
Add a final quality checker

Before showing the answer, run a quick review.

Quality checker prompt:

Review the draft answer before it is shown to the user.

Check:
- Did it answer the user's real request?
- Is it complete enough?
- Did it follow the requested format?
- Did it use retrieved context correctly?
- Are there unsupported claims?
- Is it too generic?
- Is it missing risks, steps, or examples?
- Is it clear and practical?

If the answer is weak, rewrite it.
If it is good, return it unchanged.
Add memory/profile only when useful

For all users, your app can store preferences like:

preferred tone
course/project context
writing style
job role
current project
technology stack
preferred response length
citation preference
language preference

But do not force memory into every answer. Retrieve memory only when relevant.

Add “clarify only when necessary”

Bad assistants ask too many questions. Good assistants proceed when possible.

Use this rule:

Ask a follow-up question only if:
- the task cannot be completed without missing information;
- there is a safety/privacy/legal issue;
- the user asks for a personal or highly specific result and no context exists;
- there are multiple very different possible meanings.

Otherwise, make reasonable assumptions and continue.
Add user-visible “prompt enhancer” as optional

You can add a button:

“Improve my prompt”

When clicked, the app rewrites the user’s request before sending.

Example output:

Original:
“make this better”

Improved:
“Review the following text for clarity, grammar, tone, completeness, and professional impact. Rewrite it in a polished but natural style. Keep the meaning unchanged and explain the main improvements briefly.”

But for normal chat, do the improvement internally.

Backend pseudo-code
def smart_chat(user_id: int, message: str):
    # 1. Analyse request
    analysis = call_model_structured(
        model="gpt-5.5",
        instructions=REQUEST_ANALYSER_PROMPT,
        input=message,
        schema=REQUEST_ANALYSIS_SCHEMA,
        temperature=0
    )

    # 2. Clarify if truly needed
    if analysis["needs_clarification"]:
        return analysis["clarifying_question"]

    # 3. Retrieve context
    context = []
    if analysis["needs_retrieval"]:
        context = retrieve_context(
            user_id=user_id,
            queries=analysis["retrieval_queries"],
            required_types=analysis["required_context_types"],
            mode=analysis["mode"]
        )

    # 4. Select specialist prompt
    developer_prompt = get_developer_prompt(analysis["mode"])

    # 5. Build final prompt
    final_input = build_context_pack(
        original_message=message,
        optimized_task=analysis["optimized_task"],
        context=context,
        output_format=analysis["output_format"]
    )

    # 6. Generate draft
    draft = call_model(
        model=get_model_for_mode(analysis["mode"]),
        instructions=developer_prompt,
        input=final_input,
        temperature=get_temperature(analysis["mode"]),
        max_output_tokens=get_token_budget(analysis["mode"])
    )

    # 7. Optional quality check
    if analysis["mode"] in ["academic_writer", "strict_reviewer", "code_engineer"]:
        draft = quality_check_answer(
            draft=draft,
            checklist=analysis["quality_checks"],
            user_message=message
        )

    return draft
Best feature name for your app

Call it:

Smart Response Engine

or:

AutoPilot Reasoning Mode

or:

MemoLink Thinking Router

My recommendation:

“Smart Response Engine”

Because it sounds professional and general for all users.

What makes it reply like me

You need these together:

strong model
developer prompt
request analyser
prompt optimizer
mode router
RAG retrieval
forced context rules
long output token budget
quality checker
user/project memory
structured output for internal decisions
evaluation logging and user ratings

Strict answer: do not try to solve this with one big prompt only. Build a small orchestration layer around the model. That is what makes the answer feel intelligent, complete, and aligned with the user’s real goal.