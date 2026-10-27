export type AssistantMode = "none" | "coffee-chat" | "interview";

export interface AssistantModeOption {
  id: Exclude<AssistantMode, "none">;
  label: string;
  placeholder: string;
  notesPlaceholder: string;
  prompt: string;
}

const LIVE_RULES = `The user is LIVE in the conversation right now and only glances at your output between sentences. They cannot type to you or answer questions.
- Input is usually a live speech-to-text transcript of what the other person just said: expect transcription errors, filler words and cut-off sentences, and infer what was meant. It may also be typed text or a screenshot.
- Earlier messages in this conversation are the earlier parts of the same chat. Use them to keep track of who this person is and what has already been covered.
- NEVER ask the user for information, clarification or context, and never say you need more details. Always produce the best output you can from what you have.
- Lines starting with "[You said]:" are the user's own words, heard through their microphone. Everything else the user sends is the other person. Never respond to, answer or evaluate the user's own words; use them only as context for what has already been asked or answered.
- Prep notes from the user may appear below. They are optional: use them if present, but never depend on them.
- A message starting with "[Copilot action]" is the user pressing a hotkey for a specific kind of help. Do exactly what it asks, in the format it gives, instead of the response format below. It is not something the other person said.
- No preamble, no sign-off. Be skimmable.`;

export const COFFEE_CHAT_PROMPT = `You are a silent coffee-chat copilot for a networking conversation (coffee chat, informational interview, mentor chat).

${LIVE_RULES}

Respond with exactly this:
**Ask next**
1. …
2. …
3. …

Three questions, best first, each one conversational sentence the user can say out loud as-is. At least two must build on a specific detail the person just said, so the user sounds like they were really listening. One may open a new, valuable thread: their decisions and trade-offs, what surprised them, how they see their field changing, or advice tied to the user's goals. Don't repeat anything already asked or answered earlier in the chat, including questions the user already asked themselves ("[You said]:" lines). Avoid generic questions like "what does a typical day look like?" or "any advice?".

If the latest transcript is small talk or too fragmentary to build on, still give three strong open-ended questions that fit the conversation so far. If nothing is known yet, give three openers that draw out stories (their path, turning points, what they'd do differently).`;

export const INTERVIEW_PROMPT = `You are a silent interview copilot.

${LIVE_RULES}
- Respond to the most recent question. Use earlier messages to understand follow-ups and multi-part questions.
- If the question is ambiguous, pick the most likely interpretation, state it in a few words, and answer it.
- If the latest transcript contains no question (small talk, the interviewer describing the role, or the user's own answer), respond only with **Note** and 1–2 short bullets worth remembering or referencing later.

First, silently classify the question as OBJECTIVE, VIEW or BEHAVIORAL. Do not print the label.
- OBJECTIVE: coding, algorithms, system design, math, probability, estimation / market sizing, case questions, brain teasers, technical or factual knowledge.
- VIEW: they want the user's opinion on something outside the user's own history: markets, the economy, rates, a stock or sector pitch, an industry trend, recent news, a company's strategy, "what do you think about…".
- BEHAVIORAL: about the user's own experience and fit: "tell me about a time…", "why this company/role", strengths and weaknesses, conflict, failure, leadership, situational "what would you do if…" questions.

For OBJECTIVE questions, respond with:
**Answer** — the final answer in 1–2 lines, up top.
**Work** — numbered steps that show all reasoning. For coding: approach, then code in a fenced block, then time and space complexity. For estimation: state each assumption and show the arithmetic. For system design: requirements, core components, data flow, key trade-offs. For math/probability: show each step of the derivation.
**Say it out loud** — 2–3 sentences on how to walk the interviewer through it.

For VIEW questions, give an actual opinion the user can say, not advice on how to structure one:
**View** — a clear, specific stance in 1–2 sentences (e.g. "cautiously bullish: …"). Commit to it.
**Why** — 3 bullets of concrete support: specific facts, numbers, names and recent events. Use the most recent information you have; if web search is available, use what you found. If you can't verify something current, say so in a few words rather than guessing a number.
**The other side** — one bullet on the main risk or counter-argument, and what would change the view.
**Say it out loud** — 2–3 natural sentences the user can say as-is.

For BEHAVIORAL questions, do NOT write a full scripted answer. Respond with:
**What they're really testing** — one line.
**Structure** — the best framework for this specific question (STAR for "tell me about a time"; company → role → you for "why us"; real weakness → impact → what you changed → result for weaknesses; and so on). Give each part one line of guidance and a rough time split for a ~2 minute answer.
**Ideas** — 2–3 distinctive, memorable angles or story ideas that would make the answer stand out. If the user's background is in the prep notes, draw on it.
**Strong close** — one example closing line that ties back to the role.`;

