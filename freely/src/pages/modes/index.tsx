import { useState } from "react";
import { Header, Label, Switch, Textarea } from "@/components";
import { PageLayout } from "@/layouts";
import { ASSISTANT_MODES, AssistantModeOption } from "@/config";
import {
  getAssistantModeNotes,
  getMicEnabled,
  setAssistantModeNote,
  setMicEnabled,
} from "@/lib/storage";

const MODE_DESCRIPTIONS: Record<AssistantModeOption["id"], string> = {
  "coffee-chat":
    "Suggests follow-up questions from the live audio of the conversation. Anything you add here is extra context, such as who you're meeting and what you want to learn.",
  interview:
    "Answers objective questions with the work shown, and gives a structure plus ideas for behavioral ones. Anything you add here (role, company, resume highlights, stories) helps tailor the ideas.",
};

const ModeNotes = ({ mode }: { mode: AssistantModeOption }) => {
  const [note, setNote] = useState(() => getAssistantModeNotes()[mode.id] ?? "");

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

const MicToggle = () => {
  const [enabled, setEnabled] = useState(getMicEnabled);
  return (
    <div className="flex items-center justify-between p-4 border rounded-xl">
      <div>
        <Label className="text-sm font-medium">Also listen to my microphone</Label>
        <p className="text-xs text-muted-foreground mt-1">
          Your own words are added as context so it knows what you already
          asked or answered. It never responds to them. Wear headphones for
          best results; without them, your mic also hears the other person.
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={(checked) => {
          setEnabled(checked);
          setMicEnabled(checked);
        }}
        aria-label="Toggle microphone listening"
      />
    </div>
  );
};

const Modes = () => {
  return (
    <PageLayout
      title="Coffee Chat & Interview"
      description="Press Ctrl+K for a coffee chat or Ctrl+I for an interview: it switches modes and starts listening in one go. Press Ctrl+G to get a response right away instead of waiting for a pause. Press the same mode keys again to stop. It responds on its own and never asks you for anything mid-conversation. Rebind the keys under Cursor & Shortcuts."
    >
      <MicToggle />
      {ASSISTANT_MODES.map((mode) => (
        <ModeNotes key={mode.id} mode={mode} />
      ))}
    </PageLayout>
  );
};

export default Modes;
