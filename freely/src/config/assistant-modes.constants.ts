export type AssistantMode = "none" | "coffee-chat" | "interview";

export interface AssistantModeOption {
  id: Exclude<AssistantMode, "none">;
  label: string;
  placeholder: string;
  notesPlaceholder: string;
  prompt: string;
}

const LIVE_RULES = `The user is live in this conversation and glances at your output between sentences; they can't reply to you.
- Messages are usually a rough speech-to-text transcript of the other person. "[You said]:" lines are the user's own words; on their own they never need a response, but when the user presses a key, help with what they said too.
- Never ask the user for information or clarification; always give your best output.
- A message starting with "[Copilot action]" is the user asking for a specific kind of help: do that instead of the usual response.
- Prep notes below, if any, are optional context.
- Be concise and skimmable.`;

export const COFFEE_CHAT_PROMPT = `You are a silent copilot for a coffee chat (networking, informational interview, mentor chat).

${LIVE_RULES}

Suggest insightful questions the user could ask next, building on what the person actually said, without repeating what has been covered.`;

export const INTERVIEW_PROMPT = `You are a silent interview copilot.

${LIVE_RULES}

Help with the interviewer's latest question. Answer objective questions (technical, coding, math, estimation, case) and show the work. For behavioral questions, give a structure and a couple of standout ideas rather than a script. For opinion questions (markets, news, trends, "what do you think about…"), give an actual view the user can say.`;

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
    instruction: `Catch me up: I zoned out. What's happening and what did I miss?`,
  },
  {
    id: "define",
    shortcutId: "copilot_define",
    label: "Define",
    instruction: `Define the most recent term, acronym or name I might not know.`,
  },
  {
    id: "clarify",
    shortcutId: "copilot_clarify",
    label: "What they're asking",
    instruction: `What is the other person really asking, and what should a good answer cover?`,
  },
  {
    id: "say_next",
    shortcutId: "copilot_say_next",
    label: "Say this",
    instruction: `Give me one smart thing to say right now.`,
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
    ? "[Copilot action] The coffee chat just ended. Write the notes I'd want afterwards."
    : "[Copilot action] The interview just ended. Write the notes I'd want afterwards, including the questions they asked.";

/** How a response is generated: which Claude model and which tools it may use */
export type GenerationProfileId =
  "sonnet" | "haiku" | "search" | "haikuSearch" | "more";

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

const SEARCH_FIRST = `(Always search first: run 1–3 WebSearches for the latest information, using extended mode for anything time-sensitive like news or markets, and WebFetch primary sources where useful.)`;

export const GENERATION_PROFILES: Record<
  GenerationProfileId,
  GenerationProfile
> = {
  // Ctrl+G and every automatic answer: no tools, fastest
  sonnet: { id: "sonnet", label: "Sonnet", tools: "" },
  // Ctrl+H: Haiku, no tools
  haiku: { id: "haiku", label: "Haiku", model: "haiku", tools: "" },
  // Ctrl+S
  search: {
    id: "search",
    label: "Sonnet + web search",
    tools: "default",
    allowedTools: LOOKUP_TOOLS,
    instruction: SEARCH_FIRST,
  },
  // Ctrl+D: Ctrl+S with Haiku
  haikuSearch: {
    id: "haikuSearch",
    label: "Haiku + web search",
    model: "haiku",
    tools: "default",
    allowedTools: LOOKUP_TOOLS,
    instruction: SEARCH_FIRST,
  },
  // Ctrl+M: web tools only, which skips the full toolset's tool-loading step
  more: {
    id: "more",
    label: "Sonnet + web",
    tools: "WebSearch,WebFetch",
    allowedTools: ["WebSearch", "WebFetch"],
  },
};

/**
 * Appended when the user presses Ctrl+G/H/S: answer a pending question, and
 * otherwise give information that helps with whatever is being discussed
 */
export const ON_DEMAND_INSTRUCTION = `[Copilot action] The user pressed a key for help right now. Help with the latest question or topic, whether the other person or the user raised it: answer it, or give information that augments the user in the discussion.`;

/** Ctrl+M: more on the current topic, shown in its own panel */
export const MORE_INFO_INSTRUCTION = `[Copilot action] More information that could help augment the user's conversation on the current topic, beyond what the copilot already said. First run 1–2 WebSearches (extended mode for anything time-sensitive), and WebFetch a page if useful.`;
