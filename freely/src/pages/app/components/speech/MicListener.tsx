import { useRef } from "react";
import { useMicVAD } from "@ricky0123/vad-react";
import { useApp } from "@/contexts";
import { fetchSTT } from "@/lib/functions";
import { floatArrayToWav } from "@/lib/utils";

interface MicListenerProps {
  /** Called with the user's transcribed speech and when that segment started */
  onUserSpeech: (text: string, startedAt: number) => void;
}

/**
 * Listens to the microphone while system audio capture is running so the
 * user's own words become conversation context. Renders nothing; mount it to
 * start listening and unmount it to stop.
 */
export const MicListener = ({ onUserSpeech }: MicListenerProps) => {
  const { selectedSttProvider, allSttProviders, selectedAudioDevices } =
    useApp();
  const segmentStartRef = useRef(0);
  const onUserSpeechRef = useRef(onUserSpeech);
  onUserSpeechRef.current = onUserSpeech;

  const micId = selectedAudioDevices.input.id;
  const audioConstraints: MediaTrackConstraints =
    micId && micId !== "default" ? { deviceId: { exact: micId } } : {};

  useMicVAD({
    userSpeakingThreshold: 0.6,
    startOnLoad: true,
    additionalAudioConstraints: audioConstraints,
    onSpeechStart: () => {
      segmentStartRef.current = Date.now();
    },
    onSpeechEnd: async (audio) => {
      const startedAt = segmentStartRef.current;
      const providerConfig = allSttProviders.find(
        (p) => p.id === selectedSttProvider.provider
      );
      if (!providerConfig) return;

      try {
        const result = await fetchSTT({
          provider: providerConfig,
          selectedProvider: selectedSttProvider,
          audio: floatArrayToWav(audio, 16000, "wav"),
          source: "mic",
        });
        const text = result.text.trim();
        if (text) onUserSpeechRef.current(text, startedAt);
      } catch (err) {
        console.error("Mic transcription failed:", err);
      }
    },
  });

  return null;
};
