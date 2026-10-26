import { useState } from "react";
import { Header, Label, Textarea } from "@/components";
import { PageLayout } from "@/layouts";
import { ASSISTANT_MODES, AssistantModeOption } from "@/config";
import { getAssistantModeNotes, setAssistantModeNote } from "@/lib/storage";

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

const Modes = () => {
  return (
    <PageLayout
      title="Coffee Chat & Interview"
      description="Turn a mode on with the ☕ / 💼 buttons in the overlay, then start system audio. It listens and responds on its own and never asks you for anything mid-conversation."
    >
      {ASSISTANT_MODES.map((mode) => (
        <ModeNotes key={mode.id} mode={mode} />
      ))}
    </PageLayout>
  );
};

export default Modes;
