import { useEffect, useRef } from "react";
import { CaptionsIcon, Loader2 } from "lucide-react";
import { TranscriptLine } from "@/hooks/useSystemAudio";
import { cn } from "@/lib/utils";

type Props = {
  transcript: TranscriptLine[];
  liveReady: boolean;
};

const VERDICT_NOTES: Partial<
  Record<NonNullable<TranscriptLine["verdict"]>, string>
> = {
  wait: "waiting for the rest",
  skip: "no response needed",
};

/**
 * What both sides said, newest at the bottom. Their lines appear as local
 * Whisper hears them (italic), then are replaced by the refined transcript.
 */
export const LiveTranscript = ({ transcript, liveReady }: Props) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const visible = transcript.filter((line) => line.text);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/10">
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
        <div className="flex items-center gap-1.5">
          <CaptionsIcon className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Transcript
          </span>
        </div>
        {!liveReady && (
          <span className="text-[9px] text-muted-foreground/70">
            Live captions off: download a model in Coffee chat &amp; interview
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="max-h-28 overflow-y-auto px-2.5 pb-2 space-y-1"
      >
        {visible.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/70 py-1">
            Listening…
          </p>
        ) : (
          visible.map((line) => (
            <p
              key={line.id}
              className={cn(
                "text-[11px] leading-snug",
                line.status === "live" && "italic text-muted-foreground",
                line.verdict === "skip" && "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "font-semibold mr-1",
                  line.speaker === "you" ? "text-primary" : "text-foreground",
                )}
              >
                {line.speaker === "you" ? "You:" : "Them:"}
              </span>
              {line.text}
              {line.status === "refining" && (
                <Loader2 className="inline w-2.5 h-2.5 ml-1 animate-spin text-muted-foreground" />
              )}
              {line.verdict && VERDICT_NOTES[line.verdict] && (
                <span className="ml-1 text-[9px] text-muted-foreground/70">
                  · {VERDICT_NOTES[line.verdict]}
                </span>
              )}
            </p>
          ))
        )}
      </div>
    </div>
  );
};
