import { ASSISTANT_MODES, AssistantMode, STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "./helper";

/**
 * Get the active assistant mode from localStorage
 */
export const getAssistantMode = (): AssistantMode => {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.ASSISTANT_MODE);
  return ASSISTANT_MODES.some((m) => m.id === stored)
    ? (stored as AssistantMode)
    : "none";
};

/**
 * Save the active assistant mode to localStorage
 */
export const setAssistantModeStorage = (mode: AssistantMode): void => {
  safeLocalStorage.setItem(STORAGE_KEYS.ASSISTANT_MODE, mode);
};

export type AssistantModeNotes = Partial<
  Record<Exclude<AssistantMode, "none">, string>
>;

/**
 * Get the optional per-mode prep notes from localStorage
 */
export const getAssistantModeNotes = (): AssistantModeNotes => {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.ASSISTANT_MODE_NOTES);
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch {
    return {};
  }
};

/**
 * Save the prep notes for a single mode
 */
export const setAssistantModeNote = (
  mode: Exclude<AssistantMode, "none">,
  note: string,
): void => {
  safeLocalStorage.setItem(
    STORAGE_KEYS.ASSISTANT_MODE_NOTES,
    JSON.stringify({ ...getAssistantModeNotes(), [mode]: note }),
  );
};

/**
 * Whether to also listen to the microphone during system audio capture so the
 * user's own words become context. Defaults to on.
 */
export const getMicEnabled = (): boolean =>
  safeLocalStorage.getItem(STORAGE_KEYS.ASSISTANT_MIC_ENABLED) !== "false";

export const setMicEnabled = (enabled: boolean): void => {
  safeLocalStorage.setItem(STORAGE_KEYS.ASSISTANT_MIC_ENABLED, String(enabled));
};

const getBool = (key: string, fallback: boolean): boolean => {
  const stored = safeLocalStorage.getItem(key);
  return stored === null ? fallback : stored === "true";
};

/** Live captions from local Whisper while listening. Defaults to on. */
export const getLiveTranscriptionEnabled = (): boolean =>
  getBool(STORAGE_KEYS.LIVE_TRANSCRIPTION_ENABLED, true);

export const setLiveTranscriptionEnabled = (enabled: boolean): void => {
  safeLocalStorage.setItem(
    STORAGE_KEYS.LIVE_TRANSCRIPTION_ENABLED,
    String(enabled),
  );
};

export type LocalWhisperModelId = "tiny.en" | "base.en" | "small.en";

export const LOCAL_WHISPER_MODELS: {
  id: LocalWhisperModelId;
  label: string;
  size: string;
}[] = [
  { id: "tiny.en", label: "Tiny (fastest, rough)", size: "75 MB" },
  { id: "base.en", label: "Base (recommended)", size: "142 MB" },
  { id: "small.en", label: "Small (most accurate, slower)", size: "466 MB" },
];

export const getLiveTranscriptionModel = (): LocalWhisperModelId => {
  const stored = safeLocalStorage.getItem(
    STORAGE_KEYS.LIVE_TRANSCRIPTION_MODEL,
  );
  return LOCAL_WHISPER_MODELS.some((m) => m.id === stored)
    ? (stored as LocalWhisperModelId)
    : "base.en";
};

export const setLiveTranscriptionModel = (model: LocalWhisperModelId): void => {
  safeLocalStorage.setItem(STORAGE_KEYS.LIVE_TRANSCRIPTION_MODEL, model);
};

/**
 * Turn judge: a fast model decides whether each finished transcript needs a
 * response before the (slow) AI provider is called. Defaults to on.
 */
export const getTurnJudgeEnabled = (): boolean =>
  getBool(STORAGE_KEYS.TURN_JUDGE_ENABLED, true);

export const setTurnJudgeEnabled = (enabled: boolean): void => {
  safeLocalStorage.setItem(STORAGE_KEYS.TURN_JUDGE_ENABLED, String(enabled));
};

/** Extra keys for the turn judge's fallbacks (Groq comes from the STT provider) */
export interface TurnJudgeKeys {
  mistral?: string;
  gemini?: string;
}

export const getTurnJudgeKeys = (): TurnJudgeKeys => {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.TURN_JUDGE_KEYS);
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch {
    return {};
  }
};

export const setTurnJudgeKey = (
  provider: keyof TurnJudgeKeys,
  key: string,
): void => {
  safeLocalStorage.setItem(
    STORAGE_KEYS.TURN_JUDGE_KEYS,
    JSON.stringify({ ...getTurnJudgeKeys(), [provider]: key.trim() }),
  );
};

/** Notes and a follow-up email when a mode's listening stops. Defaults to on. */
export const getWrapUpEnabled = (): boolean =>
  getBool(STORAGE_KEYS.WRAP_UP_ENABLED, true);

export const setWrapUpEnabled = (enabled: boolean): void => {
  safeLocalStorage.setItem(STORAGE_KEYS.WRAP_UP_ENABLED, String(enabled));
};

/** Claude Code thinking effort for live answers. Ctrl+T toggles; default low. */
export type ThinkingLevel = "low" | "high";

export const getThinkingLevel = (): ThinkingLevel =>
  safeLocalStorage.getItem(STORAGE_KEYS.THINKING_LEVEL) === "high"
    ? "high"
    : "low";

export const setThinkingLevel = (level: ThinkingLevel): void => {
  safeLocalStorage.setItem(STORAGE_KEYS.THINKING_LEVEL, level);
};
