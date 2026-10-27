import { useEffect, useRef } from "react";
import { Loader2, TelescopeIcon, Trash2Icon } from "lucide-react";
import { Button, CopyButton, Markdown } from "@/components";
import { MoreInfoEntry } from "@/hooks/useSystemAudio";

type Props = {
  entries: MoreInfoEntry[];
  onClear: () => void;
};

/** Ctrl+M results: a second chat next to the live answers, newest last */
export const MoreInfoPanel = ({ entries, onClear }: Props) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastEntry = entries[entries.length - 1];

  // Follow the newest entry while it streams in
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, lastEntry?.loading]);

  return (
    <div className="flex flex-col w-[46%] min-w-0 border-l border-border/50">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <TelescopeIcon className="w-3.5 h-3.5 text-primary" />
          <h4 className="text-xs font-medium">More info</h4>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          title="Clear"
          onClick={onClear}
        >
          <Trash2Icon className="h-3 w-3" />
        </Button>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2"
      >
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="rounded-lg border border-border/50 bg-muted/20 p-2.5 space-y-1.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-muted-foreground">
                {entry.label}
              </span>
              {entry.text && !entry.loading && (
                <CopyButton content={entry.text} />
              )}
            </div>
            {entry.loading && !entry.text ? (
              <div className="flex items-center gap-2 py-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="text-[11px] text-muted-foreground">
                  Searching…
                </span>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none dark:prose-invert text-[13px]">
                <Markdown>{entry.text}</Markdown>
              </div>
            )}
            {entry.error && (
              <p className="text-[10px] text-red-600">{entry.error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
