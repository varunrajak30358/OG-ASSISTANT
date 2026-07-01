import * as fs from "fs";
import * as path from "path";

const memoryFile       = path.join(process.cwd(), "data", "memory.json");
const userStateFile    = path.join(process.cwd(), "data", "user_state.json");
const chatSessionsFile = path.join(process.cwd(), "data", "chat_sessions.json");

// ── Types ─────────────────────────────────────────────────────────────────────
export type UserState = {
  currentUser: string;
  voicePrint:  string;
  lastSeen:    string;
  sessionCount: number;
};

export type ServerChatMessage = {
  role:      string;
  text:      string;
  timestamp: string;
};

export type ServerChatSession = {
  id:        string;
  title:     string;
  messages:  ServerChatMessage[];
  createdAt: number;
  updatedAt: number;
  summary?:  string;
  keywords?: string[];
};

// ── User state ────────────────────────────────────────────────────────────────
const DEFAULT_USER_STATE: UserState = {
  currentUser:  "varun",
  voicePrint:   "",
  lastSeen:     "",
  sessionCount: 0,
};

export function getUserState(): UserState {
  if (!fs.existsSync(userStateFile)) return { ...DEFAULT_USER_STATE };
  try {
    return { ...DEFAULT_USER_STATE, ...JSON.parse(fs.readFileSync(userStateFile, "utf-8")) };
  } catch {
    return { ...DEFAULT_USER_STATE };
  }
}

