import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AssistantMode } from "@/config";
import type { TurnJudgeKeys } from "@/lib/storage";

/**
 * Turn judge: decides whether a finished transcript of the other person
 * deserves a (slow, ~9 s) AI response right now.
 *
 *   respond  a complete question/request, or (coffee chat) something worth
 *            asking a follow-up about
 *   wait     they are mid-thought; hold the text and merge it with what comes next
 *   skip     filler, small talk, logistics, or an already-answered question
 *
 * Cheap local rules catch the obvious cases; the rest goes to the fastest
 * free model that still has quota (benchmarked 2026-10-27 on 24 live-style
 * cases): Groq Qwen 3.8 27B (22/24, 0.26 s median) → Mistral Ministral 14B
 * (20/24, 0.54 s) → Groq gpt-oss-20b (19/24, 0.42 s) → Gemini 3.5 Flash-Lite
 * (22/24 but ~2 s). Rate-limited providers are skipped until their quota
 * resets. If nothing answers in time the verdict is "respond", which is
 * exactly how it behaved before the judge existed. The judge only ever
 * returns a label: everything the user reads comes from the selected AI
 * provider.
 */
export type TurnVerdict = "respond" | "wait" | "skip";

export interface TurnJudgeResult {
  verdict: TurnVerdict;
  source: string;
}

export interface TurnJudgeInput {
  mode: AssistantMode;
  /** What the other person just said (possibly several merged fragments) */
  latest: string;
  /** Recent conversation lines, oldest first, e.g. "Them: …" / "You: …" */
  earlier: string[];
  /** The last thing the copilot already responded to, for dedup */
  lastAnswered?: string;
  groqKey?: string;
  keys: TurnJudgeKeys;
}

/** Whole-judge budget; past it the turn is answered without a verdict */
const JUDGE_BUDGET_MS = 4000;

const ACKNOWLEDGEMENTS =
  /^(yeah|yes|yep|yup|no|nope|ok|okay|right|sure|totally|exactly|cool|nice|great|awesome|perfect|gotcha|got it|i see|mm+|hm+|uh+|um+|ah+|oh+|wow|true|definitely|absolutely|of course|for sure|makes sense|that makes sense|sounds good|thanks|thank you|haha|ha|lol)([\s,.!]+(yeah|yes|right|sure|totally|okay|ok|exactly|cool|great|definitely|absolutely|good|nice|thanks|haha|ha|mm+|hm+))*[\s,.!]*$/i;

const ASK_START =
  /^(tell|explain|walk|describe|why|how|what|when|where|who|which|can|could|would|will|do|did|does|is|are|was|were|give|design|write|implement|solve|estimate|calculate|have|any|should)\b/i;

const DANGLING_WORDS = new Set([
  "and",
  "or",
  "but",
  "so",
  "because",
  "the",
  "a",
  "an",
  "to",
  "of",
  "for",
  "with",
  "about",
  "is",
  "are",
  "was",
  "were",
  "if",
  "that",
  "which",
  "um",
  "uh",
  "like",
  "how",
  "what",
  "when",
  "where",
  "why",
  "your",
  "my",
  "their",
  "our",
  "you'd",
  "you'll",
  "would",
  "could",
  "should",
  "can",
  "will",
  "in",
  "on",
  "at",
  "from",
  "as",
  "than",
  "then",
  "into",
  "whether",
  "also",
  "basically",
  "kind",
  "sort",
  "maybe",
  "just",
  "you",
]);

