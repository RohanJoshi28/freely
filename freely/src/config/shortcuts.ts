import { ShortcutAction } from "@/types";

export const DEFAULT_SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: "toggle_dashboard",
    name: "Toggle Dashboard",
    description: "Open/Close the dashboard window",
    defaultKey: {
      macos: "cmd+shift+d",
      windows: "ctrl+shift+d",
      linux: "ctrl+shift+d",
    },
  },
  {
    id: "toggle_window",
    name: "Toggle Window",
    description: "Show/Hide the main window",
    defaultKey: {
      macos: "cmd+backslash",
      windows: "ctrl+backslash",
      linux: "ctrl+backslash",
    },
  },
  {
    id: "focus_input",
    name: "Refocus Input Box",
    description: "Bring Freely forward and place the cursor in the input area",
    defaultKey: {
      macos: "cmd+shift+i",
      windows: "ctrl+shift+i",
      linux: "ctrl+shift+i",
    },
  },
  {
    id: "move_window",
    name: "Move Window",
    description: "Move overlay with arrow keys (hold to move continuously)",
    defaultKey: {
      macos: "cmd",
      windows: "ctrl",
      linux: "ctrl",
    },
  },
  {
    id: "system_audio",
    name: "System Audio",
    description: "Toggle system audio capture",
    defaultKey: {
      macos: "cmd+shift+m",
      windows: "ctrl+shift+m",
      linux: "ctrl+shift+m",
    },
  },
  {
    id: "coffee_chat_mode",
    name: "Coffee Chat",
    description:
      "Switch to coffee chat mode and start listening; press again to stop",
    defaultKey: {
      macos: "ctrl+k",
      windows: "ctrl+alt+k",
      linux: "ctrl+alt+k",
    },
  },
  {
    id: "interview_mode",
    name: "Interview",
    description:
      "Switch to interview mode and start listening; press again to stop",
    defaultKey: {
      macos: "ctrl+i",
      windows: "ctrl+alt+i",
      linux: "ctrl+alt+i",
    },
  },
  {
    id: "generate_now",
    name: "Generate Now",
    description:
      "While listening, respond now with Sonnet (no tools, fastest) instead of waiting for a pause",
    defaultKey: {
      macos: "ctrl+g",
      windows: "ctrl+alt+g",
      linux: "ctrl+alt+g",
    },
  },
  {
    id: "generate_haiku",
    name: "Generate with Haiku",
    description:
      "While listening, respond now with Haiku (faster model, can use tools and web search)",
    defaultKey: {
      macos: "ctrl+h",
      windows: "ctrl+alt+h",
      linux: "ctrl+alt+h",
    },
  },
  {
    id: "generate_search",
    name: "Generate with Search",
    description:
      "While listening, search the web first, then respond with Sonnet",
    defaultKey: {
      macos: "ctrl+s",
      windows: "ctrl+alt+s",
      linux: "ctrl+alt+s",
    },
  },
  {
    id: "toggle_thinking",
    name: "Toggle Thinking",
    description: "Switch Claude's thinking effort between low and high",
    defaultKey: {
      macos: "ctrl+t",
      windows: "ctrl+alt+t",
      linux: "ctrl+alt+t",
    },
  },
  {
    id: "deep_dive",
    name: "Deep Dive",
    description:
      "While listening: search and pull up much more on the current topic, in a second panel",
    defaultKey: {
      macos: "ctrl+m",
      windows: "ctrl+alt+m",
      linux: "ctrl+alt+m",
    },
  },
  {
    id: "copilot_catch_up",
    name: "Catch Me Up",
    description: "While listening: what you missed in the last few minutes",
    defaultKey: {
      macos: "ctrl+1",
      windows: "ctrl+alt+1",
      linux: "ctrl+alt+1",
    },
  },
  {
    id: "copilot_define",
    name: "Define Term",
    description:
      "While listening: explain the latest unfamiliar term, acronym or name",
    defaultKey: {
      macos: "ctrl+2",
      windows: "ctrl+alt+2",
      linux: "ctrl+alt+2",
    },
  },
  {
    id: "copilot_clarify",
    name: "What They're Asking",
    description:
      "While listening: what the other person is really asking and what a strong answer covers",
    defaultKey: {
      macos: "ctrl+3",
      windows: "ctrl+alt+3",
      linux: "ctrl+alt+3",
    },
  },
  {
    id: "copilot_say_next",
    name: "Say Something Smart",
    description:
      "While listening: one specific point or question to say right now",
    defaultKey: {
      macos: "ctrl+4",
      windows: "ctrl+alt+4",
      linux: "ctrl+alt+4",
    },
  },
  {
    id: "audio_recording",
    name: "Voice Input",
    description: "Start voice recording",
    defaultKey: {
      macos: "cmd+shift+a",
      windows: "ctrl+shift+a",
      linux: "ctrl+shift+a",
    },
  },
  {
    id: "screenshot",
    name: "Screenshot",
    description: "Capture screenshot",
    defaultKey: {
      macos: "cmd+shift+s",
      windows: "ctrl+shift+s",
      linux: "ctrl+shift+s",
    },
  },
];
