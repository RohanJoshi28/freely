import { MutableRefObject, useEffect, useRef } from "react";
import { useMicVAD } from "@ricky0123/vad-react";
import { useApp } from "@/contexts";
import {
  fetchSTT,
  isLocalWhisperReady,
  transcribeLocally,
} from "@/lib/functions";
import { floatArrayToWav } from "@/lib/utils";

interface MicListenerProps {
  /** Called with the user's transcribed speech and when that segment started */
  onUserSpeech: (text: string, startedAt: number) => void;
  /** Filled with a function that submits in-progress speech right away */
  flushRef?: MutableRefObject<(() => Promise<void>) | null>;
}

/**
 * Listens to the microphone while system audio capture is running so the
 * user's own words become conversation context. Renders nothing; mount it to
 * start listening and unmount it to stop.
 */
export const MicListener = ({ onUserSpeech, flushRef }: MicListenerProps) => {
  const { selectedSttProvider, allSttProviders, selectedAudioDevices } =
    useApp();
  const segmentStartRef = useRef(0);
  const onUserSpeechRef = useRef(onUserSpeech);
  onUserSpeechRef.current = onUserSpeech;
  // Transcriptions still running, so a flush can wait for them
  const inFlightRef = useRef(new Set<Promise<void>>());

  const micId = selectedAudioDevices.input.id;
  const audioConstraints: MediaTrackConstraints =
    micId && micId !== "default" ? { deviceId: { exact: micId } } : {};

  const transcribe = async (audio: Float32Array, startedAt: number) => {
    const wav = floatArrayToWav(audio, 16000, "wav");
    try {
      // Your own words are context only, so the local model is accurate
      // enough and keeps the cloud STT quota for the other person
      let text = "";
      if (isLocalWhisperReady()) {
        text = await transcribeLocally(wav);
      } else {
        const providerConfig = allSttProviders.find(
          (p) => p.id === selectedSttProvider.provider,
        );
        if (!providerConfig) return;
        const result = await fetchSTT({
          provider: providerConfig,
          selectedProvider: selectedSttProvider,
          audio: wav,
          source: "mic",
        });
        text = result.text.trim();
      }
      if (text) onUserSpeechRef.current(text, startedAt);
    } catch (err) {
      console.error("Mic transcription failed:", err);
    }
  };

  const vad = useMicVAD({
    userSpeakingThreshold: 0.6,
    startOnLoad: true,
    // Pausing hands over the speech so far (used by the flush below)
    submitUserSpeechOnPause: true,
    additionalAudioConstraints: audioConstraints,
    onSpeechStart: () => {
      segmentStartRef.current = Date.now();
    },
    onSpeechEnd: (audio) => {
      const startedAt = segmentStartRef.current;
      const job = transcribe(audio, startedAt);
      inFlightRef.current.add(job);
      job.finally(() => inFlightRef.current.delete(job));
    },
  });
  const vadRef = useRef(vad);
  vadRef.current = vad;

  // Submit whatever the user is saying now, then wait for it and any
  // transcription already running (they may have just stopped talking)
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = async () => {
      vadRef.current.pause();
      vadRef.current.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const pending = [...inFlightRef.current];
      if (!pending.length) return;
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    };
    return () => {
      flushRef.current = null;
    };
  }, [flushRef]);

  return null;
};
