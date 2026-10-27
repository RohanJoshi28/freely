import { useEffect, useState, useCallback, useRef } from "react";
import { useWindowResize, useGlobalShortcuts } from ".";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/contexts";
import {
  fetchSTT,
  fetchAIResponse,
  judgeTurn,
  prepareLiveTranscription,
  setLiveTranscription,
  isLocalWhisperReady,
  transcribeLocally,
  cleanLocalTranscript,
} from "@/lib/functions";
import {
  AssistantMode,
  AssistantModeOption,
  COPILOT_ACTIONS,
  CopilotActionId,
  DEFAULT_QUICK_ACTIONS,
  DEFAULT_SYSTEM_PROMPT,
  STORAGE_KEYS,
  copilotActionMessage,
  getCopilotAction,
  wrapUpMessage,
} from "@/config";
import {
  safeLocalStorage,
  generateConversationTitle,
  saveConversation,
  CONVERSATION_SAVE_DEBOUNCE_MS,
  generateConversationId,
  generateMessageId,
} from "@/lib";
import {
  getLiveTranscriptionEnabled,
  getLiveTranscriptionModel,
  getTurnJudgeEnabled,
  getTurnJudgeKeys,
  getWrapUpEnabled,
} from "@/lib/storage";
import { AudioSource, Message, SpeakerLabel } from "@/types/completion";

// VAD Configuration interface matching Rust
export interface VadConfig {
  enabled: boolean;
  hop_size: number;
  sensitivity_rms: number;
  peak_threshold: number;
  silence_chunks: number;
  min_speech_chunks: number;
  pre_speech_chunks: number;
  noise_gate_threshold: number;
  max_recording_duration_secs: number;
}

// OPTIMIZED VAD defaults - matches backend exactly for perfect performance
const DEFAULT_VAD_CONFIG: VadConfig = {
  enabled: true,
  hop_size: 1024,
  sensitivity_rms: 0.012, // Much less sensitive - only real speech
  peak_threshold: 0.035, // Higher threshold - filters clicks/noise
  silence_chunks: 45, // ~1.0s of required silence
  min_speech_chunks: 7, // ~0.16s - captures short answers
  pre_speech_chunks: 12, // ~0.27s - enough to catch word start
  noise_gate_threshold: 0.003, // Stronger noise filtering
  max_recording_duration_secs: 180, // 3 minutes default
};

// Chat message interface (reusing from useCompletion)
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  audioSource?: AudioSource;
  speakerLabel?: SpeakerLabel;
}

// Conversation interface (reusing from useCompletion)
export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** One line of the live transcript shown while listening */
export interface TranscriptLine {
  id: string;
  speaker: "them" | "you";
  text: string;
  /** live: local Whisper partial; refining: waiting for Groq; final: done */
  status: "live" | "refining" | "final";
  /** What the turn judge decided for this line, when it ran */
  verdict?: "respond" | "wait" | "skip";
  timestamp: number;
}

/** Output of a hotkey helper (catch me up, define, …) */
export interface CopilotHelperState {
  actionId: CopilotActionId;
  label: string;
  text: string;
  loading: boolean;
  error?: string;
}

/** Notes generated when listening stops */
export interface WrapUpState {
  mode: Exclude<AssistantMode, "none">;
  text: string;
  loading: boolean;
  error?: string;
}

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

const GENERATE_NOW_MESSAGE =
  "(No new audio. The user asked for a response right now: respond to the most recent question or topic in the conversation so far.)";

/** How long a "wait" verdict holds a fragment before answering anyway */
const WAIT_FALLBACK_MS = 4000;
/** Transcript lines kept on screen and given to the judge as context */
const MAX_TRANSCRIPT_LINES = 200;
const JUDGE_CONTEXT_LINES = 6;

/**
 * Conversation messages as AI history, oldest first (messages are stored
 * newest first), marking the user's own mic lines.
 */
const toHistory = (messages: ChatMessage[]): Message[] =>
  [...messages]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((msg) => ({
      role: msg.role,
      content:
        msg.role === "user" && msg.speakerLabel === "user"
          ? `[You said]: ${msg.content}`
          : msg.content,
    }));

const base64ToWavBlob = (base64Audio: string): Blob => {
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: "audio/wav" });
};

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms),
    ),
  ]);

