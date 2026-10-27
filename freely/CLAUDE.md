# Freely — Rohan's live coffee-chat / interview copilot

This file documents everything changed in this fork during the session of
2026-10-26 → 2026-10-27, why each change was made, and what the user (Rohan)
wants from this tool. Read it before touching anything. Upstream is
`lambdaflows/freely` (itself a fork of Pluely); our fork is
`github.com/RohanJoshi28/freely`, branch `main`. The app lives in this
`freely/` subfolder of the repo.

---

## 1. What Rohan wants (the product spec, in his words and ours)

The tool is used **during** a live coffee chat (networking / informational
interview / mentor chat) or a live job interview, over a video call. It must
be hands-free. Every design decision below follows from these points, most of
which Rohan stated explicitly:

1. **Two buttons / modes**: one for coffee chats that "comes up with a set of
   insightful questions", one for interviews that "either answers the question
   if it is objective while showing work, while for behaviorals it gives the
   structure for how a question should be answered with a couple cool ideas."
2. **It must work from audio alone.** "The coffee chat stuff would work even
   without any information. It should be able to solely take the audio. Any
   information provided otherwise is optional." Prep notes may be entered
   *before* the conversation, never requested during it.
3. **Never ask the user for anything mid-conversation.** "Please don't ask me
   for information while I'm actually in a coffee chat." The prompts therefore
   forbid clarifying questions and always produce a best-effort output.
4. **Zero taps.** "I don't want to have to tap anything." Everything is driven
   by global keyboard shortcuts: one key both selects the mode and starts
   listening.
5. **Force a response on demand.** "What to press to force a generation at that
   moment" → Ctrl+G.
6. **Hear the user's own voice too.** "Why doesn't it record my audio, just
   the system audio??" → microphone capture added, as context only.
7. **Stop recompiling for every change.** "Can you make this a local
   application so we don't have to keep recompiling it" → the dev-shell build.
8. **Stop the macOS permission prompt** that appeared on every build → stable
   code-signing identity.
9. Providers he chose: **Groq Whisper `whisper-large-v3-turbo`** for
   speech-to-text (cheap, fast, accurate) and **Claude Code on Sonnet** for the
   AI ("connect to claude code sonnet"), using his existing `claude` CLI login
   rather than an API key. He is aware Claude Code adds ~9 s per response
   (process spawn) and that an Anthropic API key would be faster.

Things we learned about his environment that constrain the work:

- macOS 15.2 (Darwin 24.2), Apple Silicon. Only Command Line Tools are
  installed, **no full Xcode**, and the disk is nearly full (hovered between
  170 MB and 2.7 GB free all session). This is why the app cannot be compiled
  locally (see §6).
- Node 25, npm 11, Rust 1.98 (Homebrew), `cmake` installed by us via Homebrew.
- `gh` is authenticated as `RohanJoshi28`.

---

## 2. Commits made this session (oldest first)

| Commit | Summary |
|---|---|
| `7c636fe` | Add coffee chat and interview modes |
| `6760f15` | Allow manually triggering the macOS build (`workflow_dispatch`) |
| `50ce141` | Fix pre-existing test type errors that broke `npm run build` |
| `a8557ad` | Add Ctrl+K / Ctrl+I shortcuts for coffee chat and interview |
| `e4d433e` | Pass the system prompt through to Claude Code (bug fix) |
| `c8797dd` | Add Ctrl+G "generate now" shortcut (frontend + Rust) |
| `aee60fb` | Add a dev-shell build variant that loads the UI from Vite |
| `742909a` | Add `scripts/install-build.sh` (download, sign with stable identity, launch) |
| `0ed749f` | `install-build.sh`: extract the dev-shell app from its DMG |
| `1aab27a` | Listen to the microphone during system audio capture |

33 files changed, +923 / −228 lines versus upstream `e95ec83`. Lockfiles
(`package-lock.json`, `Cargo.lock`) were deliberately **not** committed; the
local install/build touched them but the changes were noise.

---

## 3. The two modes (coffee chat / interview)

### 3.1 Where things live

- **Prompts and mode definitions:** `src/config/assistant-modes.constants.ts`
  - `AssistantMode = "none" | "coffee-chat" | "interview"`
  - `ASSISTANT_MODES[]` with `id`, `label`, `placeholder` (overlay input hint),
    `notesPlaceholder` (prep-notes example text), `prompt`.
  - `LIVE_RULES` — shared preamble injected into both mode prompts.
  - `COFFEE_CHAT_PROMPT`, `INTERVIEW_PROMPT`.
  - `getAssistantModeOption(mode)`.