const SETUP_PHRASE =
  /(my question is|the question is|let me ask you|i want to ask( you)?|i'd like to ask( you)?|here's (the|my) question|i'm curious( about)?|what i want to know is|i wanted to ask( you)?)[\s,.:…-]*$/i;

/** The cases that never need a model call */
export function localTurnVerdict(text: string): TurnVerdict | null {
  const t = text.trim();
  if (!t) return "skip";
  if (SETUP_PHRASE.test(t)) return "wait";

  const endsSentence = /[.?!]["')\]]*$/.test(t);
  const lastWord = t
    .split(/\s+/)
    .pop()!
    .toLowerCase()
    .replace(/[^a-z']/g, "");
  if (
    /(,|…|\.\.\.|-|—)$/.test(t) ||
    (!endsSentence && DANGLING_WORDS.has(lastWord))
  ) {
    return "wait";
  }

  const words = t.split(/\s+/).length;
  if (
    !t.includes("?") &&
    (ACKNOWLEDGEMENTS.test(t) || (words < 4 && !ASK_START.test(t)))
  ) {
    return "skip";
  }
  return null;
}

const MODE_NAMES: Record<AssistantMode, string> = {
  "coffee-chat": "coffee chat (networking conversation)",
  interview: "job interview",
  none: "conversation",
};

const systemPrompt = (mode: AssistantMode) =>
  `You decide, during a live ${MODE_NAMES[mode]}, whether the user's copilot should respond right now to what the other person just said. The copilot is slow, so only respond when it helps.
Answer with ONE word:
RESPOND - the latest words complete a question, request or task for the user${
    mode === "interview"
      ? ""
      : ", or share something substantive worth asking a follow-up about: a story, opinion, career move, decision or advice"
  }.
WAIT - the speaker is mid-thought: the words stop mid-sentence, or announce a question that has not been asked yet ("so my question is", "let me ask you", trailing "and", "the", "how you'd").
SKIP - filler, acknowledgements, small talk, logistics (time, screen sharing, audio, "give me a second"), ${
    mode === "interview"
      ? "the interviewer describing the team, role, company or process without asking anything, "
      : ""
  }or a question that was already answered (see "Already answered").`;

const userPrompt = (input: TurnJudgeInput) => {
  const parts: string[] = [];
  if (input.earlier.length) {
    parts.push(`Earlier in the conversation:\n${input.earlier.join("\n")}`);
  }
  if (input.lastAnswered) {
    parts.push(`Already answered: "${input.lastAnswered.slice(-300)}"`);
  }
  parts.push(
    `Latest words from the other person:\n"${input.latest.slice(-1000)}"`,
  );
  parts.push("One word: RESPOND, WAIT or SKIP.");
  return parts.join("\n\n");
};

interface JudgeProvider {
  id: string;
  url: string;
  model: string;
  key: (input: TurnJudgeInput) => string | undefined;
  extra: Record<string, unknown>;
  timeoutMs: number;
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const PROVIDERS: JudgeProvider[] = [
  {
    id: "groq-qwen",
    url: GROQ_URL,
    model: "qwen/qwen3.8-27b",
    key: (i) => i.groqKey,
    extra: { reasoning_effort: "none" },
    timeoutMs: 1500,
  },
  {
    id: "mistral",
    url: "https://api.mistral.ai/v1/chat/completions",
    model: "ministral-14b-latest",
    key: (i) => i.keys.mistral,
    extra: {},
    timeoutMs: 1500,
  },
  {
    id: "groq-gpt-oss",
    url: GROQ_URL,
    model: "openai/gpt-oss-20b",
    key: (i) => i.groqKey,
    extra: { reasoning_effort: "low" },
    timeoutMs: 2000,
  },
  {
    id: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-3.5-flash-lite",
    key: (i) => i.keys.gemini,
    extra: { reasoning_effort: "minimal" },
    timeoutMs: 3000,
  },
];

/** provider id → time (ms) before which it is skipped (rate limited) */
const cooldownUntil = new Map<string, number>();

/** "14m24s" / "1.5s" / "120ms" / "30" → milliseconds */
export function parseResetHeader(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return parseFloat(value) * 1000;
  let ms = 0;
  let matched = false;
  for (const [, num, unit] of value.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const n = parseFloat(num);
    ms +=
      unit === "h"
        ? n * 3600e3
        : unit === "m"
          ? n * 60e3
          : unit === "s"
            ? n * 1e3
            : n;
  }
  return matched ? ms : null;
}

export function parseVerdict(text: string): TurnVerdict | null {
  const match = text.toUpperCase().match(/\b(RESPOND|WAIT|SKIP)\b/);
  return match ? (match[1].toLowerCase() as TurnVerdict) : null;
}

async function askProvider(
  provider: JudgeProvider,
  apiKey: string,
  input: TurnJudgeInput,
  timeoutMs: number,
): Promise<TurnVerdict | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await tauriFetch(provider.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: systemPrompt(input.mode) },
          { role: "user", content: userPrompt(input) },
        ],
        temperature: 0,
        max_tokens: 300,
        ...provider.extra,
      }),
      signal: controller.signal,
    });
    if (response.status === 429) {
      const wait =
        parseResetHeader(response.headers.get("retry-after")) ??
        parseResetHeader(response.headers.get("x-ratelimit-reset-requests")) ??
        60_000;
      cooldownUntil.set(provider.id, Date.now() + Math.max(wait, 5_000));
      return null;
    }
    if (!response.ok) return null;
    const data = await response.json();
    return parseVerdict(data?.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function judgeTurn(
  input: TurnJudgeInput,
): Promise<TurnJudgeResult> {
  const local = localTurnVerdict(input.latest);
  if (local) return { verdict: local, source: "local" };

  const deadline = Date.now() + JUDGE_BUDGET_MS;
  for (const provider of PROVIDERS) {
    const apiKey = provider.key(input);
    if (!apiKey) continue;
    if ((cooldownUntil.get(provider.id) ?? 0) > Date.now()) continue;
    const remaining = deadline - Date.now();
    if (remaining < 300) break;
    const verdict = await askProvider(
      provider,
      apiKey,
      input,
      Math.min(provider.timeoutMs, remaining),
    );
    if (verdict) return { verdict, source: provider.id };
  }
  return { verdict: "respond", source: "fallback" };
}