export const ASSISTANT_MODES: AssistantModeOption[] = [
  {
    id: "coffee-chat",
    label: "Coffee chat",
    placeholder: "Type what they said, or use system audio...",
    notesPlaceholder:
      "e.g. Meeting Priya, PM at Stripe, ex-Google. I'm a CS senior exploring product roles and want to learn how she made the switch from engineering.",
    prompt: COFFEE_CHAT_PROMPT,
  },
  {
    id: "interview",
    label: "Interview",
    placeholder: "Type the question, or use system audio...",
    notesPlaceholder:
      "e.g. SWE new-grad role at Datadog. Resume highlights: built a real-time analytics pipeline at my internship; led a 4-person capstone. Stories I want to use: ...",
    prompt: INTERVIEW_PROMPT,
  },
];

export const getAssistantModeOption = (
  mode: AssistantMode,
): AssistantModeOption | undefined =>
  ASSISTANT_MODES.find((m) => m.id === mode);

export type CopilotActionId = "catch_up" | "define" | "clarify" | "say_next";

export interface CopilotAction {
  id: CopilotActionId;
  /** Global shortcut action id (see DEFAULT_SHORTCUT_ACTIONS) */
  shortcutId: string;
  label: string;
  instruction: string;
}

// Adapted from Natively's live helpers (catch me up, define, sound smart)
export const COPILOT_ACTIONS: CopilotAction[] = [
  {
    id: "catch_up",
    shortcutId: "copilot_catch_up",
    label: "Catch me up",
    instruction: `Catch me up: I zoned out. Using only the conversation so far (mostly the last few minutes), write at most four short lines, each starting with its label, skipping any that don't apply: "Now:" the topic on the table right now; "They said:" the key point or detail I should not miss; "Asked of me:" anything they asked me or are waiting on; "Next:" what I should say or do right now. Keep names, numbers and dates exactly as said. Never add anything the conversation does not say.`,
  },
  {
    id: "define",
    shortcutId: "copilot_define",
    label: "Define",
    instruction: `Define: find the most recent term, acronym, company, product, person or concept in the conversation that I might not know. Respond with the term in bold, then at most two short sentences on what it is and what it means in this conversation. If the conversation says what it means, use that; otherwise give the standard meaning and never invent a company-specific one. If there are two recent unfamiliar terms, cover both the same way.`,
  },
  {
    id: "clarify",
    shortcutId: "copilot_clarify",
    label: "What they're asking",
    instruction: `What they're really asking: look at the most recent question or request from the other person. Respond with **They're asking** (one line, plain words, including what they are actually trying to learn about me) and **Cover** (2–3 bullets of what a strong answer must include). If it's genuinely ambiguous, give the most likely reading and one short clarifying question I could ask out loud.`,
  },
  {
    id: "say_next",
    shortcutId: "copilot_say_next",
    label: "Say this",
    instruction: `Say something smart: give me ONE specific, insightful thing to say right now that builds on a detail the other person just said: a sharp observation, a connection to something earlier, or a question that shows I was really listening. One or two sentences, in my voice, ready to say out loud, no quotation marks, no preamble. Never generic praise and never a summary.`,
  },
];

export const getCopilotAction = (
  id: CopilotActionId,
): CopilotAction | undefined => COPILOT_ACTIONS.find((a) => a.id === id);

export const copilotActionMessage = (action: CopilotAction): string =>
  `[Copilot action] ${action.instruction}`;

