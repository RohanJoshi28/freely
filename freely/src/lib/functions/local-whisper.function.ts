import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LocalWhisperModelId } from "@/lib/storage";
import { blobToBase64 } from "./common.function";

export interface LocalWhisperModelInfo {
  model: LocalWhisperModelId;
  downloaded: boolean;
  path: string;
  size_bytes: number;
  loaded: boolean;
}

export interface ModelDownloadProgress {
  model: string;
  downloaded: number;
  total: number;
}

export const getLocalWhisperModel = (model: LocalWhisperModelId) =>
  invoke<LocalWhisperModelInfo>("get_local_whisper_model", { model });

export const downloadLocalWhisperModel = async (
  model: LocalWhisperModelId,
  onProgress?: (progress: ModelDownloadProgress) => void,
) => {
  const unlisten = onProgress
    ? await listen<ModelDownloadProgress>(
        "whisper-model-download-progress",
        (event) => {
          if (event.payload.model === model) onProgress(event.payload);
        },
      )
    : undefined;
  try {
    return await invoke<string>("download_local_whisper_model", { model });
  } finally {
    unlisten?.();
  }
};

export const loadLocalWhisperModel = (model: LocalWhisperModelId) =>
  invoke<void>("load_local_whisper_model", { model });

export const setLiveTranscription = (enabled: boolean) =>
  invoke<void>("set_live_transcription", { enabled });

/** True once a model is loaded and ready to transcribe */
let localWhisperReady = false;
export const isLocalWhisperReady = () => localWhisperReady;

/**
 * Load the chosen model if it is downloaded and turn live partials on.
 * Never downloads anything (that is done from the settings page) and never
 * throws: live captions are a nice-to-have, the Groq transcript still works.
 */
export async function prepareLiveTranscription(
  model: LocalWhisperModelId,
  enabled: boolean,
): Promise<boolean> {
  try {
    if (!enabled) {
      await setLiveTranscription(false);
      return false;
    }
    const info = await getLocalWhisperModel(model);
    if (!info.downloaded) {
      await setLiveTranscription(false);
      return false;
    }
    await loadLocalWhisperModel(model);
    localWhisperReady = true;
    await setLiveTranscription(true);
    return true;
  } catch (err) {
    console.error("Local Whisper unavailable:", err);
    return false;
  }
}

/** Whisper's usual hallucinations on silence or noise */
const HALLUCINATIONS =
  /^[\s.]*(\[.*\]|\(.*\)|thank you\.?|thanks for watching!?|you\.?|bye\.?|\.+)[\s.]*$/i;

export const cleanLocalTranscript = (text: string): string =>
  HALLUCINATIONS.test(text) ? "" : text.replace(/\s+/g, " ").trim();

/** Transcribe a WAV blob with the loaded local model */
export async function transcribeLocally(audio: Blob): Promise<string> {
  const audioB64 = await blobToBase64(audio);
  const text = await invoke<string>("transcribe_local", { audioB64 });
  return cleanLocalTranscript(text);
}