- **Persistence:** `src/lib/storage/assistant-mode.storage.ts`
  - `getAssistantMode()` / `setAssistantModeStorage()` → localStorage key
    `assistant_mode`.
  - `getAssistantModeNotes()` / `setAssistantModeNote(mode, text)` → key
    `assistant_mode_notes` (JSON object keyed by mode id).
  - `getMicEnabled()` / `setMicEnabled()` → key `assistant_mic_enabled`
    (string "true"/"false", default on).
  - Keys are declared in `src/config/constants.ts` → `STORAGE_KEYS`.
- **App-wide state:** `src/contexts/app.context.tsx` holds `assistantMode` and
  `setAssistantMode` (memoized with `useCallback`, persists to storage). Typed
  in `src/types/context.type.ts`.
- **Prompt injection:** `src/lib/functions/ai-response.function.ts` →
  `buildEnhancedSystemPrompt()`. This is the single choke point every AI call
  goes through (typed input, screenshots, system audio, quick actions), which
  is why the mode is applied here and nowhere else.
- **UI:**
  - `src/pages/app/components/completion/ModeButtons.tsx` — the ☕ / 💼 toggle
    buttons (`CoffeeIcon`, `BriefcaseIcon`), `variant="default"` when active,
    `outline` otherwise. Clicking the active one sets mode to `"none"`.
  - Rendered in two places in `src/pages/app/index.tsx` /
    `completion/index.tsx`: in the normal bar, and **also while system audio is
    capturing** (the normal bar is hidden during capture), so the mode can be
    switched mid-call.
  - `completion/Input.tsx` — input placeholder becomes the mode's
    `placeholder`; response-panel title shows ` · Coffee chat` / ` · Interview`.
  - Dashboard page `src/pages/modes/index.tsx` at route `/modes`, menu entry
    "Coffee chat & interview" (`src/hooks/useMenuItems.tsx`, `src/routes/index.tsx`,
    `src/pages/index.ts`). Contains the mic toggle and one prep-notes textarea
    per mode (auto-saves on change).
- **Window width:** overlay widened from 600 → 680 px to fit the two extra
  buttons, in `src-tauri/tauri.conf.json` and the fixed width in
  `src-tauri/src/window.rs` (`set_window_height` uses `LogicalSize::new(680.0, …)`).

### 3.2 How the prompt is assembled (`buildEnhancedSystemPrompt`)

Order of precedence, by design:

1. If a mode is active, the **mode prompt goes first** and defines the output
   format.
2. Then, if prep notes exist for that mode:
   `"Prep notes from the user:\n<notes>"`.
3. Then, if the user has a custom system prompt that is not the default
   (`DEFAULT_SYSTEM_PROMPT`), it is appended as
   *"Background context and preferences from the user (use it, but the format
   above takes precedence)"*. Rationale: people paste their resume into the
   system prompt; we want that as context without letting it override the
   mode's format.
4. The **response-length setting (short/medium/auto) is skipped while a mode
   is active**, because "short" would truncate the worked steps of an
   objective answer. Language setting and markdown instructions still apply.
5. With no mode, behavior is exactly upstream's.

### 3.3 `LIVE_RULES` (shared preamble) — intent of each rule

- The user is live and only glances at output between sentences; they cannot
  type or answer questions.
- Input is usually a speech-to-text transcript of the *other* person; expect
  errors, filler, cut-off sentences; infer meaning.
- Earlier messages are earlier parts of the same conversation; use them to
  track who the person is and what was covered.
- **NEVER ask the user for information or clarification; never say more
  details are needed.** Always produce the best output from what exists.
- Lines starting with `[You said]:` are the user's own words from the mic;
  never respond to or evaluate them; use only as context.
- Prep notes are optional; use if present, never depend on them.
- No preamble, no sign-off; skimmable.
- (Not yet added, see §9) a rule for "[Copilot action]" requests.

### 3.4 Coffee-chat prompt — behavior

