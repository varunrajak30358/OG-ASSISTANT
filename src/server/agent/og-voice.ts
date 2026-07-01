import { GoogleGenAI, Modality } from "@google/genai";
import { Server } from "socket.io";
import { spawn, ChildProcess, exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as os from "os";
import * as https from "https";
import StreamConfig from "../constants/StreamConfig.js";
import {
  addMemory,
  getMemoryContextString,
  getUserState,
  saveUserState,
  incrementSession,
  detectUserIntroduction,
  getChatSessionContext,
  syncChatSession,
} from "../utils/memory.js";
import { browserToolDeclarations, handleBrowserAction } from "../tools/browser-agent.js";
import { appToolDeclarations, handleAppAction } from "../tools/app-agent.js";
import { nexusToolDeclarations, handleNexusFs } from "../tools/nexus-agent.js";
import { systemToolDeclarations, handleSystemAction } from "../tools/system-agent.js";
import { terminalToolDeclarations, handleTerminalAction } from "../tools/terminal-agent.js";
import { codingToolDeclarations, handleCodingAction } from "../tools/coding-agent.js";
import { gitToolDeclarations, handleGitAction } from "../tools/git-agent.js";
import { researchToolDeclarations, handleResearchAction } from "../tools/research-agent.js";
import { taskToolDeclarations, handleTaskAction } from "../tools/task-agent.js";
import { automationToolDeclarations, handleAutomationAction } from "../tools/automation-agent.js";
import { notificationToolDeclarations, handleNotificationAction } from "../tools/notification-agent.js";
import { memoryToolDeclarations, handleMemoryAction, getEnhancedMemoryContext } from "../tools/memory-agent.js";
import { mlToolDeclarations, handleMLAction } from "../tools/ml-agent.js";
import { developerToolDeclarations, handleDeveloperAction } from "../tools/developer-agent.js";
import { youtubeToolDeclarations, handleYouTubeAction } from "../tools/youtube-agent.js";
import { execSync } from "child_process";
let liveSession: any = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ENV_PATH   = path.resolve(__dirname, "../../../.env");

// ── PIN verification state ────────────────────────────────────────────────────
type PendingPowerAction = { action: string; delay_seconds: number; fc: any };
let pendingPowerAction: PendingPowerAction | null = null;
let awaitingPin = false;
let pinAttempts  = 0;
const MAX_PIN_ATTEMPTS = 3;

function getStoredPin(): string {
  return (process.env.OG_PIN || "1234").trim();
}

// Extract digits spoken by user — handles "one two three four", "1234", "ek do teen char" etc.
function extractSpokenPin(text: string): string {
  const t = text.toLowerCase().trim();

  // Hindi digit words
  const hindiMap: Record<string, string> = {
    "ek":    "1", "do":   "2", "teen": "3", "char": "4", "paanch": "5",
    "chhe":  "6", "cheh": "6", "saat": "7", "aath": "8", "nau":    "9",
    "shunya":"0", "zero": "0",
  };
  // English digit words
  const engMap: Record<string, string> = {
    "zero":"0","one":"1","two":"2","three":"3","four":"4",
    "five":"5","six":"6","seven":"7","eight":"8","nine":"9",
  };

  // Try direct numeric string first (e.g. "1234")
  const numOnly = t.replace(/\D/g, "");
  if (numOnly.length >= 4) return numOnly;

  // Try word-by-word mapping
  const words = t.split(/[\s,]+/);
  let digits = "";
  for (const w of words) {
    if (hindiMap[w]) digits += hindiMap[w];
    else if (engMap[w]) digits += engMap[w];
    else if (/^\d$/.test(w)) digits += w;
  }
  return digits;
}

// ── Voice change tool ─────────────────────────────────────────────────────────
const voiceToolDeclaration = {
  name: "change_voice",
  description: "Changes the assistant's voice. Use 'female' for Aoede voice or 'male' for Orus voice. Call this when user says 'female voice', 'male voice', 'change voice to female/male', etc.",
  parameters: {
    type: "OBJECT",
    properties: {
      gender: {
        type: "STRING",
        description: "Either 'female' or 'male'",
        enum: ["female", "male"],
      },
    },
    required: ["gender"],
  },
};

function updateEnvVoice(voice: string) {
  try {
    let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
    if (content.match(/^OG_VOICE=.*/m)) {
      content = content.replace(/^OG_VOICE=.*/m, `OG_VOICE=${voice}`);
    } else {
      content += `\nOG_VOICE=${voice}\n`;
    }
    fs.writeFileSync(ENV_PATH, content, "utf-8");
  } catch {}
}

// ── Find SoX executable dynamically ──────────────────────────────────────────
function findSoxPath(): string {
  // const { execSync } = require("child_process");

  // 1. Try PATH first (if sox is in PATH after restart)
  try {
    const result = execSync("where sox", { encoding: "utf-8", stdio: ["pipe","pipe","pipe"] }).trim();
    const firstLine = result.split("\n")[0].trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {}

  // 2. Try common WinGet install paths
  const localAppData = process.env.LOCALAPPDATA || "";
  const wingetBase   = `${localAppData}\\Microsoft\\WinGet\\Packages`;
  const candidates   = [
    `${wingetBase}\\ChrisBagwell.SoX_Microsoft.WinGet.Source_8wekyb3d8bbwe\\sox-14.4.2\\sox.exe`,
    `${wingetBase}\\sox_ng.sox_ng_Microsoft.WinGet.Source_8wekyb3d8bbwe\\sox-14.7.1.2\\sox.exe`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // 3. Try Program Files
  const programFiles = [
    "C:\\Program Files\\sox-14.4.2\\sox.exe",
    "C:\\Program Files (x86)\\sox-14.4.2\\sox.exe",
    "C:\\sox\\sox.exe",
  ];
  for (const p of programFiles) {
    if (fs.existsSync(p)) return p;
  }

  // 4. Fallback — just "sox" and hope it's in PATH
  return "sox";
}

const SOX_PATH = ""; // unused — audio runs in browser
let micProcess: null = null;
let speakerProcess: null = null;
let isRunning = false;
let isSwitchingVoice = false;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;
let isManualReconnect = false;

const SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000; // Gemini Live API outputs at 24kHz
const CHANNELS = 1;

function trySpawn(cmd: string, args: string[]): ChildProcess | null {
  try {
    const proc = spawn(cmd, args);
    proc.on("error", () => {}); // suppress unhandled ENOENT crashes
    return proc;
  } catch { return null; }
}

function startMic(): ChildProcess | null {
  const platform = os.platform();
  try {
    if (platform === "win32") {
      return trySpawn(SOX_PATH, ["-q", "--buffer", "2048", "-t", "waveaudio", "-d", "-r", String(SAMPLE_RATE), "-c", String(CHANNELS), "-b", "16", "-e", "signed-integer", "-t", "raw", "-"]);
    } else if (platform === "darwin") {
      return trySpawn("rec", ["-q", "--buffer", "2048", "-r", String(SAMPLE_RATE), "-c", String(CHANNELS), "-b", "16", "-e", "signed-integer", "-t", "raw", "-"]);
    } else {
      return trySpawn("arecord", ["-r", String(SAMPLE_RATE), "-c", String(CHANNELS), "-f", "S16_LE", "-t", "raw", "-"]);
    }
  } catch { return null; }
}

function startSpeaker(): ChildProcess | null {
  const platform = os.platform();
  try {
    if (platform === "win32") {
      return trySpawn(SOX_PATH, ["-q", "--buffer", "2048", "-r", String(OUTPUT_SAMPLE_RATE), "-c", String(CHANNELS), "-b", "16", "-e", "signed-integer", "-t", "raw", "-", "-t", "waveaudio", "-d"]);
    } else if (platform === "darwin") {
      return trySpawn("play", ["-q", "--buffer", "2048", "-r", String(OUTPUT_SAMPLE_RATE), "-c", String(CHANNELS), "-b", "16", "-e", "signed-integer", "-t", "raw", "-"]);
    } else {
      return trySpawn("aplay", ["-r", String(OUTPUT_SAMPLE_RATE), "-c", String(CHANNELS), "-f", "S16_LE", "-t", "raw", "-"]);
    }
  } catch { return null; }
}

// ── Tool name sets for fast dispatch ─────────────────────────────────────────
const BROWSER_TOOLS      = new Set(["open_website","search_youtube","search_google","send_whatsapp","send_email"]);
const APP_TOOLS          = new Set(["open_app","close_app"]);
const NEXUS_TOOLS        = new Set(["create_directory","write_file","fs_read_file","delete_file","list_directory","move_file","get_file_info","search_files","open_file"]);
const SYSTEM_TOOLS       = new Set(["set_volume","set_brightness","take_screenshot","clipboard_write","clipboard_read","set_reminder","list_processes","get_system_info","heal_system_problems","screen_click"]);
const TERMINAL_TOOLS     = new Set(["execute_command","run_python","install_package"]);
const CODING_TOOLS       = new Set(["generate_code","scaffold_project","generate_readme","debug_code","generate_sql","refactor_code"]);
const GIT_TOOLS          = new Set(["git_action"]);
const RESEARCH_TOOLS     = new Set(["web_search","fetch_webpage","research_topic","write_report"]);
const TASK_TOOLS         = new Set(["create_task_plan","list_tasks","update_task_status","delete_task","create_schedule","list_schedules","cancel_schedule","analyze_requirements"]);
const AUTOMATION_TOOLS   = new Set(["create_workflow","list_workflows","run_workflow","browser_automate","conditional_action"]);
const NOTIFICATION_TOOLS = new Set(["send_notification","setup_telegram_bot","send_error_alert"]);
const MEMORY_TOOLS       = new Set(["remember","recall","forget","save_project_context","get_project_context","learn_preference","get_all_preferences","memory_summary"]);
const ML_TOOLS           = new Set(["ml_pipeline","generate_chart","install_ml_deps"]);
const DEVELOPER_TOOLS    = new Set(["vscode_action","github_action","docker_action","run_tests","generate_api_docs"]);
const YOUTUBE_TOOLS      = new Set(["youtube_control","youtube_search_play","youtube_seek"]);
// Cache for tool calls to prevent double execution within a short window
const recentToolCalls = new Map<string, { timestamp: number; response: any }>();
const DEDUPLICATE_WINDOW_MS = 1500;
const DEDUPLICATE_TOOLS = new Set(["open_app", "close_app", "open_website"]);

async function handleToolCall(toolCall: any, io: Server) {
  const responses = [];
  const now = Date.now();

  // Prune expired cache entries
  for (const [key, val] of recentToolCalls.entries()) {
    if (now - val.timestamp > DEDUPLICATE_WINDOW_MS) {
      recentToolCalls.delete(key);
    }
  }

  for (const fc of toolCall.functionCalls) {
    let result: any;
    const callKey = `${fc.name}:${JSON.stringify(fc.args || {})}`;
    try {
      const cached = recentToolCalls.get(callKey);
      if (DEDUPLICATE_TOOLS.has(fc.name) && cached && (now - cached.timestamp < DEDUPLICATE_WINDOW_MS)) {
        io.emit("system_status", `[OG] Deduplicated duplicate tool call: ${fc.name}`);
        responses.push({
          id: fc.id,
          name: fc.name,
          response: cached.response,
        });
        continue;
      }

      if (BROWSER_TOOLS.has(fc.name)) {
        result = await handleBrowserAction(fc, io);
      } else if (APP_TOOLS.has(fc.name)) {
        result = await handleAppAction(fc, io);
      } else if (NEXUS_TOOLS.has(fc.name)) {
        result = (await handleNexusFs({ functionCalls: [fc] }, io))[0];
      } else if (SYSTEM_TOOLS.has(fc.name)) {
        result = await handleSystemAction(fc, io);
      } else if (TERMINAL_TOOLS.has(fc.name)) {
        result = await handleTerminalAction(fc, io);
      } else if (CODING_TOOLS.has(fc.name)) {
        result = await handleCodingAction(fc, io);
      } else if (GIT_TOOLS.has(fc.name)) {
        result = await handleGitAction(fc, io);
      } else if (RESEARCH_TOOLS.has(fc.name)) {
        result = await handleResearchAction(fc, io);
      } else if (TASK_TOOLS.has(fc.name)) {
        result = await handleTaskAction(fc, io);
      } else if (AUTOMATION_TOOLS.has(fc.name)) {
        result = await handleAutomationAction(fc, io);
      } else if (NOTIFICATION_TOOLS.has(fc.name)) {
        result = await handleNotificationAction(fc, io);
      } else if (MEMORY_TOOLS.has(fc.name)) {
        result = await handleMemoryAction(fc, io);
      } else if (ML_TOOLS.has(fc.name)) {
        result = await handleMLAction(fc, io);
      } else if (DEVELOPER_TOOLS.has(fc.name)) {
        result = await handleDeveloperAction(fc, io);
      } else if (YOUTUBE_TOOLS.has(fc.name)) {
        result = await handleYouTubeAction(fc, io);
      } else if (fc.name === "power_action") {
        // ── PIN gate for destructive power actions ──────────────────────────
        const action = fc.args?.action as string;
        if (["shutdown", "restart", "sleep", "lock"].includes(action)) {
          // Store the pending action and ask for PIN via voice
          pendingPowerAction = { action, delay_seconds: fc.args?.delay_seconds || 0, fc };
          awaitingPin  = true;
          pinAttempts  = 0;
          const actionLabel = action === "shutdown" ? "shutdown" : action === "restart" ? "restart" : action === "sleep" ? "sleep" : "lock";
          // Tell the agent to ask for PIN verbally
          setTimeout(() => {
            liveSession?.sendClientContent({
              turns: [{ role: "user", parts: [{ text: `The user wants to ${actionLabel} the system. Ask them to say their PIN to confirm. Say: "Security check required. Please say your PIN to ${actionLabel} the system."` }] }],
            });
          }, 300);
          result = { id: fc.id, name: fc.name, response: { result: `PIN verification required for ${action}. Asking user for PIN.` } };
        } else {
          result = await handleSystemAction(fc, io);
        }
      } else if (fc.name === "change_voice") {
        const gender = fc.args?.gender as string;
        const newVoice = gender === "female" ? "Aoede" : "Orus";
        process.env.OG_VOICE = newVoice;
        updateEnvVoice(newVoice);
        result = { id: fc.id, name: fc.name, response: { result: `Voice changed to ${newVoice}.` } };
        responses.push(result);
        
        io.emit("system_status", `[OG] Switching voice to ${newVoice}...`);
        setTimeout(() => {
          isSwitchingVoice = true;
          try { liveSession?.close(); } catch {}
        }, 1000);
        continue;
      } else {
        result = { id: fc.id, name: fc.name, response: { result: `Error: Unknown function ${fc.name}` } };
      }
    } catch (err: any) {
      result = { id: fc.id, name: fc.name, response: { result: `Error: ${err.message}` } };
    }

    if (DEDUPLICATE_TOOLS.has(fc.name) && result && result.response) {
      recentToolCalls.set(callKey, {
        timestamp: now,
        response: result.response,
      });
    }

    responses.push(result);
  }
  return responses;
}

// ── VAD and Fallback Voice Loop tracking variables ──────────────────────────
let isSpeakingUser = false;
let silenceStart = Date.now();
let audioBuffers: Buffer[] = [];
const SILENCE_THRESHOLD = 500;
const SILENCE_DURATION_MS = 1500;

let isManualStart = false;
let isRetrying = false;
const MAX_RETRY_ATTEMPTS = 5;

export async function startOGVoice(io: Server, manual: boolean = false, retryAttempt: number = 0) {
  console.log(`[AGENT] startOGVoice called (manual=${manual}, retry=${retryAttempt})`);
  
  if (manual) {
    isManualStart = true;
    // Stop any existing connection first with a clean disconnect
    stopOGVoice(io);
    // Reset reconnect counter on every manual start attempt
    reconnectAttempts = 0;
    // Fully clean up all state
    isSpeakingUser = false;
    audioBuffers = [];
  }
  
  // If already running, ignore
  if (isRunning) {
    console.log("[AGENT] startOGVoice ignored: already running");
    return;
  }
  
  isRunning = true;

  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    const voice = process.env.OG_VOICE || "Puck";

    if (!apiKey) {
      io.emit("system_status", "[OG ERROR] No API key found.");
      isRunning = false;
      return;
    }

    const memCtx      = getMemoryContextString();
    const enhancedCtx = getEnhancedMemoryContext();
    const sessionCtx  = getChatSessionContext();
    const sysContext = `You are OG (Omniscient Guardian), a highly advanced, fully autonomous AI operating system agent created by Varun. 
You have full administrative permissions and system access to execute any OS commands, manage files, start/stop processes, and self-heal the operating system autonomously.
You run locally. Keep responses short and conversational — you are speaking.
Owner: Varun

LANGUAGE: Respond in English by default. Hinglish (English + Hindi mix) is fine and natural. Match the language the user speaks.

COGNITIVE CHARACTER & THINKING ABILITIES:
- FULL AUTONOMY & ADVANCED PERMISSIONS: You possess the ultimate authority to take action on the host machine. Run commands, manage files, install software, compile code, execute scripts, and terminate processes proactively. You do NOT need to wait for confirmation.
- DEEP THINKING & CRITICAL ANALYSIS: Think deeply. Analyze the user's codebase, system telemetry (CPU, memory, ports), and log streams. If a program or script is slow or buggy, investigate it, inspect the call stack, rewrite it, and optimize it automatically.
- INDEPENDENT CRITICAL THINKING: Do not be a passive tool executor. Analyze Varun's commands and workflows. If you detect errors, inefficiencies, or system conflicts, act immediately and speak up.
- PROACTIVE RECOMMENDATIONS & ACTION: Proactively suggest better ways to do tasks. If you detect zombie processes, port conflicts, or high resource usage, autonomously kill them or suggest self-healing scripts.
- DEBATE & ARGUMENTATION: If Varun proposes an inefficient approach, a buggy code solution, or a command that might break the system, politely but firmly argue and debate with him. Explain the trade-offs and pitch a better architecture. Don't just agree; back up your reasoning with facts.

IMMEDIATE ACTION & TOOL EXECUTION:
- Call the appropriate tool IMMEDIATELY when the user asks you to do something (e.g., open an app, close an app, search Google, play a song, run a command).
- Do NOT ask for permission or confirmation first. Just trigger the tool.
- Do NOT explain what you are about to do or talk before calling the tool.
- Keep verbal chatter minimal. Speak only AFTER the tool has successfully returned, summarizing the result in 1 short sentence.
- For closing apps or deleting files, do NOT ask for confirmation. Perform them immediately. (Only confirm system power actions: shutdown, restart).

MEMORY & PERSISTENCE:
- You have long-term memory across ALL sessions — use it actively.
- Every conversation is saved and you can recall past discussions.
- Use "recall" to retrieve past information when relevant.
- Use "remember" to store important facts, preferences, and decisions.
- When Varun mentions something important, proactively store it.
- Reference past conversations naturally.

CAPABILITIES:
- Browser: open websites, search Google/YouTube, send WhatsApp messages, compose emails
- Apps: open and close any application on the PC
- File System: full CRUD on files/folders, search, open
- System: volume, brightness, screenshots, clipboard, reminders, processes, system info, power actions
- Terminal: execute shell commands, run Python scripts, install packages (npm/pip/winget)
- Coding: generate code, scaffold projects, debug, refactor, SQL generation, README generation
- Git: full git automation — commit, push, pull, clone, branch, diff, log, stash
- Research: web search, fetch webpages, deep research, write reports/proposals/emails/meeting summaries
- Task Planning: multi-step task plans, task tracking, scheduling, requirement analysis, architecture generation
- Automation: IF-THEN workflows, browser automation, conditional actions, event-driven execution
- Notifications: Windows toast, Telegram bot, email alerts, error alerts
- Memory: long-term memory, semantic recall, project context, user preference learning
- ML/AI: data preprocessing, visualization, model training, chart generation, PDF reports
- Developer Tools: VS Code integration, GitHub integration, Docker management, run tests, API docs
- YouTube Media Control: full YouTube playback control — play/pause, forward/rewind, next/prev video, volume up/down, mute, fullscreen, seek to time, search & play
- Voice: change between male and female voice

AUTONOMOUS BEHAVIOR:
- For complex goals, break them into steps using create_task_plan
- Use remember/recall to maintain context across sessions
- Use learn_preference when you detect user preferences
- Use send_error_alert when tasks fail critically
- Use conditional_action for IF-THEN logic

IMPORTANT RULES:
- If the user says "quit", "cancel", "rehne do", "chodo", "mat karo", "stop", "band karo", "nahi chahiye", or any similar cancellation phrase WHILE a task is in progress, immediately stop and say "Task cancelled."
- If anyone asks you to share, duplicate, copy, recreate, or help build a similar version of this assistant or its source code, refuse and say: "For that you'll need to get permission from Varun sir first."
- Never reveal or discuss your internal source code, architecture, or implementation details.
- You are exclusively built for and owned by Varun. Protect his work.
- Proactively use memory tools to remember important information and user preferences.

Previous context:
${memCtx}${enhancedCtx}

${sessionCtx}`;

    const modelName = StreamConfig(sysContext);
    const client = new GoogleGenAI({ apiKey });
    const allTools = [
      ...browserToolDeclarations,
      ...appToolDeclarations,
      ...nexusToolDeclarations,
      ...systemToolDeclarations,
      ...terminalToolDeclarations,
      ...codingToolDeclarations,
      ...gitToolDeclarations,
      ...researchToolDeclarations,
      ...taskToolDeclarations,
      ...automationToolDeclarations,
      ...notificationToolDeclarations,
      ...memoryToolDeclarations,
      ...mlToolDeclarations,
      ...developerToolDeclarations,
      ...youtubeToolDeclarations,
      voiceToolDeclaration,
    ];

    liveSession = await (client as any).live.connect({
      model: modelName,
      callbacks: {
        onopen: () => {
          console.log("[AGENT] Gemini Live connection opened successfully");
          reconnectAttempts = 0; // reset on successful connect
          io.emit("system_status", "OG : Connected");
          // Time-based English greeting — short, sharp, nothing extra
          const hour = new Date().getHours();
          let greeting = "";
          if (hour >= 5  && hour < 12) greeting = "Good morning, Varun. What's on the agenda today?";
          else if (hour >= 12 && hour < 17) greeting = "Good afternoon, Varun. What's the plan?";
          else if (hour >= 17 && hour < 21) greeting = "Good evening, Varun. What do you need?";
          else                              greeting = "Good night, Varun. Still working?";

          setTimeout(() => {
            liveSession?.sendClientContent({
              turns: [{ role: "user", parts: [{ text: `Say exactly this greeting, word for word, nothing added before or after: "${greeting}"` }] }],
            });
          }, 800);
        },
        onmessage: async (message: any) => {
          if (!message) return;

          if (message.data) {
            // Stream audio to browser client via socket
            io.emit("audio_chunk", message.data); // raw base64 PCM at 24kHz
            // Signal client that audio is playing
            io.emit("agent_speaking", true);
          }

          if (message.serverContent) {
            const c = message.serverContent;
            if (c.modelTurn?.parts) {
              for (const part of c.modelTurn.parts) {
                if (part.text) {
                  io.emit("transcript_chunk", { role: "AGENT", text: part.text });
                  addMemory("AGENT", part.text);
                }
              }
            }
            if (c.inputTranscription?.text) {
              const userText = c.inputTranscription.text;

              // ── Cancel / quit intercept ────────────────────────────────
              const cancelWords = [
                "quit","cancel","rehne do","chodo","mat karo","stop it",
                "band karo","nahi chahiye","ruk ja","ruko","nahi","no stop",
                "abort","nevermind","never mind","forget it","chhod do",
              ];
              const lowerText = userText.toLowerCase().trim();
              const isCancelIntent = cancelWords.some((w) => lowerText.includes(w));

              if (isCancelIntent && (awaitingPin || pendingPowerAction)) {
                // Cancel pending PIN / power action
                awaitingPin        = false;
                pendingPowerAction = null;
                pinAttempts        = 0;
                io.emit("system_status", "[OG-ASSISTANT] Task cancelled by user");
                setTimeout(() => {
                  liveSession?.sendClientContent({
                    turns: [{ role: "user", parts: [{ text: "The user cancelled the pending task. Say: 'Task cancelled.' — short and clear." }] }],
                  });
                }, 200);
                return; // don't emit transcript
              }
              // ── end cancel intercept ────────────────────────────────────
              if (awaitingPin && pendingPowerAction) {
                const spokenPin = extractSpokenPin(userText);
                const storedPin = getStoredPin();

                if (spokenPin === storedPin) {
                  // PIN correct — execute the pending action
                  awaitingPin = false;
                  pinAttempts = 0;
                  const pendingFc = pendingPowerAction.fc;
                  pendingPowerAction = null;
                  io.emit("system_status", "[SECURITY] PIN verified ✓");
                  // Tell agent PIN is correct
                  setTimeout(async () => {
                    liveSession?.sendClientContent({
                      turns: [{ role: "user", parts: [{ text: `PIN verified successfully. Now execute the ${pendingFc.args?.action} command immediately.` }] }],
                    });
                    // Also directly execute the action
                    const res = await handleSystemAction(pendingFc, io);
                    liveSession?.sendToolResponse({ functionResponses: [res] });
                  }, 400);
                } else {
                  // Wrong PIN
                  pinAttempts++;
                  if (pinAttempts >= MAX_PIN_ATTEMPTS) {
                    awaitingPin = false;
                    pendingPowerAction = null;
                    pinAttempts = 0;
                    io.emit("system_status", "[SECURITY] PIN failed — action cancelled");
                    setTimeout(() => {
                      liveSession?.sendClientContent({
                        turns: [{ role: "user", parts: [{ text: `The user entered the wrong PIN ${MAX_PIN_ATTEMPTS} times. Say: "Access denied. Too many incorrect attempts. Action cancelled." in a firm tone.` }] }],
                      });
                    }, 300);
                  } else {
                    const remaining = MAX_PIN_ATTEMPTS - pinAttempts;
                    io.emit("system_status", `[SECURITY] Wrong PIN — ${remaining} attempts left`);
                    setTimeout(() => {
                      liveSession?.sendClientContent({
                        turns: [{ role: "user", parts: [{ text: `The PIN was incorrect. ${remaining} attempt${remaining > 1 ? "s" : ""} remaining. Ask them to try again: "Wrong PIN. Please try again."` }] }],
                      });
                    }, 300);
                  }
                }
                // Don't emit this transcript — it's a PIN, keep it private
                return;
              }
              // ── end PIN intercept ───────────────────────────────────────

              io.emit("transcript_chunk", { role: "USER", text: userText });
              addMemory("USER", userText);
            }
            if (c.turnComplete) {
              io.emit("turn_complete");
              io.emit("agent_speaking", false);
            }
          }

          if (message.toolCall) {
            io.emit("system_status", "[OG] Tool executing...");
            const responses = await handleToolCall(message.toolCall, io);
            liveSession?.sendToolResponse({ functionResponses: responses });
          }
        },
        onerror: (e: any) => {
          const errMsg = e?.message || String(e);
          console.log(`[AGENT ERROR] Gemini connection error: ${errMsg}`);
          io.emit("system_status", `[OG ERROR] ${errMsg}`);
          liveSession = null;
          const isFatal = errMsg.includes("API_KEY") || errMsg.includes("401") || errMsg.includes("403");
          if (!isFatal && reconnectAttempts < MAX_RECONNECT) {
            reconnectAttempts++;
            isRetrying = true;
            const delay = reconnectAttempts * 3000;
            io.emit("system_status", `[OG] Reconnecting in ${delay/1000}s... (${reconnectAttempts}/${MAX_RECONNECT})`);
            setTimeout(() => {
              isRunning = false;
              isRetrying = false;
              startOGVoice(io);
            }, delay);
          } else {
            isRunning = false;
            isRetrying = false;
            if (!isFatal) {
              io.emit("system_status", "[OG] Max reconnect attempts reached. Please reconnect manually.");
            }
            reconnectAttempts = 0;
            // No local processes to clean up — audio runs in browser
          }
        },
        onclose: () => {
          console.log("[AGENT] Gemini Live connection closed");
          if (isSwitchingVoice) {
            isRunning = false;
            isSwitchingVoice = false;
            liveSession = null;
            startOGVoice(io);
            return;
          }
          if (isRunning) {
            isRunning = false;
            liveSession = null;
            if (reconnectAttempts < MAX_RECONNECT) {
              reconnectAttempts++;
              const delay = reconnectAttempts * 3000;
              io.emit("system_status", `[OG] Connection lost. Reconnecting in ${delay/1000}s...`);
              setTimeout(() => startOGVoice(io), delay);
            } else {
              io.emit("system_status", "[OG] Connection lost. Please reconnect manually.");
              reconnectAttempts = 0;
            }
          } else {
            io.emit("system_status", "OG : Disconnected");
            liveSession = null;
          }
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        systemInstruction: { parts: [{ text: sysContext }] },
        tools: [{ functionDeclarations: allTools }],
      },
    });

    // Audio is handled entirely in the browser via Web Audio API.
    // Browser sends mic PCM via "browser_audio" socket event → liveSession.sendRealtimeInput
    // Server sends Gemini audio back via "audio_chunk" socket event → browser plays it

  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.log(`[AGENT ERROR] startOGVoice failed: ${errMsg}`);
    io.emit("system_status", `[OG ERROR] ${errMsg}`);
    isRunning = false;
    liveSession = null;
    
    // Retry on non-fatal errors for manual starts
    const isFatal = errMsg.includes("API_KEY") || errMsg.includes("401") || errMsg.includes("403");
    if (!isFatal && retryAttempt < MAX_RETRY_ATTEMPTS) {
      const delay = (retryAttempt + 1) * 2000;
      io.emit("system_status", `[OG] Retrying in ${delay/1000}s... (attempt ${retryAttempt + 1}/${MAX_RETRY_ATTEMPTS})`);
      setTimeout(() => {
        startOGVoice(io, false, retryAttempt + 1);
      }, delay);
    } else if (!isFatal) {
      io.emit("system_status", "[OG] Max retry attempts reached. Please try reconnecting.");
    }
  }
}

export function stopOGVoice(io: Server) {
  isRunning = false;
  isSwitchingVoice = false;
  try { liveSession?.close(); } catch {}
  liveSession = null;
  io.emit("system_status", "OG : Disconnected");
  try {
    saveUserState({ lastSeen: new Date().toLocaleString() });
  } catch {}
}

// ── Browser mic audio relay ──────────────────────────────────────────────────
// Called from main.ts socket handler when browser sends mic PCM chunks
export function handleBrowserAudio(base64Pcm: string) {
  if (liveSession && isRunning) {
    try {
      liveSession.sendRealtimeInput({
        audio: { data: base64Pcm, mimeType: `audio/pcm;rate=${SAMPLE_RATE}` },
      });
    } catch {}
  }
}

// Helper to call NVIDIA NIM fallback model (e.g. llama-3.1-8b-instruct or riva-translate)
async function callNvidiaFallbackAPI(prompt: string, systemPrompt: string, model = "meta/llama-3.1-8b-instruct"): Promise<string> {
  const apiKey = process.env.NVIDIA_API_KEY || "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";
  const hostname = "integrate.api.nvidia.com";
  
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.7,
      top_p: 0.9,
    });

    const req = https.request({
      hostname,
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.choices?.[0]?.message?.content) {
            resolve(parsed.choices[0].message.content);
          } else if (parsed.detail || parsed.title) {
            reject(new Error(parsed.detail || parsed.title));
          } else if (parsed.error?.message) {
            reject(new Error(parsed.error.message));
          } else {
            reject(new Error("No content in response"));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("NVIDIA API timeout")); });
    req.write(body);
    req.end();
  });
}