export function saveUserState(state: Partial<UserState>) {
  const dir = path.dirname(userStateFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const current = getUserState();
  const updated = { ...current, ...state, lastSeen: new Date().toLocaleString() };
  fs.writeFileSync(userStateFile, JSON.stringify(updated, null, 2));
}

export function incrementSession() {
  const s = getUserState();
  saveUserState({ sessionCount: (s.sessionCount || 0) + 1 });
}

export function detectUserIntroduction(text: string): string | null {
  const t = text.toLowerCase().trim();
  const patterns = [
    /(?:main|mera naam|i am|i'm|my name is|mujhe|mujhe bulao)\s+([a-z]+)/i,
    /([a-z]+)\s+(?:bol rahe hain|bol raha hoon|here|speaking|baat kar raha)/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m?.[1] && m[1].length > 2) return m[1].toLowerCase();
  }
  return null;
}

// ── Short-term memory (last 20 turns for live context) ────────────────────────
export function getMemory(): any[] {
  if (!fs.existsSync(memoryFile)) return [];
  try { return JSON.parse(fs.readFileSync(memoryFile, "utf-8")); }
  catch { return []; }
}

export function addMemory(role: string, text: string) {
  const dir = path.dirname(memoryFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let mem = getMemory();
  mem.push({ role, text, timestamp: new Date().toLocaleString() });
  if (mem.length > 20) mem = mem.slice(mem.length - 20);
  fs.writeFileSync(memoryFile, JSON.stringify(mem, null, 2));
}

export function getMemoryContextString(): string {
  const mem   = getMemory();
  const state = getUserState();

  const userLine = state.currentUser !== "varun"
    ? `NOTE: Current speaker is "${state.currentUser}", NOT Varun. Treat them as a guest.`
    : `NOTE: Current speaker is Varun (owner). Session #${state.sessionCount}.`;

  if (mem.length === 0) return `${userLine}\nNo previous conversation history.`;

  const history = mem
    .map((m: any) => `[${m.role}] (${m.timestamp}): ${m.text}`)
    .join("\n");

  return `${userLine}\n\nRecent conversation:\n${history}`;
}

// ── Chat session persistence ───────────────────────────────────────────────────
function loadChatSessions(): ServerChatSession[] {
  try {
    if (!fs.existsSync(chatSessionsFile)) return [];
    return JSON.parse(fs.readFileSync(chatSessionsFile, "utf-8"));
  } catch { return []; }
}

function saveChatSessions(sessions: ServerChatSession[]) {
  const dir = path.dirname(chatSessionsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(chatSessionsFile, JSON.stringify(sessions, null, 2));
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the","a","an","is","are","was","were","be","been","being","have","has","had",
    "do","does","did","will","would","could","should","may","might","shall","can",
    "and","or","but","in","on","at","to","for","of","with","by","from","this",
    "that","these","those","it","he","she","we","they","you","i","me","my","our",
    "your","his","her","its","their","what","how","why","when","where","who",
    "main","hai","tha","kar","karo","kiya","aur","ya","se","ko","ne","mein","pe",
    "ok","okay","yes","no","yeah","nahi","haan","nope","yep","hmm","uh","um",
  ]);
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .reduce((acc: string[], w) => {
      if (!acc.includes(w)) acc.push(w);
      return acc;
    }, [])
    .slice(0, 15);
}

function buildSessionSummary(messages: ServerChatMessage[]): string {
  const userMsgs = messages
    .filter(m => m.role === "USER" && m.text.length > 5)
    .slice(0, 6)
    .map(m => m.text.slice(0, 80));
  if (userMsgs.length === 0) return "";
  return userMsgs.join(" | ").slice(0, 300);
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs  < 24) return `${hrs}h ago`;
  if (days === 1) return "yesterday";
  if (days < 7)  return `${days} days ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Sync a session from the client → server storage ──────────────────────────
export function syncChatSession(session: {
  id:        string;
  title:     string;
  messages:  Array<{ role: string; text: string; timestamp?: string; isFinal?: boolean }>;
  createdAt: number;
  updatedAt: number;
}) {
  const sessions = loadChatSessions();
  const idx = sessions.findIndex(s => s.id === session.id);

  const msgs: ServerChatMessage[] = session.messages
    .filter(m => m.role !== "SYSTEM" && m.text && m.text.length > 1)
    .map(m => ({ role: m.role, text: m.text, timestamp: m.timestamp || "" }));

  const allText  = msgs.map(m => m.text).join(" ");
  const keywords = extractKeywords(allText);
  const summary  = buildSessionSummary(msgs);

  const serverSession: ServerChatSession = {
    id: session.id, title: session.title,
    messages: msgs, createdAt: session.createdAt,
    updatedAt: session.updatedAt, summary, keywords,
  };

  if (idx !== -1) {
    sessions[idx] = serverSession;
  } else {
    sessions.unshift(serverSession);
    if (sessions.length > 100) sessions.splice(100);
  }

  saveChatSessions(sessions);
}

// ── Build rich cross-session context for the system prompt ──────────────────
export function getChatSessionContext(): string {
  const sessions = loadChatSessions();
  if (sessions.length === 0) return "";

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const lines: string[] = [];

  lines.push("=== PERSISTENT MEMORY — ALL PAST CONVERSATIONS ===");
  lines.push(`Total sessions stored: ${sorted.length}`);
  lines.push("You MUST use this memory to feel continuous — never say you don't remember past conversations.");
  lines.push("");

  // Most recent session — show last 12 messages in full
  const last = sorted[0];
  if (last && last.messages.length > 0) {
    lines.push(`── Most Recent Session (${formatAgo(last.updatedAt)}): "${last.title}"`);
    for (const m of last.messages.slice(-12)) {
      const label = m.role === "USER" ? "Varun" : "OG";
      lines.push(`  ${label}: ${m.text.slice(0, 160)}`);
    }
    lines.push("");
  }

  // Previous sessions — title + summary + keywords
  const older = sorted.slice(1, 10);
  if (older.length > 0) {
    lines.push("── Previous Sessions (summary):");
    for (const s of older) {
      lines.push(`  • [${formatAgo(s.updatedAt)}] "${s.title}" (${s.messages.length} messages)`);
      if (s.summary)                          lines.push(`    Summary: ${s.summary.slice(0, 200)}`);
      if (s.keywords && s.keywords.length > 0) lines.push(`    Topics:  ${s.keywords.slice(0, 10).join(", ")}`);
    }
    lines.push("");
  }

  lines.push("IMPORTANT: Reference past conversations naturally. If Varun asks about something you discussed before, recall it confidently.");
  lines.push("=================================================");

  return lines.join("\n");
}