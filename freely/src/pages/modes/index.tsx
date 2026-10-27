import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Header,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Switch,
  Textarea,
} from "@/components";
import { PageLayout } from "@/layouts";
import {
  ASSISTANT_MODES,
  AssistantModeOption,
  COPILOT_ACTIONS,
} from "@/config";
import {
  LOCAL_WHISPER_MODELS,
  LocalWhisperModelId,
  getAssistantModeNotes,
  getLiveTranscriptionEnabled,
  getLiveTranscriptionModel,
  getMicEnabled,
  getTurnJudgeEnabled,
  getTurnJudgeKeys,
  getWrapUpEnabled,
  setAssistantModeNote,
  setLiveTranscriptionEnabled,
  setLiveTranscriptionModel,
  setMicEnabled,
  setTurnJudgeEnabled,
  setTurnJudgeKey,
  setWrapUpEnabled,
} from "@/lib/storage";
import {
  LocalWhisperModelInfo,
  downloadLocalWhisperModel,
  getLocalWhisperModel,
} from "@/lib/functions";

const MODE_DESCRIPTIONS: Record<AssistantModeOption["id"], string> = {
  "coffee-chat":
    "Suggests follow-up questions from the live audio of the conversation. Anything you add here is extra context, such as who you're meeting and what you want to learn.",
  interview:
    "Answers objective questions with the work shown, and gives a structure plus ideas for behavioral ones. Anything you add here (role, company, resume highlights, stories) helps tailor the ideas.",
};