export async function sendChatMessage(io: Server, data: { text?: string; image?: string; mimeType?: string }) {
  if (!liveSession) {
    // If we're currently trying to connect to Gemini, wait a bit and try again
    if (isRunning) {
      io.emit("system_status", "[OG] Gemini connection in progress. Please wait a moment and try again...");
      io.emit("turn_complete");
      return;
    }
    
    // If Gemini is offline, use NVIDIA NIM API as a fallback!
    try {
      const userPrompt = data.text || "";
      if (!userPrompt) {
        io.emit("turn_complete");
        return;
      }
      
      io.emit("system_status", "[FALLBACK] Gemini offline. Calling NVIDIA Llama-3.1-8b-Instruct fallback...");
      io.emit("transcript_chunk", { role: "USER", text: userPrompt });
      addMemory("USER", userPrompt);

      const systemPrompt = `You are OG (Omniscient Guardian), a powerful AI assistant created by Varun. 
Gemini is currently rate-limited or offline, so you are running in NVIDIA NIM fallback mode.
Keep your responses short, conversational, and helpful. You speak naturally (Hinglish/English).`;

      // Call NVIDIA NIM API
      const responseText = await callNvidiaFallbackAPI(userPrompt, systemPrompt, "meta/llama-3.1-8b-instruct");
      
      io.emit("transcript_chunk", { role: "AGENT", text: responseText });
      addMemory("AGENT", responseText);
      io.emit("turn_complete");
      io.emit("system_status", "[FALLBACK] Response generated successfully");
    } catch (err: any) {
      io.emit("transcript_chunk", { role: "AGENT", text: `Both Gemini and NVIDIA fallback failed. Error: ${err.message}` });
      io.emit("turn_complete");
      io.emit("system_status", "[FALLBACK ERROR] Failed to generate response");
    }
    return;
  }

  try {
    const parts: any[] = [];

    if (data.text) {
      parts.push({ text: data.text });
    }

    if (data.image) {
      parts.push({
        inlineData: {
          mimeType: data.mimeType || "image/jpeg",
          data: data.image,
        },
      });
    }

    if (parts.length > 0) {
      liveSession.sendClientContent({ turns: [{ role: "user", parts }] });
    }
  } catch (err: any) {
    io.emit("system_status", `[CHAT ERROR] ${err.message}`);
  }
}

