import { Loader2, NotebookPenIcon, SparklesIcon, XIcon } from "lucide-react";
import { Button, CopyButton, Markdown } from "@/components";
import { COPILOT_ACTIONS } from "@/config";
import { CopilotHelperState, WrapUpState } from "@/hooks/useSystemAudio";

const isMac = navigator.platform.toLowerCase().includes("mac");

const key = (k: string) => (isMac ? `⌃${k}` : `Ctrl+Alt+${k}`);

/** Hotkey hints shown while listening */
export const CopilotHotkeys = ({
  thinkingLevel,
}: {
  thinkingLevel: "low" | "high";
}) => (
  <div className="flex flex-wrap gap-x-3 gap-y-1 px-1">
    {[
      ["G", "Sonnet"],
      ["H", "Haiku"],
      ["S", "Search"],
      ["D", "Haiku+search"],
      ["M", "More info"],
    ].map(([k, label]) => (
      <span key={k} className="text-[9px] text-muted-foreground/70">
        <span className="bg-muted/50 px-1 rounded mr-1">{key(k)}</span>
        {label}
      </span>
    ))}
    <span className="text-[9px] text-muted-foreground/70">
      <span className="bg-muted/50 px-1 rounded mr-1">{key("T")}</span>
      Thinking:{" "}
      <span
        className={
          thinkingLevel === "high" ? "font-semibold text-primary" : undefined
        }
      >
        {thinkingLevel}
      </span>
    </span>
    {COPILOT_ACTIONS.map((action, index) => (
      <span key={action.id} className="text-[9px] text-muted-foreground/70">
        <span className="bg-muted/50 px-1 rounded mr-1">
          {key(String(index + 1))}
        </span>
        {action.label}
      </span>
    ))}
  </div>
);

/** Output of a hotkey helper (catch me up, define, …) */
export const HelperCard = ({
  helper,
  onDismiss,
}: {
  helper: CopilotHelperState;
  onDismiss: () => void;
}) => (
  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <SparklesIcon className="w-3.5 h-3.5 text-primary" />
        <h4 className="text-xs font-medium">{helper.label}</h4>
      </div>
      <div className="flex items-center gap-1">
        {helper.text && !helper.loading && <CopyButton content={helper.text} />}
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          title="Dismiss"
          onClick={onDismiss}
        >
          <XIcon className="h-3 w-3" />
        </Button>
      </div>
    </div>
    {helper.loading && !helper.text ? (
      <div className="flex items-center gap-2 py-1">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        <span className="text-[11px] text-muted-foreground">Thinking…</span>
      </div>
    ) : (
      <div className="prose prose-sm max-w-none dark:prose-invert text-sm">
        <Markdown>{helper.text}</Markdown>
      </div>
    )}
    {helper.error && <p className="text-[10px] text-red-600">{helper.error}</p>}
  </div>
);

/** Notes written when listening stops */
export const WrapUpPanel = ({ wrapUp }: { wrapUp: WrapUpState }) => (
  <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <NotebookPenIcon className="w-3.5 h-3.5 text-primary" />
        <h4 className="text-xs font-medium">
          {wrapUp.mode === "coffee-chat" ? "Coffee chat" : "Interview"} wrap-up
        </h4>
      </div>
      {wrapUp.text && !wrapUp.loading && <CopyButton content={wrapUp.text} />}
    </div>
    {wrapUp.loading && !wrapUp.text ? (
      <div className="flex items-center gap-2 py-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground">Writing notes…</span>
      </div>
    ) : (
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <Markdown>{wrapUp.text}</Markdown>
      </div>
    )}
    {wrapUp.error && <p className="text-[10px] text-red-600">{wrapUp.error}</p>}
    {!wrapUp.loading && (
      <p className="text-[9px] text-muted-foreground">
        Saved with this conversation in your history.
      </p>
    )}
  </div>
);
