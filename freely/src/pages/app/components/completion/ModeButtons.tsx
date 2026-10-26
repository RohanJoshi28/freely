import { Button } from "@/components";
import { BriefcaseIcon, CoffeeIcon } from "lucide-react";
import { useApp } from "@/contexts";
import { ASSISTANT_MODES, AssistantModeOption } from "@/config";

const MODE_ICONS: Record<AssistantModeOption["id"], typeof CoffeeIcon> = {
  "coffee-chat": CoffeeIcon,
  interview: BriefcaseIcon,
};

export const ModeButtons = () => {
  const { assistantMode, setAssistantMode } = useApp();

  return (
    <>
      {ASSISTANT_MODES.map((mode) => {
        const Icon = MODE_ICONS[mode.id];
        const isActive = assistantMode === mode.id;
        return (
          <Button
            key={mode.id}
            size="icon"
            variant={isActive ? "default" : "outline"}
            className="cursor-pointer"
            title={`${mode.label} mode ${isActive ? "(on)" : "(off)"}`}
            aria-pressed={isActive}
            onClick={() => setAssistantMode(isActive ? "none" : mode.id)}
          >
            <Icon className="h-4 w-4" />
          </Button>
        );
      })}
    </>
  );
};