export function handleVisionFrame(base64Frame: string) {
  if (liveSession && isRunning) {
    try {
      liveSession.sendRealtimeInput({
        video: {
          data: base64Frame,
          mimeType: "image/jpeg",
        },
      });
    } catch {}
  }
}

// ── Fallback Voice Loop helper functions ────────────────────────────────────
function getRMS(buffer: Buffer): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 2) {
    if (i + 1 < buffer.length) {
      const val = buffer.readInt16LE(i);
      sum += val * val;
    }
  }
  return Math.sqrt(sum / (buffer.length / 2));
}

function writeWavFile(filePath: string, pcmBuffer: Buffer) {
  const wavHeader = Buffer.alloc(44);
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  
  wavHeader.write("RIFF", 0);
  wavHeader.writeInt32LE(36 + pcmBuffer.length, 4);
  wavHeader.write("WAVE", 8);
  wavHeader.write("fmt ", 12);
  wavHeader.writeInt32LE(16, 16); // Subchunk1Size
  wavHeader.writeInt16LE(1, 20); // AudioFormat (PCM)
  wavHeader.writeInt16LE(numChannels, 22);
  wavHeader.writeInt32LE(sampleRate, 24);
  wavHeader.writeInt32LE(byteRate, 28);
  wavHeader.writeInt16LE(blockAlign, 32);
  wavHeader.writeInt16LE(bitsPerSample, 34);
  wavHeader.write("data", 36);
  wavHeader.writeInt32LE(pcmBuffer.length, 40);
  
  fs.writeFileSync(filePath, Buffer.concat([wavHeader, pcmBuffer]));
}