Output is always exactly **"Ask next"** with three numbered questions, best
first, each one sentence sayable verbatim. At least two must build on a
specific detail the person just said (so the user "sounds like they were
really listening"); one may open a new valuable thread (decisions/trade-offs,
surprises, how their field is changing, advice tied to the user's goals). Must
not repeat anything already asked or answered, including the user's own
`[You said]` questions. Generic questions ("typical day?", "any advice?") are
banned. If the transcript is small talk or fragmentary, still give three strong
questions that fit the conversation so far; with nothing known yet, give three
story-drawing openers.

Earlier draft (first commit) had a two-branch design (A: profile given → 8–10
grouped questions + "open with"; B: live transcript → follow-ups + pivot).
Rohan rejected the profile-first framing ("would work even without any
information"), so it became the always-live three-question format.

### 3.5 Interview prompt — behavior

1. Respond to the most recent question; use earlier messages for follow-ups
   and multi-part questions.
2. Ambiguous question → pick the most likely interpretation, state it in a few
   words, answer it (never ask).
3. No question in the latest transcript (small talk, interviewer describing
   the role, the user's own answer) → respond only with **Note** and 1–2 short
   bullets worth remembering.
4. Silently classify as OBJECTIVE (coding, algorithms, system design, math,
   probability, estimation/market sizing, case, brain teasers, factual) or
   BEHAVIORAL ("tell me about a time", why us, strengths/weaknesses, conflict,
   failure, leadership, situational). Never print the label.
5. OBJECTIVE → **Answer** (1–2 lines, first) / **Work** (numbered steps; code
   in a fenced block with time & space complexity; estimation shows each
   assumption and the arithmetic; system design: requirements, components,
   data flow, trade-offs; math: derivation steps) / **Say it out loud** (2–3
   sentences on how to walk the interviewer through it).
6. BEHAVIORAL → no scripted answer. **What they're really testing** (one line)
   / **Structure** (framework chosen per question: STAR; company→role→you;
   real weakness→impact→what changed→result; etc., one line each with a rough
   time split for ~2 min) / **Ideas** (2–3 distinctive story angles, drawing on
   prep notes if present) / **Strong close** (one example closing line).

The Markdown renderer (`src/components/Markdown`, Streamdown) supports mermaid
fenced blocks, so system-design answers may include diagrams; the upstream
`MARKDOWN_FORMATTING_INSTRUCTIONS` already asks for ```mermaid.

---

## 4. Global shortcuts

### 4.1 Bindings (defaults in `src/config/shortcuts.ts`, `DEFAULT_SHORTCUT_ACTIONS`)

| Action id | macOS | Windows/Linux | Behavior |
|---|---|---|---|
| `coffee_chat_mode` | **Ctrl+K** | Ctrl+Alt+K | Set mode = coffee-chat and start system-audio capture. Press again while capturing in that mode → stop capture and set mode = none. Press the *other* mode's key while capturing → switch mode without stopping. |
| `interview_mode` | **Ctrl+I** | Ctrl+Alt+I | Same, for interview. |
| `generate_now` | **Ctrl+G** | Ctrl+Alt+G | While capturing: respond immediately (see §4.3). No-op if not capturing or a response is already generating. |

Why these keys: Rohan asked for Ctrl+I and Ctrl+C. Ctrl+C was rejected because
global shortcuts steal the key from every app, and Ctrl+C is SIGINT in
Terminal and the interrupt key in Claude Code; he chose **Ctrl+K** instead
(Ctrl+Shift+C was offered as the recommended alternative). Ctrl+G was his pick
for "generate now" (note: Ctrl+G is "open external editor" in Claude Code and
will be captured by Freely while it runs). All are rebindable in Dashboard →
Cursor & Shortcuts; the shortcuts page lists `DEFAULT_SHORTCUT_ACTIONS`
automatically, so no UI work was needed.

### 4.2 How the plumbing works (no Rust change needed for new shortcuts)

`src-tauri/src/shortcuts.rs::handle_shortcut_action` matches known ids
(`toggle_window`, `system_audio`, …) and, for any **unknown id**, emits a
`custom-shortcut-triggered` event with `{ action }` to the main window.
`src/hooks/useGlobalShortcuts.ts` listens and dispatches to callbacks
registered via `registerCustomShortcutCallback(actionId, cb)`. So adding a
shortcut = add an entry to `DEFAULT_SHORTCUT_ACTIONS` + register a callback.
Shortcut config is synced to Rust on startup via `update_shortcuts` with
`getShortcutsConfig()` (which merges stored bindings over defaults, so new
defaults appear for existing users).

The mode/generate callbacks are registered in `src/hooks/useSystemAudio.ts`
(effects near the end of the hook) because that hook owns `startCapture`,
`stopCapture`, `capturing`, and the conversation.

### 4.3 Ctrl+G "generate now" — the one Rust change for features

Problem: system-audio capture only fires `speech-detected` after the VAD sees
`silence_chunks` of silence; there was no way to force a response mid-sentence.

- **Rust** (`src-tauri/src/speaker/commands.rs`): a `static FORCE_FLUSH:
  AtomicBool`, a `#[tauri::command] force_flush_speech()` that sets it
  (registered in `src-tauri/src/lib.rs`), and a check at the top of each VAD
  hop in `run_vad_capture`: if set, and currently in speech with a non-empty
  buffer → normalize, encode WAV, emit `speech-detected` immediately and reset
  the speech state; otherwise emit `speech-flush-empty`. The flag is reset on
  `start_system_audio_capture`.
- **Frontend** (`useSystemAudio.ts`): on `generate_now`:
  - VAD mode (default) → `invoke("force_flush_speech")`.
  - Continuous-recording mode and recording → `manualStopAndSend()`.
  - Continuous mode but idle → run a quick action with `GENERATE_NOW_MESSAGE`.
  - On `speech-flush-empty` → run a quick action with `GENERATE_NOW_MESSAGE`
    (*"(No new audio. The user asked for a response right now: respond to the
    most recent question or topic in the conversation so far.)"*). In coffee
    chat this yields fresh follow-ups; in interview it re-answers the latest
    question.
  - `quickActionRef` holds the latest `handleQuickActionClick` to avoid stale
    closures in listeners.

---

## 5. Microphone as context (`1aab27a`)

Why: system audio hears only what comes out of the speakers (the other
person); Rohan wanted his own words heard too, so the copilot knows what he
already asked/answered. Decided with him: **mic is context only** — the user's
speech never triggers a generation (you don't want the copilot answering your
own answer, or suggesting questions in response to your question).

- `src/pages/app/components/speech/MicListener.tsx` — renders nothing; mounts
  `useMicVAD` from `@ricky0123/vad-react` (same library the upstream
  voice-input feature uses, so no new dependency and `NSMicrophoneUsageDescription`
  already exists in `src-tauri/info.plist`). `userSpeakingThreshold: 0.6`,
  `startOnLoad: true`, honors `selectedAudioDevices.input.id`. On speech end:
  `floatArrayToWav(audio, 16000)` → `fetchSTT({ source: "mic" })` with the
  selected STT provider → `onUserSpeech(text, startedAt)`.
- Mounted in `speech/index.tsx` as
  `{capturing && getMicEnabled() && <MicListener onUserSpeech={addUserUtterance} />}`,
  so it starts/stops with system-audio capture. (The component tree there is
  wrapped in a fragment for this.)
- `useSystemAudio.addUserUtterance(text, startedAt)`:
  - **Bleed filter:** without headphones the mic also hears the other person
    through the speakers. We track the system-audio VAD via a new listener on
    the Rust `speech-start` event (`systemSpeechActiveRef`,
    `lastSystemSpeechStartRef`); `speech-detected` and `speech-discarded`
    clear the active flag. A mic segment is **dropped** if system speech is
    active when it ends, or if a system `speech-start` happened after the mic
    segment started. Otherwise it is prepended to `conversation.messages` as
    `{ role: "user", audioSource: "mic", speakerLabel: "user" }`.
  - These fields already existed in `src/types/completion.ts`
    (`AudioSource`, `SpeakerLabel`) from upstream PR #79 but were unused.
- `toHistory(messages)` (module-level in `useSystemAudio.ts`) converts
  conversation messages to AI history and prefixes mic lines with
  `[You said]: `. Both places that build history (the `speech-detected`
  handler and `handleQuickActionClick`) use it. Other-person lines stay
  unprefixed so existing prompt behavior is unchanged.
- Toggle "Also listen to my microphone" on the `/modes` page, default on.
- Not yet verified by ear (we cannot play audio in the session); thresholds may
  need tuning. First use prompts macOS for microphone access once.

---

## 6. Build, run, and dev loop — why it is the way it is

### 6.1 Local compilation is impossible on this Mac (don't retry blindly)

`npm run tauri dev` fails at the `cidre` crate (macOS ScreenCaptureKit
bindings used for system-audio capture): its build script runs `xcodebuild`,
which requires **full Xcode**, not Command Line Tools. Xcode needs ~35–40 GB
free to install; the disk has a few GB at best. We also hit `cmake not found`
first (fixed with `brew install cmake`; CMake 4 needs
`CMAKE_POLICY_VERSION_MINIMUM=3.5` for whisper-rs-sys). The 2.8 GB partial
`src-tauri/target` was deleted to reclaim space.

What *does* work locally: `npm install`, `npx tsc --noEmit -p .`,
`npx vitest run` (204 tests pass, 4 skipped), `npm run build` (frontend),
`npx vite` (dev server on port 1420).

### 6.2 Builds run on GitHub Actions (fork `RohanJoshi28/freely`)

- `.github/workflows/build.yml` builds `aarch64-apple-darwin` on
  `macos-latest`. We added `workflow_dispatch` with input
  `variant: release | devshell`. **Pushing does not trigger builds on the
  fork**; always dispatch manually:
  `gh workflow run build.yml -R RohanJoshi28/freely --ref main [-f variant=devshell]`
  then `gh run list -R RohanJoshi28/freely --workflow build.yml --limit 1`.
  A build takes ~15–20 min; the first fails fast (~1 min) if `tsc` fails,
  because `beforeBuildCommand` is `npm run build` = `tsc && vite build` and
  **tsc type-checks test files too** (that is what `50ce141` fixed: six
  pre-existing errors in `__tests__` files; the fixes did not change what the
  tests assert).
- The `publish` workflow is **disabled** on the fork (it needs the upstream
  author's signing/API secrets and would create empty draft releases).
- Artifact names: `freely-macos-aarch64` (release) and
  `freely-macos-aarch64-devshell`.

### 6.3 Installing a build — `scripts/install-build.sh [run-id] [release|devshell]`

Downloads the artifact to `~/coffee/build` (release) or `~/coffee/build-dev`
(devshell), quits the running copy, extracts `Freely.app` from
`Freely.app.tar.gz` (release) or from the DMG (dev shell has
`createUpdaterArtifacts: false`, so no tarball), signs, verifies, launches.
Installed apps: `~/coffee/build/macos/Freely.app` and
`~/coffee/build-dev/macos/Freely Dev.app`.

### 6.4 Code signing — the fix for the repeated audio-permission prompt

Each GitHub build is only ad-hoc signed, and macOS (TCC) keys the
"record system audio" permission to the app's **designated requirement**,
which for ad-hoc signatures is the per-build `cdhash`. So every new build
re-prompted. Fix: a self-signed code-signing certificate **"Freely Local
Signing"** in the login keychain (created with openssl, imported with
`security import -T /usr/bin/codesign`, trusted with
`security add-trusted-cert -r trustRoot -p codeSign`). Signing with it makes
the requirement `identifier "com.freely.app" and certificate leaf = H"db30e8e9…"`,
stable across builds, so the permission is granted once and remembered.
**Never ad-hoc sign (`--sign -`) again.** `Freely Dev.app` keeps the same bundle
identifier, so it shares the grant.

### 6.5 The dev shell ("local application without recompiling")

`src-tauri/tauri.devshell.conf.json` is merged with
`tauri build --config …` and sets `productName: "Freely Dev"` and
`build.frontendDist: "http://localhost:1420"`. Tauri accepts a URL there, so
the compiled app loads its entire UI from the Vite dev server. Result: any
change under `src/` hot-reloads into the running app in ~1 s; **only
`src-tauri/` changes need a GitHub build**. `scripts/dev-shell.sh` starts
Vite if needed and opens the app. Verified working: the app created a
separate `http://localhost:1420` localStorage origin and HMR updates were
observed in the Vite log.

Caveats:
- Run **only one** of `Freely.app` / `Freely Dev.app` at a time; both register
  the same global shortcuts and the second registration fails.
- The dev shell has its **own settings store** (different web origin, see
  §7.2). We copied the settings over once; new settings changed in one app do
  not propagate to the other.
- The dev shell needs the dev server running; the release app does not.

---

## 7. Providers and settings

### 7.1 What is configured

- **STT:** provider `groq`, variables `{ api_key: <Rohan's Groq key>,
  model: "whisper-large-v3-turbo" }`. Verified by a real transcription
  (0.27 s round trip, exact text). Groq free tier: 20 requests/min,
  2,000/day; paid $0.04/hr with a 10 s minimum per clip. The key was pasted
  into chat by Rohan; it is stored only in the app's localStorage, never in
  the repo. **Do not commit it.**
- **AI:** provider `claude-code`, variables `{ model: "sonnet" }`. Uses the
  `claude` CLI at `/opt/homebrew/bin/claude` (2.1.285) and its existing login;
  Freely's `resolve_binary` checks Homebrew paths because GUI apps don't
  inherit the shell PATH. Verified end-to-end from the shell with the interview
  prompt: Sonnet 5.5 answered in the specified format in ~9 s.
- **Bug fixed (`e4d433e`):** the Claude Code path dropped the system prompt.
  `freely-claude-tool.ts::executePromptWithStreaming` gained a `systemPrompt`
  parameter that is put on the `run_claude` payload; `orchestrator.ts` passes
  `params.systemPrompt`. The Rust side already prepended `system_prompt` to
  the prompt when present. Without this fix the modes were silently ignored
  whenever Claude Code was the provider.

### 7.2 Where settings physically live (for scripted changes)

WebKit localStorage, one SQLite file per web origin:
`~/Library/WebKit/com.freely.app/WebsiteData/Default/<hash>/<hash>/LocalStorage/localstorage.sqlite3`,
table `ItemTable(key TEXT, value BLOB)`, values **UTF-16LE**. The release app's
origin is `tauri://localhost` (hash dir `Kgryt29…`), the dev shell's is
`http://localhost:1420` (hash dir `JQhvzT…`). Keys of interest:
`curl_selected_ai_provider`, `curl_selected_stt_provider`, `assistant_mode`,
`assistant_mode_notes`, `assistant_mic_enabled`, `shortcuts`. **Quit the app
before editing** and delete the `-wal`/`-shm` files if you replace the DB.
Conversations are in SQLite at
`~/Library/Application Support/com.freely.app/freely.db` (shared by both apps).

---

## 8. How to verify changes

- Frontend: `npx tsc --noEmit -p .` must print no `error TS` lines;
  `npx vitest run` must pass (204/208, 4 skipped); `npm run build` must
  succeed (this is what CI runs). Then watch it hot-reload in `Freely Dev`.
- Rust: cannot be compiled here. `rustfmt --edition 2021 --check <file>`
  at least parses it. The real check is the GitHub build; dispatch it and
  monitor the run.
- Nobody in the session could hear audio or press keys, so **shortcut and
  audio behavior was verified by reading code and by shell-level tests of the
  providers, not in the running app**. Treat those paths as "should work,
  untested by ear" until Rohan confirms.

---

## 9. Backlog — ideas discussed (items 1, 2, 3, 5 built in session 2, see §11)

Rohan asked for the most useful live-interview / coffee-chat capabilities to be
added to Freely. Agreed direction (all frontend-only unless noted):

1. **Turn judge** before the slow model: a fast Groq LLM (e.g.
   `openai/gpt-oss-20b` — note: Groq's `response_format: json_object` failed
   with it; parse leniently instead) classifies each transcript as
   `respond | skip | incomplete`. Skip small talk (saves a ~9 s Claude Code
   call); buffer incomplete fragments and merge them with the next chunk so a
   mid-question pause doesn't produce an answer to half a question; dedupe
   already-answered turns. Key reuse: the Groq STT key.
2. **Mode-aware hotkey actions**: Ctrl+1 "what are they really asking /
   clarify", Ctrl+2 "recap so far". Needs a `[Copilot action]` rule in
   `LIVE_RULES` so the action's format overrides the mode format.
3. **Wrap-up on stop**: when the mode key stops capture and there are ≥2
   messages, auto-generate notes (coffee chat: who they are, what you learned,
   advice, promises; plus a short follow-up email draft referencing two
   specifics; interview: questions asked, how to improve, topics to prep,
   thank-you note). Popover already auto-opens on `isAIProcessing`/`lastAIResponse`.
4. Lower-latency transcription (streaming STT) — would need Rust changes to
   stream PCM frames; Groq has no streaming endpoint.
5. Exposing the existing local Whisper engine (`src-tauri/src/speaker/local_whisper.rs`,
   `stt.function.ts` already special-cases provider id `local-whisper`) in the
   STT provider list — lower accuracy than Groq turbo, so low priority.

---

## 11. Session 2 (2026-10-27): Natively features, live captions, turn judge

Rohan asked to "incorporate all the features from the other directory
(natively)" that help in interviews/coffee chats, including **live
transcription with a local Whisper model**, refined "every so often" by Groq
like Freely already does (he believes Groq's free tier can't do live STT).
Natively (`~/coffee/natively`, Electron, personal-use fork) was used as a
reference; its ideas were rewritten for Freely rather than copied.

### 11.1 Hard rule from Rohan: all generation goes through Claude Code

"u shouldn't use gpt oss 120b or qwen for any of the actual generation, use
the claude code terminal". Every text the user reads (answers, helpers,
wrap-up) comes from the selected AI provider (Claude Code / Sonnet). Groq is
used only for STT and for the hidden one-word turn judge.

### 11.2 Live captions (local Whisper → Groq refine)

- **Rust** `src-tauri/src/speaker/local_whisper.rs`: models `tiny.en` /
  `base.en` (default) / `small.en` from huggingface `ggerganov/whisper.cpp`,
  stored in `~/Library/Application Support/com.freely.app/whisper-models/`.
  Commands: `get_local_whisper_model`, `download_local_whisper_model`
  (emits `whisper-model-download-progress`), `load_local_whisper_model`,
  `set_live_transcription`, plus the old `init_local_whisper` /
  `transcribe_local` (now off the async runtime via `spawn_blocking`, and
  resamples any WAV to 16 kHz). `resample_to_16k`, `transcribe_blocking`.
  `ENGINE_READY` / `LIVE_TRANSCRIPTION` atomics so the audio loop never waits
  on the engine mutex.
- **Cargo**: `whisper-rs` now uses the `metal` feature on macOS (GPU). The
  old `coreml` feature needed `.mlmodelc` files we never had.
- **Capture loop** (`commands.rs::run_vad_capture`): `speech-start` now
  carries a `segment_id` (u64, `SEGMENT_ID` counter). While someone speaks,
  every ~0.7 s of new audio `spawn_partial_transcription` transcribes the
  segment so far (last ≤28 s) on a blocking thread and emits
  `transcript-partial {segment_id, text}`; at most one runs at a time
  (`PARTIAL_IN_FLIGHT`). `speech-detected` is unchanged: the finished segment
  still goes to Groq, and that refined text replaces the partial.
- **Frontend**: `src/lib/functions/local-whisper.function.ts`
  (`prepareLiveTranscription` loads the model at capture start, never
  downloads; `cleanLocalTranscript` drops Whisper's "Thank you." / `[BLANK]`
  hallucinations). If Groq STT fails (e.g. 429), the segment is transcribed
  locally instead of being lost. **The mic now uses local Whisper** when
  loaded (it's context only), which halves Groq STT usage.
- UI: `speech/LiveTranscript.tsx` (Them/You lines, live = italic, spinner
  while refining, "waiting for the rest" / "no response needed" notes).
  Settings on the `/modes` page: toggle, model picker, Download button.

### 11.3 Turn judge (backlog item 1, done)

`src/lib/functions/turn-judge.function.ts`, called from
`useSystemAudio.handleTheirTurn` for each finished "them" transcript:
`respond` → Claude; `wait` → hold the fragment, merge with the next segment
(answered anyway after 4 s of silence, `WAIT_FALLBACK_MS`); `skip` → stored
as context only. Ctrl+G bypasses it (`forceRespondRef`). Toggle on `/modes`.

1. `localTurnVerdict`: acknowledgements / <4 words without a question → skip;
   dangling last word, trailing comma/ellipsis, "so my question is" → wait.
2. Groq `qwen/qwen3.8-27b` (`reasoning_effort: none`), key = Groq STT key.
3. Mistral `ministral-14b-latest`, 4. Groq `openai/gpt-oss-20b`,
5. Gemini `gemini-3.5-flash-lite` (last backup, slow). Keys 3 and 5 are in
   localStorage `turn_judge_keys` (`{mistral, gemini}`), entered on `/modes`.
6. Nothing answered within 4 s total → respond (pre-judge behavior).
429s put a provider on cooldown until its reset header.

Benchmarks run with Rohan's keys on 24 live-style cases (2026-10-27):
Groq Qwen 22/24 at 0.26 s median (24/24, 0.17 s with the final prompt and
local rules); Ministral 14B 20/24 at 0.54 s (22/24 final); gpt-oss-20b 19/24
(it answers half-finished questions); Gemini 3.5 Flash-Lite 22/24 but 2 s
median / 10 s p90; Gemini 3.1 Flash-Lite 503s; Gemini 3.8 Flash 5 RPM;
xKiro Qwen 3.8 Max 23/24 but 4.4 s median (rejected: too slow); OpenRouter
free tier is 50 requests/day for the whole account (rejected). Groq free
quotas: 1,000 requests/day per LLM, 8K tokens/min; Whisper 2,000/day.
Rohan cannot use Groq's paid tier (disabled), free tier only.

### 11.4 Hotkey helpers (backlog item 2, done; from Natively's live helpers)

`COPILOT_ACTIONS` in `assistant-modes.constants.ts`, shortcuts in
`shortcuts.ts`: **Ctrl+1** catch me up, **Ctrl+2** define the latest term,
**Ctrl+3** what they're really asking, **Ctrl+4** one thing to say now
(Windows/Linux: Ctrl+Alt+N). Sent to Claude as `[Copilot action] …` with the
full conversation, plus any held fragment and the live partial; `LIVE_RULES`
has a rule that a `[Copilot action]` overrides the mode format. Output shows
in `HelperCard` (separate abort controller, never stored, not replaced by
auto answers).

### 11.5 Wrap-up on stop (backlog item 3, done)

`stopCapture(endedMode?)`: when a mode was active, wrap-up is enabled and the
other person spoke ≥2 times, `runWrapUp` asks Claude for notes + a thank-you
email (`wrapUpMessage(mode)`), shows `WrapUpPanel` in the popover after
listening stops, and saves it to the conversation as an assistant message.

### 11.6 Bugs fixed along the way

- **Claude Code saw only the latest transcript.** System audio never passes
  a conversation id, so each call was a fresh `claude` session with no
  history (no `--resume`, and history was skipped for claude-code). Now
  `ai-response.function.ts` sends history when there is no conversation id,
  and `orchestrator.executeClaudeCode` injects it (`buildPromptWithHistory`,
  capped at 60k chars instead of 20 messages). This is what makes "don't
  repeat questions", follow-ups, `[You said]` context and the judge's skipped
  turns actually reach Claude.
- History was sent newest-first (messages are stored newest-first);
  `toHistory` now sorts by timestamp.
- `processWithAI` never passed its abort signal, so superseded/stopped
  responses kept running; now it does (the orchestrator kills the process).
- Transcripts were only stored when a response finished; a superseded turn
  vanished from context. Now the transcript is stored when the call starts.
- `useSystemAudio` listeners now go through refs (no stale closures; they
  register once).

### 11.8 Model / tools / thinking per key (Rohan's spec, same session)

"Ctrl+G should be generate using sonnet. Control H should be generate using
haiku (faster). ctrl+s should use google search first before answering using
sonnet", "It should give Claude the full toolset for search and for Haiku but
for Ctrl+G it should limit to no search. Also thinking should be low", "control
t should change thinking to high and pressing it again should change it back
to low".

- `GENERATION_PROFILES` (`assistant-modes.constants.ts`): `sonnet` (Ctrl+G and
  every automatic answer, helper and wrap-up: `--tools ""`), `haiku` (Ctrl+H:
  `--model haiku --tools default`), `search` (Ctrl+S: selected model,
  `--tools default`, plus an instruction to search 1–3 times first and cite
  sources). Both tool profiles pre-approve WebSearch, WebFetch, Read, Grep,
  Glob via `--allowedTools`; other tools exist but are unapproved, so a `-p`
  run can't edit files or run commands.
- Rust `run_claude` gained `effort`, `tools`, `allowedTools` payload fields
  (`--effort`, `--tools`, `--allowedTools`), threaded through
  `freely-claude-tool.ts` (`ClaudeCliOptions`), `orchestrator.ts`
  (`claudeOptions`) and `fetchAIResponse({ agentOptions })`.
- **Thinking effort was xhigh before**: Freely passed no `--effort`, so the CLI
  used Rohan's global `~/.claude/settings.json` (`effortLevel: "xhigh"`). Now
  every Claude Code call passes `--effort` from `thinking_level` (localStorage,
  default `low`); Ctrl+T (`toggle_thinking`) flips low/high; the overlay shows
  it, and the response header shows e.g. "Haiku · low thinking".
- Pressing a generate key while a *different* profile is answering replaces
  it; the same profile is a no-op.
- "Google search": Claude Code's WebSearch is Anthropic's search, not Google.
- Measured (claude 2.1.285, 3 runs, interview question): Sonnet no-tools
  medium/low ≈ 0.8–3 s to first text, 4–7 s total; Freely's old call
  (inherits xhigh + full tools) 2.1 s / 5.9 s; Haiku ≈ 1.1–1.3 s / 6 s.
  Ctrl+S with the full toolset ≈ 25 s (an extra ToolSearch round-trip loads the
  deferred WebSearch tool); with only WebSearch/WebFetch ≈ 17–18 s.



Same caveat as §8: nobody could play audio here. The judge was verified
end-to-end against the live APIs (throwaway vitest with real keys); the
Whisper/Metal path is verified only by the GitHub build compiling it.

## 10. Conventions for future changes

- Keep everything hands-free and shortcut-driven; do not add prompts that ask
  the user questions; do not make the user's own speech trigger generations.
- Put new prompt text in `assistant-modes.constants.ts`; put new persisted
  settings in `assistant-mode.storage.ts` + `STORAGE_KEYS`.
- Prefer frontend implementations (hot-reload in the dev shell). A Rust change
  costs a 20-minute GitHub build and a reinstall of both apps.
- Commit with `-c user.email=rjoshi0628@gmail.com -c user.name="Rohan Joshi"`
  and end messages with the Claude co-author line used in this fork's history.
- Match upstream style: 2-space TS, Prettier formatting, comments only where
  the "why" is non-obvious.