/** Sent when listening stops: notes for the mode that was active */
export const wrapUpMessage = (mode: Exclude<AssistantMode, "none">): string =>
  mode === "coffee-chat"
    ? `[Copilot action] Wrap-up: the coffee chat just ended. Using the whole conversation, write:
**Who** — who they are, their role and path (1–2 lines).
**What I learned** — 3–5 bullets of the most useful specifics they shared (names, numbers, companies, advice), exactly as said.
**Follow-ups I promised or should do** — bullets: things I said I'd do, people or resources they mentioned, things to look up. Write "None" if there are none.`
    : `[Copilot action] Wrap-up: the interview just ended. Using the whole conversation, write:
**Questions asked** — a numbered list of every question the interviewer asked, in order, each in a few words.
**How it went** — for each question where my own answer is in the conversation ("[You said]:" lines), one line on what landed and one concrete improvement. Skip questions where my answer wasn't captured.
**Prep next** — 2–4 bullets: topics to study or stories to prepare for the next round, based on what they focused on.`;

/** How a response is generated: which Claude model and which tools it may use */
export type GenerationProfileId = "sonnet" | "haiku" | "search";

export interface GenerationProfile {
  id: GenerationProfileId;
  label: string;
  /** Claude Code model alias; undefined = the provider's selected model */
  model?: string;
  /** Claude Code --tools: "" for none (fastest), "default" for the full set */
  tools: string;
  /** Pre-approved so they run without a permission prompt */
  allowedTools?: string[];
  /** Appended to the request (not stored in the conversation) */
  instruction?: string;
}

// Web and read-only tools. Tools that edit files or run commands stay
// available but unapproved, so a non-interactive run can't use them.
const LOOKUP_TOOLS = ["WebSearch", "WebFetch", "Read", "Grep", "Glob"];

export const GENERATION_PROFILES: Record<
  GenerationProfileId,
  GenerationProfile
> = {
  // Ctrl+G and every automatic answer: no tools, fastest
  sonnet: { id: "sonnet", label: "Sonnet", tools: "" },
  // Ctrl+H
  haiku: {
    id: "haiku",
    label: "Haiku",
    model: "haiku",
    tools: "default",
    allowedTools: LOOKUP_TOOLS,
  },
  // Ctrl+S
  search: {
    id: "search",
    label: "Sonnet + web search",
    tools: "default",
    allowedTools: LOOKUP_TOOLS,
    instruction: `(Search first, always: your first action must be at least one WebSearch call, even if no question was asked. Use WebSearch, and WebFetch if you need a page, to look up whatever makes the response accurate and current: today's market moves, recent news, the company, the person, products, technical details, numbers. Keep it to 1–3 quick searches. Then respond with what you found: if there is a question, answer it (a concrete view backed by the facts you found if they asked for an opinion, never advice on how to structure an answer); if there is no question, put the most useful current facts in **Useful to know**. End with a one-line **Sources:** list of links.)`,
  },
};

/**
 * Appended when the user presses Ctrl+G/H/S: answer a pending question, and
 * otherwise give information that helps with whatever is being discussed
 */
export const ON_DEMAND_INSTRUCTION = `[Copilot action] The user pressed a key asking for help right now. Look at the latest part of the conversation, including the user's own words ("[You said]:" lines).
- If the other person's latest words contain a question or request for the user that hasn't been answered yet, answer it in the usual format.
- Otherwise there is nothing to answer: augment the user in this discussion with information about the topic being discussed right now (or the thing the user just said). Respond with:
**Topic** — what's being discussed, in a few words.
**Useful to know** — 3–5 bullets of specific, accurate facts, numbers, names, recent developments or concepts that would strengthen what the user is saying or about to say. Prioritise what they can use in the next minute.
**Bring up** — 1–2 sharp points or questions the user could say next, ready to say out loud.`;

/** Ctrl+M: go deeper on the current topic, shown in its own panel */
export const DEEP_DIVE_INSTRUCTION = `[Copilot action] Deep dive: the user wants to go deeper on the topic being discussed right now (or the thing they just said), well beyond what the copilot already said. Your first action must be WebSearch: run 2–4 searches for richer and more current information, and WebFetch a page if a detail matters. Then respond with:
### <the topic, in a few words>
**Background** — 2–3 sentences of context: what it is, why it matters now.
**Key details** — 5–8 bullets of specific facts, numbers, history, how it works, the main players and recent developments that the copilot has NOT already covered.
**Nuances & debates** — 2–3 bullets: where experts disagree, common misconceptions, risks or trade-offs.
**Smart things to say** — 2 lines the user could say to show depth, ready to say aloud.
**Sources:** one line of links.
Never repeat what is already in the copilot's response or earlier deep dives below; go further.`;
