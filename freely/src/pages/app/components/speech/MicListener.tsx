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
  // Flush bookkeeping: did a submitted segment start, and who to tell when done
  const flushingRef = useRef(false);
  const segmentStartedRef = useRef(false);
  const flushDoneRef = useRef<(() => void) | null>(null);
  const finishFlush = () => {
    flushDoneRef.current?.();
    flushDoneRef.current = null;
  };

  const micId = selectedAudioDevices.input.id;
  const audioConstraints: MediaTrackConstraints =
    micId && micId !== "default" ? { deviceId: { exact: micId } } : {};

  const vad = useMicVAD({
    userSpeakingThreshold: 0.6,
    startOnLoad: true,
    // Pausing hands over the speech so far (used by the flush below)
    submitUserSpeechOnPause: true,
    onVADMisfire: finishFlush,
    additionalAudioConstraints: audioConstraints,
    onSpeechStart: () => {
      segmentStartRef.current = Date.now();
    },
    onSpeechEnd: async (audio) => {
      segmentStartedRef.current = true;
      const startedAt = segmentStartRef.current;
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
      } finally {
        finishFlush();
      }
    },
  });
  const vadRef = useRef(vad);
  vadRef.current = vad;

  // Submit whatever the user is saying now and wait until it is transcribed
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => {
      if (flushingRef.current) return Promise.resolve();
      flushingRef.current = true;
      segmentStartedRef.current = false;
      return new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(cap);
          flushingRef.current = false;
          resolve();
        };
        const cap = setTimeout(done, 4000);
        flushDoneRef.current = done;
        vadRef.current.pause();
        vadRef.current.start();
        // Nothing was being said: no segment to wait for
        setTimeout(() => {
          if (!segmentStartedRef.current && flushDoneRef.current === done) {
            flushDoneRef.current = null;
            done();
          }
        }, 200);
      });
    };
    return () => {
      flushRef.current = null;
    };
  }, [flushRef]);

  return null;
};