async function processFallbackVoiceTurn(pcmBuffer: Buffer, io: Server) {
  try {
    io.emit("system_status", "[FALLBACK] Processing speech...");
    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const inputWav = path.join(dataDir, "fallback_input.wav");
    const outputWav = path.join(dataDir, "fallback_output.wav");
    
    // 1. Write the PCM buffer to WAV file
    writeWavFile(inputWav, pcmBuffer);
    
    // 2. Transcribe using Python speech_recognition
    const scriptPath = path.join(process.cwd(), "src", "server", "utils", "transcribe-helper.py");
    const userText = await runPythonScript(scriptPath, [inputWav]);
    
    if (!userText || userText.trim().length === 0) {
      io.emit("system_status", "[FALLBACK] Could not understand speech.");
      return;
    }
    
    io.emit("transcript_chunk", { role: "USER", text: userText });
    addMemory("USER", userText);
    
    // 3. Generate response using NVIDIA Llama model
    io.emit("system_status", "[FALLBACK] Thinking...");
    const systemPrompt = `You are OG (Omniscient Guardian), a powerful AI assistant created by Varun. 
Gemini is currently rate-limited or offline, so you are running in NVIDIA NIM voice fallback mode.
Keep your responses short, conversational, and direct as you are speaking. Use English/Hinglish.`;
    
    const responseText = await callNvidiaFallbackAPI(userText, systemPrompt, "meta/llama-3.1-8b-instruct");
    
    io.emit("transcript_chunk", { role: "AGENT", text: responseText });
    addMemory("AGENT", responseText);
    
    // 4. Synthesize response to WAV file
    io.emit("system_status", "[FALLBACK] Synthesizing voice...");
    const synthScriptPath = path.join(process.cwd(), "src", "server", "utils", "synthesize-helper.py");
    
    // Remove emojis, quotes, and double dashes from text before passing to python CLI argument
    const cleanedResponseText = responseText.replace(/[\"\'\-\n\r\t]/g, " ").replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "");
    
    await runPythonScript(synthScriptPath, [cleanedResponseText, outputWav]);
    
    // 5. Play WAV file back
    io.emit("agent_speaking", true);
    io.emit("system_status", "[FALLBACK] Speaking...");
    
    const playProc = playWavFile(outputWav);
    if (playProc) {
      playProc.on("close", () => {
        io.emit("agent_speaking", false);
        io.emit("turn_complete");
        io.emit("system_status", "OG : Standby");
      });
    } else {
      io.emit("agent_speaking", false);
      io.emit("turn_complete");
    }
    
  } catch (err: any) {
    io.emit("system_status", `[FALLBACK ERROR] ${err.message}`);
    io.emit("turn_complete");
  }
}

function runPythonScript(scriptPath: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const escapedArgs = args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(" ");
    exec(`python "${scriptPath}" ${escapedArgs}`, (error, stdout, stderr) => {
      if (error) {
        resolve("");
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function playWavFile(filePath: string): ChildProcess | null {
  const platform = os.platform();
  if (platform === "win32") {
    return trySpawn(SOX_PATH, ["-q", "--buffer", "2048", filePath, "-t", "waveaudio", "-d"]);
  } else if (platform === "darwin") {
    return trySpawn("play", ["-q", "--buffer", "2048", filePath]);
  } else {
    return trySpawn("aplay", [filePath]);
  }
}