const ModeNotes = ({ mode }: { mode: AssistantModeOption }) => {
  const [note, setNote] = useState(
    () => getAssistantModeNotes()[mode.id] ?? "",
  );

  return (
    <div className="space-y-4">
      <Header
        title={mode.label}
        description={MODE_DESCRIPTIONS[mode.id]}
        isMainTitle
      />
      <div className="space-y-2">
        <Label className="text-sm font-medium">Prep notes (optional)</Label>
        <Textarea
          value={note}
          placeholder={mode.notesPlaceholder}
          className="min-h-32"
          onChange={(e) => {
            setNote(e.target.value);
            setAssistantModeNote(mode.id, e.target.value);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Saved automatically. Leave blank and the mode works from the audio
          alone.
        </p>
      </div>
    </div>
  );
};

const ToggleRow = ({
  title,
  description,
  initial,
  onChange,
}: {
  title: string;
  description: string;
  initial: () => boolean;
  onChange: (enabled: boolean) => void;
}) => {
  const [enabled, setEnabled] = useState(initial);
  return (
    <div className="flex items-center justify-between gap-4 p-4 border rounded-xl">
      <div>
        <Label className="text-sm font-medium">{title}</Label>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={(checked) => {
          setEnabled(checked);
          onChange(checked);
        }}
        aria-label={title}
      />
    </div>
  );
};

const formatMB = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

const LiveTranscriptionSettings = () => {
  const [model, setModel] = useState<LocalWhisperModelId>(
    getLiveTranscriptionModel,
  );
  const [info, setInfo] = useState<LocalWhisperModelInfo | null>(null);
  const [progress, setProgress] = useState<{
    downloaded: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setInfo(await getLocalWhisperModel(model));
    } catch (err) {
      setInfo(null);
      setError(String(err));
    }
  }, [model]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const download = async () => {
    setError("");
    setProgress({ downloaded: 0, total: 0 });
    try {
      await downloadLocalWhisperModel(model, ({ downloaded, total }) =>
        setProgress({ downloaded, total }),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setProgress(null);
      refresh();
    }
  };

  const modelMeta = LOCAL_WHISPER_MODELS.find((m) => m.id === model);

  return (
    <div className="space-y-3">
      <ToggleRow
        title="Live captions (local Whisper)"
        description="Transcribes the conversation on your Mac as people talk, so you can read along. When they pause, Groq refines the text and that version is what the AI answers from. Your own mic is transcribed locally too, which saves your Groq quota. If Groq is rate limited, the local transcript is used instead."
        initial={getLiveTranscriptionEnabled}
        onChange={setLiveTranscriptionEnabled}
      />
      <div className="p-4 border rounded-xl space-y-3">
        <Label className="text-sm font-medium">Local model</Label>
        <Select
          value={model}
          onValueChange={(value) => {
            const id = value as LocalWhisperModelId;
            setModel(id);
            setLiveTranscriptionModel(id);
          }}
        >
          <SelectTrigger className="w-full h-10">
            {modelMeta ? `${modelMeta.label} · ${modelMeta.size}` : model}
          </SelectTrigger>
          <SelectContent>
            {LOCAL_WHISPER_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label} · {m.size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {progress
              ? `Downloading… ${formatMB(progress.downloaded)}${
                  progress.total ? ` of ${formatMB(progress.total)}` : ""
                }`
              : info?.downloaded
                ? `Downloaded (${formatMB(info.size_bytes)}). Loads when you start listening.`
                : "Not downloaded yet. Live captions stay off until it is."}
          </p>
          {!info?.downloaded && (
            <Button size="sm" onClick={download} disabled={!!progress}>
              {progress ? "Downloading…" : "Download"}
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
};

const JudgeKeyInput = ({
  provider,
  label,
}: {
  provider: "mistral" | "gemini";
  label: string;
}) => {
  const [value, setValue] = useState(() => getTurnJudgeKeys()[provider] ?? "");
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      <Input
        type="password"
        value={value}
        placeholder="Optional"
        onChange={(e) => {
          setValue(e.target.value);
          setTurnJudgeKey(provider, e.target.value);
        }}
      />
    </div>
  );
};

const TurnJudgeSettings = () => (
  <div className="space-y-3">
    <ToggleRow
      title="Only respond when it's useful"
      description='Before calling the AI, a fast model checks each thing they say: answer it, wait (they are mid-question), or skip (small talk, "yeah", logistics). It only decides; every answer still comes from your AI provider. Uses your Groq key; if Groq is unavailable it tries the backups below, and if nothing answers it responds as usual.'
      initial={getTurnJudgeEnabled}
      onChange={setTurnJudgeEnabled}
    />
    <div className="p-4 border rounded-xl space-y-3">
      <p className="text-xs text-muted-foreground">
        Backups, in order, used only after Groq Qwen hits its limit: Mistral
        Ministral 14B, then Groq gpt-oss-20b, then Gemini 3.5 Flash-Lite.
      </p>
      <JudgeKeyInput provider="mistral" label="Mistral API key" />
      <JudgeKeyInput provider="gemini" label="Gemini API key" />
    </div>
  </div>
);

const Modes = () => {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const helperKeys = COPILOT_ACTIONS.map(
    (action, i) =>
      `${isMac ? "Ctrl" : "Ctrl+Alt"}+${i + 1} ${action.label.toLowerCase()}`,
  ).join(", ");

  return (
    <PageLayout
      title="Coffee Chat & Interview"
      description={`Press Ctrl+K for a coffee chat or Ctrl+I for an interview: it switches modes and starts listening in one go. Respond right away instead of waiting for a pause: Ctrl+G with Sonnet (no tools, fastest), Ctrl+H with Haiku (no tools, faster), Ctrl+S with Sonnet after a web search, Ctrl+D with Haiku after a web search. Ctrl+T switches Claude's thinking between low (default) and high. While listening: ${helperKeys}. Press the same mode key again to stop and get notes. It never asks you for anything mid-conversation. Rebind the keys under Cursor & Shortcuts.`}
    >
      <LiveTranscriptionSettings />
      <TurnJudgeSettings />
      <ToggleRow
        title="Also listen to my microphone"
        description="Your own words are added as context so it knows what you already asked or answered. It never responds to them. Wear headphones for best results; without them, your mic also hears the other person."
        initial={getMicEnabled}
        onChange={setMicEnabled}
      />
      <ToggleRow
        title="Wrap-up when I stop"
        description="When you stop listening in coffee chat or interview mode, write notes (what you learned, questions asked, what to follow up on). Saved with the conversation."
        initial={getWrapUpEnabled}
        onChange={setWrapUpEnabled}
      />
      {ASSISTANT_MODES.map((mode) => (
        <ModeNotes key={mode.id} mode={mode} />
      ))}
    </PageLayout>
  );
};

export default Modes;
