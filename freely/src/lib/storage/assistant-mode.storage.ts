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
  note: string
): void => {
  safeLocalStorage.setItem(
    STORAGE_KEYS.ASSISTANT_MODE_NOTES,
    JSON.stringify({ ...getAssistantModeNotes(), [mode]: note })
  );
};