export function useSystemAudio() {
  const { resizeWindow } = useWindowResize();
  const globalShortcuts = useGlobalShortcuts();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [lastTranscription, setLastTranscription] = useState<string>("");
  const [lastAIResponse, setLastAIResponse] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [quickActions, setQuickActions] = useState<string[]>([]);
  const [isManagingQuickActions, setIsManagingQuickActions] =
    useState<boolean>(false);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(true);
  const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);
  const [recordingProgress, setRecordingProgress] = useState<number>(0); // For continuous mode
  const [isContinuousMode, setIsContinuousMode] = useState<boolean>(false);
  const [isRecordingInContinuousMode, setIsRecordingInContinuousMode] =
    useState<boolean>(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [liveTranscriptionReady, setLiveTranscriptionReady] = useState(false);
  const [helper, setHelper] = useState<CopilotHelperState | null>(null);
  const [wrapUp, setWrapUp] = useState<WrapUpState | null>(null);

  const [conversation, setConversation] = useState<ChatConversation>({
    id: "",
    title: "",
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  });

  // Context management states
  const [useSystemPrompt, setUseSystemPrompt] = useState<boolean>(true);
  const [contextContent, setContextContent] = useState<string>("");

  const {
    selectedSttProvider,
    allSttProviders,
    selectedAIProvider,
    allAiProviders,
    systemPrompt,
    selectedAudioDevices,
    assistantMode,
    setAssistantMode,
  } = useApp();
  const abortControllerRef = useRef<AbortController | null>(null);
  const helperAbortRef = useRef<AbortController | null>(null);
  const wrapUpAbortRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Whether the other person is talking right now (system audio VAD)
  const systemSpeechActiveRef = useRef(false);
  const lastSystemSpeechStartRef = useRef(0);
  const isSavingRef = useRef<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Live transcript / turn-taking state read from event listeners
  const liveSegmentRef = useRef<number | null>(null);
  const pendingFragmentRef = useRef("");
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAnsweredRef = useRef("");
  const forceRespondRef = useRef(false);
  const turnQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Latest render values for listeners registered once
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;
  const assistantModeRef = useRef(assistantMode);
  assistantModeRef.current = assistantMode;
  const sttRef = useRef({ selectedSttProvider, allSttProviders });
  sttRef.current = { selectedSttProvider, allSttProviders };

  const getEffectiveSystemPrompt = () =>
    useSystemPrompt
      ? systemPrompt || DEFAULT_SYSTEM_PROMPT
      : contextContent || DEFAULT_SYSTEM_PROMPT;
  const effectivePromptRef = useRef(getEffectiveSystemPrompt);
  effectivePromptRef.current = getEffectiveSystemPrompt;

  // Load context settings and VAD config from localStorage on mount
  useEffect(() => {
    const savedContext = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT,
    );
    if (savedContext) {
      try {
        const parsed = JSON.parse(savedContext);
        setUseSystemPrompt(parsed.useSystemPrompt ?? true);
        setContextContent(parsed.contextContent ?? "");
      } catch (error) {
        console.error("Failed to load system audio context:", error);
      }
    }

    // Load VAD config
    const savedVadConfig = safeLocalStorage.getItem("vad_config");
    if (savedVadConfig) {
      try {
        const parsed = JSON.parse(savedVadConfig);
        setVadConfig(parsed);
      } catch (error) {
        console.error("Failed to load VAD config:", error);
      }
    }
  }, []);

  // Load quick actions from localStorage on mount
  useEffect(() => {
    const savedActions = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
    );
    if (savedActions) {
      try {
        const parsed = JSON.parse(savedActions);
        setQuickActions(parsed);
      } catch (error) {
        console.error("Failed to load quick actions:", error);
        setQuickActions(DEFAULT_QUICK_ACTIONS);
      }
    } else {
      setQuickActions(DEFAULT_QUICK_ACTIONS);
    }
  }, []);

  // --- Live transcript helpers ------------------------------------------

  const upsertLine = useCallback(
    (id: string, patch: Partial<TranscriptLine>, create?: TranscriptLine) => {
      setTranscript((prev) => {
        const index = prev.findIndex((line) => line.id === id);
        if (index === -1) {
          return create
            ? [...prev, { ...create, ...patch }].slice(-MAX_TRANSCRIPT_LINES)
            : prev;
        }
        const next = [...prev];
        next[index] = { ...next[index], ...patch };
        return next;
      });
    },
    [],
  );

  const removeLine = useCallback((id: string) => {
    setTranscript((prev) => prev.filter((line) => line.id !== id));
  }, []);

  /** Add something the other person said as context only (no response) */
  const addContextMessage = useCallback((text: string) => {
    const timestamp = Date.now();
    setConversation((prev) => ({
      ...prev,
      messages: [
        {
          id: generateMessageId("user", timestamp),
          role: "user" as const,
          content: text,
          timestamp,
          audioSource: "system_audio" as const,
          speakerLabel: "interviewer" as const,
        },
        ...prev.messages,
      ],
      updatedAt: timestamp,
      title: prev.title || generateConversationTitle(text),
    }));
  }, []);

  const clearWaitTimer = () => {
    if (waitTimerRef.current) {
      clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
  };

  // Handle continuous recording progress events AND error events
  useEffect(() => {
    let progressUnlisten: (() => void) | undefined;
    let startUnlisten: (() => void) | undefined;
    let stopUnlisten: (() => void) | undefined;
    let errorUnlisten: (() => void) | undefined;
    let discardedUnlisten: (() => void) | undefined;

    const setupContinuousListeners = async () => {
      try {
        // Progress updates (every second)
        progressUnlisten = await listen("recording-progress", (event) => {
          const seconds = event.payload as number;
          setRecordingProgress(seconds);
        });

        // Recording started
        startUnlisten = await listen("continuous-recording-start", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(true);
        });

        // Recording stopped
        stopUnlisten = await listen("continuous-recording-stopped", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(false);
        });

        // Audio encoding errors
        errorUnlisten = await listen("audio-encoding-error", (event) => {
          const errorMsg = event.payload as string;
          console.error("Audio encoding error:", errorMsg);
          setError(`Failed to process audio: ${errorMsg}`);
          setIsProcessing(false);
          setIsAIProcessing(false);
          setIsRecordingInContinuousMode(false);
        });

        // Speech discarded (too short)
        discardedUnlisten = await listen("speech-discarded", (event) => {
          systemSpeechActiveRef.current = false;
          const segment = liveSegmentRef.current;
          if (segment !== null) removeLine(`them-${segment}`);
          liveSegmentRef.current = null;
          // A held fragment was waiting for more speech that never came
          if (pendingFragmentRef.current && !waitTimerRef.current) {
            scheduleWaitFallbackRef.current();
          }
          console.log("Speech discarded:", event.payload as string);
        });
      } catch (err) {
        console.error("Failed to setup continuous recording listeners:", err);
      }
    };

    setupContinuousListeners();

    return () => {
      if (progressUnlisten) progressUnlisten();
      if (startUnlisten) startUnlisten();
      if (stopUnlisten) stopUnlisten();
      if (errorUnlisten) errorUnlisten();
      if (discardedUnlisten) discardedUnlisten();
    };
  }, []);

  // AI Processing function
  const processWithAI = useCallback(
    async (
      transcription: string,
      prompt: string,
      previousMessages: Message[],
      options: { recordUserMessage?: boolean } = {},
    ) => {
      const { recordUserMessage = true } = options;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Record what they said right away, so it stays in the conversation
      // even if this response is superseded before it finishes
      if (recordUserMessage) {
        setLastTranscription(transcription);
        const timestamp = Date.now();
        setConversation((prev) => ({
          ...prev,
          messages: [
            {
              id: generateMessageId("user", timestamp),
              role: "user" as const,
              content: transcription,
              timestamp,
              audioSource: "system_audio" as const,
              speakerLabel: "interviewer" as const,
            },
            ...prev.messages,
          ],
          updatedAt: timestamp,
          title: prev.title || generateConversationTitle(transcription),
        }));
      }

      try {
        setIsAIProcessing(true);
        setLastAIResponse("");
        setError("");

        let fullResponse = "";

        if (!selectedAIProvider.provider) {
          setError("No AI provider selected.");
          return;
        }

        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider,
        );
        if (!provider) {
          setError("AI provider config not found.");
          return;
        }

        try {
          for await (const chunk of fetchAIResponse({
            provider,
            selectedProvider: selectedAIProvider,
            systemPrompt: prompt,
            history: previousMessages,
            userMessage: transcription,
            imagesBase64: [],
            signal: controller.signal,
          })) {
            if (controller.signal.aborted) break;
            fullResponse += chunk;
            setLastAIResponse((prev) => prev + chunk);
          }
        } catch (aiError: any) {
          if (!controller.signal.aborted) {
            setError(aiError.message || "Failed to get AI response");
          }
        }

        if (fullResponse && !controller.signal.aborted) {
          const timestamp = Date.now();
          setConversation((prev) => ({
            ...prev,
            messages: [
              {
                id: generateMessageId("assistant", timestamp),
                role: "assistant" as const,
                content: fullResponse,
                timestamp,
              },
              ...prev.messages,
            ],
            updatedAt: timestamp,
          }));
        }
      } catch (err) {
        setError("Failed to get AI response");
      } finally {
        if (abortControllerRef.current === controller) {
          setIsAIProcessing(false);
        }
      }
    },
    [selectedAIProvider, allAiProviders],
  );
  const processWithAIRef = useRef(processWithAI);
  processWithAIRef.current = processWithAI;

  /** Answer what the other person said with the selected AI provider */
  const respondTo = (text: string) => {
    lastAnsweredRef.current = text;
    processWithAIRef.current(
      text,
      effectivePromptRef.current(),
      toHistory(conversationRef.current.messages),
    );
  };

  /** A held "wait" fragment gets answered if no more speech follows */
  const scheduleWaitFallback = () => {
    clearWaitTimer();
    waitTimerRef.current = setTimeout(() => {
      waitTimerRef.current = null;
      const pending = pendingFragmentRef.current;
      if (!pending || systemSpeechActiveRef.current) return;
      pendingFragmentRef.current = "";
      respondTo(pending);
    }, WAIT_FALLBACK_MS);
  };
  const scheduleWaitFallbackRef = useRef(scheduleWaitFallback);
  scheduleWaitFallbackRef.current = scheduleWaitFallback;

  /** Decide whether a finished transcript of the other person gets a response */
  const handleTheirTurn = async (text: string, lineId: string) => {
    clearWaitTimer();
    const merged = pendingFragmentRef.current
      ? `${pendingFragmentRef.current} ${text}`
      : text;
    pendingFragmentRef.current = "";

    if (forceRespondRef.current || !getTurnJudgeEnabled()) {
      forceRespondRef.current = false;
      upsertLine(lineId, { verdict: "respond" });
      respondTo(merged);
      return;
    }

    const { selectedSttProvider: stt } = sttRef.current;
    const groqKey =
      stt.provider === "groq"
        ? stt.variables?.api_key || stt.variables?.API_KEY
        : undefined;
    const earlier = transcriptRef.current
      .filter((line) => line.status === "final" && line.id !== lineId)
      .slice(-JUDGE_CONTEXT_LINES)
      .map(
        (line) => `${line.speaker === "you" ? "You" : "Them"}: ${line.text}`,
      );

    const { verdict, source } = await judgeTurn({
      mode: assistantModeRef.current,
      latest: merged,
      earlier,
      lastAnswered: lastAnsweredRef.current,
      groqKey,
      keys: getTurnJudgeKeys(),
    });
    console.log(`[turn judge] ${verdict} via ${source}: ${merged}`);
    upsertLine(lineId, { verdict });

    // Ctrl+G pressed while the judge was thinking
    if (forceRespondRef.current) {
      forceRespondRef.current = false;
      respondTo(merged);
      return;
    }

    if (verdict === "respond") {
      respondTo(merged);
    } else if (verdict === "wait") {
      pendingFragmentRef.current = merged;
      scheduleWaitFallback();
    } else {
      addContextMessage(merged);
    }
  };
  const handleTheirTurnRef = useRef(handleTheirTurn);
  handleTheirTurnRef.current = handleTheirTurn;

  /** Transcribe a finished system-audio segment: Groq, else local Whisper */
  const handleSpeechDetected = async (base64Audio: string) => {
    systemSpeechActiveRef.current = false;
    if (!capturingRef.current) return;

    const segment = liveSegmentRef.current;
    liveSegmentRef.current = null;
    const lineId = segment !== null ? `them-${segment}` : `them-${Date.now()}`;
    upsertLine(
      lineId,
      { status: "refining" },
      {
        id: lineId,
        speaker: "them",
        text: "",
        status: "refining",
        timestamp: Date.now(),
      },
    );

    const audioBlob = base64ToWavBlob(base64Audio);
    const { selectedSttProvider: stt, allSttProviders: providers } =
      sttRef.current;
    const providerConfig = providers.find((p) => p.id === stt.provider);

    setIsProcessing(true);
    let text = "";
    try {
      if (!providerConfig) throw new Error("No speech provider selected.");
      const result = await withTimeout(
        fetchSTT({
          provider: providerConfig,
          selectedProvider: stt,
          audio: audioBlob,
          source: "system_audio",
        }),
        30000,
        "Speech transcription timed out (30s)",
      );
      text = result.text.trim();
      setError("");
    } catch (sttError: any) {
      // Rate limited or offline: keep going on the local transcript
      if (isLocalWhisperReady()) {
        try {
          text = await transcribeLocally(audioBlob);
          console.warn("Cloud STT failed, used local Whisper:", sttError);
        } catch (localError) {
          console.error("Local Whisper fallback failed:", localError);
        }
      }
      if (!text) {
        console.error("STT Error:", sttError);
        setError(sttError.message || "Failed to transcribe audio");
      }
    } finally {
      setIsProcessing(false);
    }

    if (!text) {
      removeLine(lineId);
      return;
    }
    upsertLine(lineId, { text, status: "final" });

    // Judge turns one at a time, in order
    turnQueueRef.current = turnQueueRef.current
      .then(() => handleTheirTurnRef.current(text, lineId))
      .catch((err) => console.error("Turn handling failed:", err));
  };
  const handleSpeechDetectedRef = useRef(handleSpeechDetected);
  handleSpeechDetectedRef.current = handleSpeechDetected;

  // System audio events: finished segments, live partials, speech starts
  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    listen<string>("speech-detected", (event) => {
      handleSpeechDetectedRef.current(event.payload);
    }).then((fn) => unlisteners.push(fn));

    // Track when the other person starts talking (mic bleed filter, live
    // transcript line, and holding a "wait" fragment open)
    listen<number | null>("speech-start", (event) => {
      systemSpeechActiveRef.current = true;
      lastSystemSpeechStartRef.current = Date.now();
      clearWaitTimer();
      if (typeof event.payload === "number") {
        liveSegmentRef.current = event.payload;
      }
    }).then((fn) => unlisteners.push(fn));

    listen<{ segment_id: number; text: string }>(
      "transcript-partial",
      (event) => {
        const { segment_id, text } = event.payload;
        if (segment_id !== liveSegmentRef.current || !capturingRef.current) {
          return;
        }
        const cleaned = cleanLocalTranscript(text);
        if (!cleaned) return;
        const id = `them-${segment_id}`;
        upsertLine(
          id,
          { text: cleaned },
          {
            id,
            speaker: "them",
            text: cleaned,
            status: "live",
            timestamp: Date.now(),
          },
        );
      },
    ).then((fn) => unlisteners.push(fn));

    return () => unlisteners.forEach((fn) => fn());
  }, [upsertLine]);

  // Context management functions
  const saveContextSettings = useCallback(
    (usePrompt: boolean, content: string) => {
      try {
        const contextSettings = {
          useSystemPrompt: usePrompt,
          contextContent: content,
        };
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT,
          JSON.stringify(contextSettings),
        );
      } catch (error) {
        console.error("Failed to save context settings:", error);
      }
    },
    [],
  );

  const updateUseSystemPrompt = useCallback(
    (value: boolean) => {
      setUseSystemPrompt(value);
      saveContextSettings(value, contextContent);
    },
    [contextContent, saveContextSettings],
  );

  const updateContextContent = useCallback(
    (content: string) => {
      setContextContent(content);
      saveContextSettings(useSystemPrompt, content);
    },
    [useSystemPrompt, saveContextSettings],
  );

  // Quick actions management
  const saveQuickActions = useCallback((actions: string[]) => {
    try {
      safeLocalStorage.setItem(
        STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
        JSON.stringify(actions),
      );
    } catch (error) {
      console.error("Failed to save quick actions:", error);
    }
  }, []);

  const addQuickAction = useCallback(
    (action: string) => {
      if (action && !quickActions.includes(action)) {
        const newActions = [...quickActions, action];
        setQuickActions(newActions);
        saveQuickActions(newActions);
      }
    },
    [quickActions, saveQuickActions],
  );

  const removeQuickAction = useCallback(
    (action: string) => {
      const newActions = quickActions.filter((a) => a !== action);
      setQuickActions(newActions);
      saveQuickActions(newActions);
    },
    [quickActions, saveQuickActions],
  );

  /**
   * History for an on-demand request: the conversation so far plus anything
   * not yet in it (a held fragment, or what they are saying right now).
   */
  const historyWithLiveContext = (): Message[] => {
    const history = toHistory(conversationRef.current.messages);
    if (pendingFragmentRef.current) {
      history.push({ role: "user", content: pendingFragmentRef.current });
    }
    const live = transcriptRef.current.find(
      (line) => line.speaker === "them" && line.status !== "final" && line.text,
    );
    if (live) {
      history.push({
        role: "user",
        content: `(still speaking, rough transcript) ${live.text}`,
      });
    }
    return history;
  };

  const handleQuickActionClick = async (action: string) => {
    setError("");
    await processWithAI(
      action,
      getEffectiveSystemPrompt(),
      historyWithLiveContext(),
      { recordUserMessage: false },
    );
  };

  /** Hotkey helpers (Ctrl+1–4): stream into their own card, never stored */
  const runCopilotAction = async (actionId: CopilotActionId) => {
    const action = getCopilotAction(actionId);
    if (!action) return;
    const hasContext =
      conversationRef.current.messages.length > 0 ||
      transcriptRef.current.length > 0;
    if (!capturingRef.current && !hasContext) return;

    helperAbortRef.current?.abort();
    const controller = new AbortController();
    helperAbortRef.current = controller;
    setHelper({ actionId, label: action.label, text: "", loading: true });

    const provider = allAiProviders.find(
      (p) => p.id === selectedAIProvider.provider,
    );
    if (!provider) {
      setHelper({
        actionId,
        label: action.label,
        text: "",
        loading: false,
        error: "No AI provider selected.",
      });
      return;
    }

    let text = "";
    try {
      for await (const chunk of fetchAIResponse({
        provider,
        selectedProvider: selectedAIProvider,
        systemPrompt: getEffectiveSystemPrompt(),
        history: historyWithLiveContext(),
        userMessage: copilotActionMessage(action),
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) return;
        text += chunk;
        setHelper((prev) =>
          prev && prev.actionId === actionId ? { ...prev, text } : prev,
        );
      }
      if (!controller.signal.aborted) {
        setHelper((prev) =>
          prev && prev.actionId === actionId
            ? { ...prev, loading: false }
            : prev,
        );
      }
    } catch (err: any) {
      if (controller.signal.aborted) return;
      setHelper({
        actionId,
        label: action.label,
        text,
        loading: false,
        error: err?.message || "Failed to get a response",
      });
    }
  };
  const runCopilotActionRef = useRef(runCopilotAction);
  runCopilotActionRef.current = runCopilotAction;

  const dismissHelper = useCallback(() => {
    helperAbortRef.current?.abort();
    setHelper(null);
  }, []);

  /** Notes + follow-up email for the conversation that just ended */
  const runWrapUp = async (
    mode: Exclude<AssistantMode, "none">,
    messages: ChatMessage[],
  ) => {
    const provider = allAiProviders.find(
      (p) => p.id === selectedAIProvider.provider,
    );
    if (!provider) return;

    wrapUpAbortRef.current?.abort();
    const controller = new AbortController();
    wrapUpAbortRef.current = controller;
    setWrapUp({ mode, text: "", loading: true });

    let text = "";
    try {
      for await (const chunk of fetchAIResponse({
        provider,
        selectedProvider: selectedAIProvider,
        systemPrompt: getEffectiveSystemPrompt(),
        history: toHistory(messages),
        userMessage: wrapUpMessage(mode),
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) return;
        text += chunk;
        setWrapUp((prev) => (prev ? { ...prev, text } : prev));
      }
      if (controller.signal.aborted) return;
      setWrapUp((prev) => (prev ? { ...prev, loading: false } : prev));
      if (text) {
        const timestamp = Date.now();
        setConversation((prev) => ({
          ...prev,
          messages: [
            {
              id: generateMessageId("assistant", timestamp),
              role: "assistant" as const,
              content: `**Wrap-up**\n\n${text}`,
              timestamp,
            },
            ...prev.messages,
          ],
          updatedAt: timestamp,
        }));
      }
    } catch (err: any) {
      if (controller.signal.aborted) return;
      setWrapUp({
        mode,
        text,
        loading: false,
        error: err?.message || "Failed to write the wrap-up",
      });
    }
  };

  const dismissWrapUp = useCallback(() => {
    wrapUpAbortRef.current?.abort();
    setWrapUp(null);
  }, []);

  // Start continuous recording manually
  const startContinuousRecording = useCallback(async () => {
    try {
      setRecordingProgress(0);
      setError("");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      // Start a new continuous recording session
      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
      });
    } catch (err) {
      console.error("Failed to start continuous recording:", err);
      setError(`Failed to start recording: ${err}`);
    }
  }, [vadConfig, selectedAudioDevices.output.id]);

  // Ignore current recording (stop without transcription)
  const ignoreContinuousRecording = useCallback(async () => {
    try {
      if (!isContinuousMode || !isRecordingInContinuousMode) return;

      // Stop the capture without processing
      await invoke<string>("stop_system_audio_capture");

      // Reset states
      setRecordingProgress(0);
      setIsProcessing(false);
      setIsRecordingInContinuousMode(false);
    } catch (err) {
      console.error("Failed to ignore recording:", err);
      setError(`Failed to ignore recording: ${err}`);
    }
  }, [isContinuousMode, isRecordingInContinuousMode]);

  const resetTurnState = () => {
    clearWaitTimer();
    pendingFragmentRef.current = "";
    lastAnsweredRef.current = "";
    forceRespondRef.current = false;
    liveSegmentRef.current = null;
  };

  const startCapture = useCallback(async () => {
    try {
      setError("");

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (!hasAccess) {
        setSetupRequired(true);
        setIsPopoverOpen(true);
        return;
      }

      const isContinuous = !vadConfig.enabled;

      // Set up conversation
      const conversationId = generateConversationId("sysaudio");
      setConversation({
        id: conversationId,
        title: "",
        messages: [],
        createdAt: 0,
        updatedAt: 0,
      });
      setTranscript([]);
      resetTurnState();
      helperAbortRef.current?.abort();
      setHelper(null);
      wrapUpAbortRef.current?.abort();
      setWrapUp(null);

      // Live captions: load the local model in the background
      setLiveTranscriptionReady(false);
      prepareLiveTranscription(
        getLiveTranscriptionModel(),
        getLiveTranscriptionEnabled(),
      ).then(setLiveTranscriptionReady);

      setCapturing(true);
      setIsPopoverOpen(true);
      setIsContinuousMode(isContinuous);
      setRecordingProgress(0);

      // If continuous mode
      if (isContinuous) {
        setIsRecordingInContinuousMode(false);
        return;
      }

      // VAD mode: Start recording immediately
      // Stop any existing capture
      await invoke<string>("stop_system_audio_capture");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      // Start capture with VAD config
      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setIsPopoverOpen(true);
    }
  }, [vadConfig, selectedAudioDevices.output.id]);

  /**
   * Stop listening. When a mode was active (passed in by the mode shortcut,
   * which clears the mode first) and the conversation had substance, write
   * the wrap-up notes.
   */
  const stopCapture = useCallback(
    async (endedMode?: AssistantMode) => {
      const mode =
        typeof endedMode === "string" ? endedMode : assistantModeRef.current;
      try {
        // Abort any ongoing AI requests
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        helperAbortRef.current?.abort();

        // Stop the audio capture
        await invoke<string>("stop_system_audio_capture");
        setLiveTranscription(false).catch(() => {});

        // A fragment still waiting for more speech is part of the record
        let messages = conversationRef.current.messages;
        if (pendingFragmentRef.current) {
          const timestamp = Date.now();
          const pending: ChatMessage = {
            id: generateMessageId("user", timestamp),
            role: "user",
            content: pendingFragmentRef.current,
            timestamp,
            audioSource: "system_audio",
            speakerLabel: "interviewer",
          };
          messages = [pending, ...messages];
          addContextMessage(pending.content);
        }
        resetTurnState();

        // Reset ALL states
        setCapturing(false);
        setIsProcessing(false);
        setIsAIProcessing(false);
        setIsContinuousMode(false);
        setIsRecordingInContinuousMode(false);
        setRecordingProgress(0);
        setLastTranscription("");
        setLastAIResponse("");
        setError("");
        setHelper(null);
        setIsPopoverOpen(false);

        const theirTurns = messages.filter(
          (m) => m.role === "user" && m.speakerLabel !== "user",
        ).length;
        if (mode !== "none" && getWrapUpEnabled() && theirTurns >= 2) {
          runWrapUpRef.current(mode, messages);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(`Failed to stop capture: ${errorMessage}`);
        console.error("Stop capture error:", err);
      }
    },
    [addContextMessage],
  );
  const runWrapUpRef = useRef(runWrapUp);
  runWrapUpRef.current = runWrapUp;

  // Manual stop for continuous recording
  const manualStopAndSend = useCallback(async () => {
    try {
      if (!isContinuousMode) {
        console.warn("Not in continuous mode");
        return;
      }

      // Show processing state immediately
      setIsProcessing(true);

      // Trigger manual stop event
      await invoke("manual_stop_continuous");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to manually stop: ${errorMessage}`);
      setIsProcessing(false); // Clear processing state on error
      console.error("Manual stop error:", err);
    }
  }, [isContinuousMode]);

  // Generate now: send buffered speech without waiting for a pause, or, if
  // nothing new was said, respond from the conversation so far
  const quickActionRef = useRef(handleQuickActionClick);
  quickActionRef.current = handleQuickActionClick;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("speech-flush-empty", () => {
      forceRespondRef.current = false;
      // A held fragment is exactly what "generate now" should answer
      if (pendingFragmentRef.current) {
        clearWaitTimer();
        const pending = pendingFragmentRef.current;
        pendingFragmentRef.current = "";
        respondToRef.current(pending);
        return;
      }
      quickActionRef.current(GENERATE_NOW_MESSAGE);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);
  const respondToRef = useRef(respondTo);
  respondToRef.current = respondTo;

  useEffect(() => {
    globalShortcuts.registerCustomShortcutCallback("generate_now", async () => {
      if (!capturing || isAIProcessing) return;
      if (!isContinuousMode) {
        // The flushed segment skips the turn judge
        forceRespondRef.current = true;
        await invoke("force_flush_speech");
      } else if (isRecordingInContinuousMode) {
        await manualStopAndSend();
      } else {
        await quickActionRef.current(GENERATE_NOW_MESSAGE);
      }
    });
  }, [
    capturing,
    isAIProcessing,
    isContinuousMode,
    isRecordingInContinuousMode,
    manualStopAndSend,
  ]);

  // Helper hotkeys (Ctrl+1–4)
  useEffect(() => {
    COPILOT_ACTIONS.forEach((action) => {
      globalShortcuts.registerCustomShortcutCallback(action.shortcutId, () => {
        runCopilotActionRef.current(action.id);
      });
    });
  }, []);

  const handleSetup = useCallback(async () => {
    try {
      const platform = navigator.platform.toLowerCase();

      if (platform.includes("mac") || platform.includes("win")) {
        await invoke("request_system_audio_access");
      }

      // Delay to give the user time to grant permissions in the system dialog.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (hasAccess) {
        setSetupRequired(false);
        await startCapture();
      } else {
        setSetupRequired(true);
        setError("Permission not granted. Please try the manual steps.");
      }
    } catch (err) {
      setError("Failed to request access. Please try the manual steps below.");
      setSetupRequired(true);
    }
  }, [startCapture]);

  useEffect(() => {
    const shouldOpenPopover =
      capturing ||
      setupRequired ||
      isAIProcessing ||
      !!lastAIResponse ||
      !!error ||
      !!wrapUp;
    setIsPopoverOpen(shouldOpenPopover);
    resizeWindow(shouldOpenPopover);
  }, [
    capturing,
    setupRequired,
    isAIProcessing,
    lastAIResponse,
    error,
    wrapUp,
    resizeWindow,
  ]);

  useEffect(() => {
    globalShortcuts.registerSystemAudioCallback(async () => {
      if (capturing) {
        await stopCapture();
      } else {
        await startCapture();
      }
    });
  }, [startCapture, stopCapture]);

  // Mode shortcuts: one press picks the mode and starts listening, pressing
  // the active mode's shortcut again stops listening and turns the mode off
  useEffect(() => {
    const modeShortcuts: Record<string, AssistantModeOption["id"]> = {
      coffee_chat_mode: "coffee-chat",
      interview_mode: "interview",
    };
    Object.entries(modeShortcuts).forEach(([actionId, mode]) => {
      globalShortcuts.registerCustomShortcutCallback(actionId, async () => {
        if (capturing && assistantMode === mode) {
          setAssistantMode("none");
          await stopCapture(mode);
          return;
        }
        setAssistantMode(mode);
        if (!capturing) {
          await startCapture();
        }
      });
    });
  }, [capturing, assistantMode, setAssistantMode, startCapture, stopCapture]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      helperAbortRef.current?.abort();
      wrapUpAbortRef.current?.abort();
      invoke("stop_system_audio_capture").catch(() => {});
    };
  }, []);

  // Debounced save to prevent race conditions and improve performance
  useEffect(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Only debounce if there are messages to save
    if (
      !conversation.id ||
      conversation.updatedAt === 0 ||
      conversation.messages.length === 0
    ) {
      return;
    }

    // Debounce saves (only save 500ms after last change)
    saveTimeoutRef.current = setTimeout(async () => {
      // Don't save if already saving (prevent concurrent saves)
      if (isSavingRef.current) {
        return;
      }

      try {
        isSavingRef.current = true;
        await saveConversation(conversation);
      } catch (error) {
        console.error("Failed to save system audio conversation:", error);
      } finally {
        isSavingRef.current = false;
      }
    }, CONVERSATION_SAVE_DEBOUNCE_MS);

    // Cleanup on unmount or dependency change
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    conversation.messages.length,
    conversation.title,
    conversation.id,
    conversation.updatedAt,
  ]);

  // Mic: the user's own words become context and never trigger a response.
  // Segments overlapping the other person's speech are dropped: without
  // headphones the mic hears the speakers too, and system audio has that.
  const addUserUtterance = useCallback(
    (text: string, startedAt: number) => {
      if (
        systemSpeechActiveRef.current ||
        lastSystemSpeechStartRef.current >= startedAt
      ) {
        return;
      }
      const timestamp = Date.now();
      setConversation((prev) => ({
        ...prev,
        messages: [
          {
            id: generateMessageId("user", timestamp),
            role: "user" as const,
            content: text,
            timestamp,
            audioSource: "mic" as const,
            speakerLabel: "user" as const,
          },
          ...prev.messages,
        ],
        updatedAt: timestamp,
      }));
      const id = `you-${timestamp}`;
      upsertLine(
        id,
        {},
        { id, speaker: "you", text, status: "final", timestamp },
      );
    },
    [upsertLine],
  );

  const startNewConversation = useCallback(() => {
    setConversation({
      id: generateConversationId("sysaudio"),
      title: "",
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    });
    setTranscript([]);
    resetTurnState();
    setHelper(null);
    setWrapUp(null);
    setLastTranscription("");
    setLastAIResponse("");
    setError("");
    setSetupRequired(false);
    setIsProcessing(false);
    setIsAIProcessing(false);
    setIsPopoverOpen(false);
    setUseSystemPrompt(true);
  }, []);

  // Update VAD configuration
  const updateVadConfiguration = useCallback(async (config: VadConfig) => {
    try {
      setVadConfig(config);
      safeLocalStorage.setItem("vad_config", JSON.stringify(config));
      await invoke("update_vad_config", { config });
    } catch (error) {
      console.error("Failed to update VAD config:", error);
    }
  }, []);

  useEffect(() => {
    if (capturing) {
      setIsContinuousMode(!vadConfig.enabled);

      if (!vadConfig.enabled) {
        setIsRecordingInContinuousMode(false);
      }
    }
  }, [vadConfig.enabled, capturing]);

  // Keyboard arrow key support for scrolling (local shortcut)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      const scrollElement = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]",
      ) as HTMLElement;

      if (!scrollElement) return;

      const scrollAmount = 100; // pixels to scroll

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollElement.scrollBy({ top: scrollAmount, behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollElement.scrollBy({ top: -scrollAmount, behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen]);

  // Keyboard shortcuts for continuous mode recording (local shortcuts)
  useEffect(() => {
    const handleRecordingShortcuts = (e: KeyboardEvent) => {
      if (!isPopoverOpen || !isContinuousMode) return;
      if (isProcessing || isAIProcessing) return;

      // Enter: Start recording (when not recording) or Stop & Send (when recording)
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (!isRecordingInContinuousMode) {
          startContinuousRecording();
        } else {
          manualStopAndSend();
        }
      }

      // Escape: Ignore recording (when recording)
      if (e.key === "Escape" && isRecordingInContinuousMode) {
        e.preventDefault();
        ignoreContinuousRecording();
      }

      // Space: Start recording (when not recording) - only if not typing in input
      if (
        e.key === " " &&
        !isRecordingInContinuousMode &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        startContinuousRecording();
      }
    };

    window.addEventListener("keydown", handleRecordingShortcuts);
    return () =>
      window.removeEventListener("keydown", handleRecordingShortcuts);
  }, [
    isPopoverOpen,
    isContinuousMode,
    isRecordingInContinuousMode,
    isProcessing,
    isAIProcessing,
    startContinuousRecording,
    manualStopAndSend,
    ignoreContinuousRecording,
  ]);

  return {
    capturing,
    addUserUtterance,
    isProcessing,
    isAIProcessing,
    lastTranscription,
    lastAIResponse,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    handleSetup,
    isPopoverOpen,
    setIsPopoverOpen,
    // Conversation management
    conversation,
    setConversation,
    // AI processing
    processWithAI,
    // Context management
    useSystemPrompt,
    setUseSystemPrompt: updateUseSystemPrompt,
    contextContent,
    setContextContent: updateContextContent,
    startNewConversation,
    // Window resize
    resizeWindow,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick,
    // VAD configuration
    vadConfig,
    updateVadConfiguration,
    // Continuous recording
    isContinuousMode,
    isRecordingInContinuousMode,
    recordingProgress,
    manualStopAndSend,
    startContinuousRecording,
    ignoreContinuousRecording,
    // Scroll area ref for keyboard navigation
    scrollAreaRef,
    // Live transcript, hotkey helpers and wrap-up
    transcript,
    liveTranscriptionReady,
    helper,
    dismissHelper,
    runCopilotAction,
    wrapUp,
    dismissWrapUp,
  };
}
