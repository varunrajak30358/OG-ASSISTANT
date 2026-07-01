/**
 * Memory Agent — Long-term memory, project memory, conversation history,
 * user preference learning, context persistence, RAG pipeline,
 * vector-like semantic search using keyword indexing
 */
import { Type, type FunctionDeclaration } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import { Server } from "socket.io";
import { logActivity } from "../utils/activity-log.js";

const LONG_TERM_MEMORY_FILE = path.join(process.cwd(), "data", "long_term_memory.json");
const PROJECT_MEMORY_FILE = path.join(process.cwd(), "data", "project_memory.json");
const PREFERENCES_FILE = path.join(process.cwd(), "data", "preferences.json");

// ── Types ─────────────────────────────────────────────────────────────────────
export type MemoryEntry = {
  id: string;
  type: "fact" | "preference" | "project" | "conversation" | "knowledge" | "note";
  content: string;
  tags: string[];
  importance: number; // 1-10
  createdAt: string;
  accessCount: number;
  lastAccessed: string;
  source?: string;
};

export type ProjectMemory = {
  id: string;
  name: string;
  description: string;
  path?: string;
  tech_stack: string[];
  notes: string[];
  status: "active" | "paused" | "completed" | "archived";
  createdAt: string;
  updatedAt: string;
  context: string;
};

export type UserPreference = {
  key: string;
  value: string;
  category: "behavior" | "style" | "tool" | "language" | "workflow" | "other";
  learnedAt: string;
  confidence: number; // 0-1
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Load/Save helpers ─────────────────────────────────────────────────────────
function loadMemory(): MemoryEntry[] {
  try {
    if (!fs.existsSync(LONG_TERM_MEMORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(LONG_TERM_MEMORY_FILE, "utf-8"));
  } catch { return []; }
}

function saveMemory(entries: MemoryEntry[]): void {
  const dir = path.dirname(LONG_TERM_MEMORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LONG_TERM_MEMORY_FILE, JSON.stringify(entries, null, 2));
}

function loadProjects(): ProjectMemory[] {
  try {
    if (!fs.existsSync(PROJECT_MEMORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(PROJECT_MEMORY_FILE, "utf-8"));
  } catch { return []; }
}

function saveProjects(projects: ProjectMemory[]): void {
  const dir = path.dirname(PROJECT_MEMORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROJECT_MEMORY_FILE, JSON.stringify(projects, null, 2));
}

function loadPreferences(): UserPreference[] {
  try {
    if (!fs.existsSync(PREFERENCES_FILE)) return [];
    return JSON.parse(fs.readFileSync(PREFERENCES_FILE, "utf-8"));
  } catch { return []; }
}

function savePreferences(prefs: UserPreference[]): void {
  const dir = path.dirname(PREFERENCES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(prefs, null, 2));
}

// ── Semantic search (keyword-based TF-IDF-like scoring) ───────────────────────
function semanticSearch(query: string, entries: MemoryEntry[], topK = 5): MemoryEntry[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  const scored = entries.map(entry => {
    const text = `${entry.content} ${entry.tags.join(" ")}`.toLowerCase();
    let score = 0;

    for (const word of queryWords) {
      // Exact match
      const exactMatches = (text.match(new RegExp(word, "g")) || []).length;
      score += exactMatches * 2;

      // Partial match
      if (text.includes(word.slice(0, 4))) score += 0.5;
    }

    // Boost by importance and recency
    score *= (entry.importance / 10);
    const daysSince = (Date.now() - new Date(entry.lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
    score *= Math.max(0.1, 1 - daysSince / 365);

    return { entry, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.entry);
}

export const memoryToolDeclarations: FunctionDeclaration[] = [
  {
    name: "remember",
    description:
      "Stores important information in long-term memory. Use when user says 'yaad rakhna', 'remember this', 'note karo', 'save this fact', 'important hai ye'. Also use proactively when learning user preferences.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: {
          type: Type.STRING,
          description: "The information to remember.",
        },
        memory_type: {
          type: Type.STRING,
          description: "Type of memory.",
          enum: ["fact", "preference", "project", "conversation", "knowledge", "note"],
        },
        tags: {
          type: Type.STRING,
          description: "Comma-separated tags for categorization, e.g., 'coding,python,preference'.",
        },
        importance: {
          type: Type.NUMBER,
          description: "Importance level 1-10. Default 5.",
        },
      },
      required: ["content", "memory_type"],
    },
  },
  {
    name: "recall",
    description:
      "Searches long-term memory for relevant information. Use when user says 'yaad hai kya', 'recall karo', 'kya pata hai', 'search memory', 'what do you know about X'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "What to search for in memory.",
        },
        memory_type: {
          type: Type.STRING,
          description: "Optional: filter by type.",
          enum: ["fact", "preference", "project", "conversation", "knowledge", "note", "all"],
        },
        top_k: {
          type: Type.NUMBER,
          description: "Number of results to return. Default 5.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "forget",
    description: "Removes a specific memory entry. Use when user says 'bhool jao', 'delete memory', 'remove this'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        memory_id: {
          type: Type.STRING,
          description: "Memory ID to delete, or a search query to find and delete.",
        },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "save_project_context",
    description:
      "Saves project-specific memory and context. Use when user says 'project save karo', 'project context yaad rakhna', 'is project ke baare mein note karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        project_name: {
          type: Type.STRING,
          description: "Project name.",
        },
        description: {
          type: Type.STRING,
          description: "Project description.",
        },
        project_path: {
          type: Type.STRING,
          description: "Optional: file system path to the project.",
        },
        tech_stack: {
          type: Type.STRING,
          description: "Comma-separated technologies used.",
        },
        notes: {
          type: Type.STRING,
          description: "Important notes about the project.",
        },
        context: {
          type: Type.STRING,
          description: "Full context about the project state, goals, and progress.",
        },
        status: {
          type: Type.STRING,
          description: "Project status.",
          enum: ["active", "paused", "completed", "archived"],
        },
      },
      required: ["project_name", "description"],
    },
  },
  {
    name: "get_project_context",
    description: "Retrieves saved project context. Use when starting work on a project.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        project_name: {
          type: Type.STRING,
          description: "Project name to retrieve context for.",
        },
      },
      required: ["project_name"],
    },
  },
  {
    name: "learn_preference",
    description:
      "Learns and saves a user preference. Use proactively when user expresses preferences like 'mujhe X pasand hai', 'always do Y', 'I prefer Z', 'use this style'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        preference_key: {
          type: Type.STRING,
          description: "What the preference is about, e.g., 'code_style', 'language', 'response_length', 'voice'.",
        },
        preference_value: {
          type: Type.STRING,
          description: "The preference value, e.g., 'TypeScript', 'Hinglish', 'concise', 'female'.",
        },
        category: {
          type: Type.STRING,
          description: "Category of preference.",
          enum: ["behavior", "style", "tool", "language", "workflow", "other"],
        },
      },
      required: ["preference_key", "preference_value", "category"],
    },
  },
  {
    name: "get_all_preferences",
    description: "Returns all learned user preferences.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
  {
    name: "memory_summary",
    description: "Returns a summary of all stored memories, projects, and preferences.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
];

export const handleMemoryAction = async (fc: any, io: Server): Promise<any> => {
  let resultStr = "";
  const args = fc.args as any;

  try {
    if (fc.name === "remember") {
      const entries = loadMemory();
      const entry: MemoryEntry = {
        id: generateId(),
        type: args.memory_type || "note",
        content: args.content,
        tags: args.tags ? args.tags.split(",").map((t: string) => t.trim()) : [],
        importance: Math.min(10, Math.max(1, args.importance || 5)),
        createdAt: new Date().toISOString(),
        accessCount: 0,
        lastAccessed: new Date().toISOString(),
      };

      entries.push(entry);
      // Keep max 500 entries, remove lowest importance if over limit
      if (entries.length > 500) {
        entries.sort((a, b) => b.importance - a.importance);
        entries.splice(500);
      }
      saveMemory(entries);

      resultStr = `Remembered! ID: ${entry.id.slice(0, 8)}\nType: ${entry.type}\nContent: ${entry.content.slice(0, 100)}\nImportance: ${entry.importance}/10`;
      io.emit("system_status", `[MEMORY] Stored: ${entry.content.slice(0, 50)}`);
      logActivity("REMEMBER", { id: entry.id, type: entry.type });

    } else if (fc.name === "recall") {
      const entries = loadMemory();
      const typeFilter = args.memory_type && args.memory_type !== "all" ? args.memory_type : null;
      const filtered = typeFilter ? entries.filter(e => e.type === typeFilter) : entries;
      const results = semanticSearch(args.query, filtered, args.top_k || 5);

      if (results.length === 0) {
        resultStr = `No memories found for: "${args.query}"`;
      } else {
        // Update access counts
        const allEntries = loadMemory();
        results.forEach(r => {
          const idx = allEntries.findIndex(e => e.id === r.id);
          if (idx !== -1) {
            allEntries[idx].accessCount++;
            allEntries[idx].lastAccessed = new Date().toISOString();
          }
        });
        saveMemory(allEntries);

        const lines = results.map((r, i) =>
          `${i + 1}. [${r.type.toUpperCase()}] ${r.content.slice(0, 150)}${r.tags.length ? ` (tags: ${r.tags.join(", ")})` : ""}`
        );
        resultStr = `Found ${results.length} memories for "${args.query}":\n\n${lines.join("\n\n")}`;
      }
      io.emit("system_status", `[MEMORY] Recalled: ${results.length} results for "${args.query.slice(0, 30)}"`);

    } else if (fc.name === "forget") {
      const entries = loadMemory();
      const idx = entries.findIndex(e => e.id === args.memory_id || e.id.startsWith(args.memory_id));
      if (idx !== -1) {
        const removed = entries.splice(idx, 1)[0];
        saveMemory(entries);
        resultStr = `Forgotten: ${removed.content.slice(0, 100)}`;
        io.emit("system_status", `[MEMORY] Forgotten: ${removed.content.slice(0, 40)}`);
        logActivity("FORGET", { id: removed.id });
      } else {
        // Try semantic search to find it
        const results = semanticSearch(args.memory_id, entries, 1);
        if (results.length > 0) {
          const toRemove = results[0];
          const removeIdx = entries.findIndex(e => e.id === toRemove.id);
          entries.splice(removeIdx, 1);
          saveMemory(entries);
          resultStr = `Forgotten: ${toRemove.content.slice(0, 100)}`;
          io.emit("system_status", `[MEMORY] Forgotten: ${toRemove.content.slice(0, 40)}`);
        } else {
          resultStr = `Memory not found: ${args.memory_id}`;
        }
      }

    } else if (fc.name === "save_project_context") {
      const projects = loadProjects();
      const existing = projects.findIndex(p => p.name.toLowerCase() === args.project_name.toLowerCase());

      const project: ProjectMemory = {
        id: existing !== -1 ? projects[existing].id : generateId(),
        name: args.project_name,
        description: args.description,
        path: args.project_path,
        tech_stack: args.tech_stack ? args.tech_stack.split(",").map((t: string) => t.trim()) : [],
        notes: args.notes ? [args.notes] : [],
        status: args.status || "active",
        createdAt: existing !== -1 ? projects[existing].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        context: args.context || args.description,
      };

      if (existing !== -1) {
        // Merge notes
        project.notes = [...new Set([...projects[existing].notes, ...(args.notes ? [args.notes] : [])])];
        projects[existing] = project;
        resultStr = `Project context updated: ${project.name}`;
      } else {
        projects.push(project);
        resultStr = `Project context saved: ${project.name}`;
      }

      saveProjects(projects);
      io.emit("system_status", `[MEMORY] Project saved: ${project.name}`);
      logActivity("SAVE_PROJECT", { name: project.name });

    } else if (fc.name === "get_project_context") {
      const projects = loadProjects();
      const project = projects.find(p => p.name.toLowerCase().includes(args.project_name.toLowerCase()));

      if (!project) {
        resultStr = `No project context found for: ${args.project_name}`;
      } else {
        resultStr = [
          `Project: ${project.name}`,
          `Status: ${project.status}`,
          `Description: ${project.description}`,
          project.path ? `Path: ${project.path}` : "",
          project.tech_stack.length ? `Tech Stack: ${project.tech_stack.join(", ")}` : "",
          project.notes.length ? `Notes:\n${project.notes.map(n => `  - ${n}`).join("\n")}` : "",
          `Context: ${project.context}`,
          `Last Updated: ${new Date(project.updatedAt).toLocaleString()}`,
        ].filter(Boolean).join("\n");
        io.emit("system_status", `[MEMORY] Project context retrieved: ${project.name}`);
      }

    } else if (fc.name === "learn_preference") {
      const prefs = loadPreferences();
      const existing = prefs.findIndex(p => p.key === args.preference_key);

      const pref: UserPreference = {
        key: args.preference_key,
        value: args.preference_value,
        category: args.category || "other",
        learnedAt: new Date().toISOString(),
        confidence: existing !== -1 ? Math.min(1, prefs[existing].confidence + 0.1) : 0.7,
      };

      if (existing !== -1) {
        prefs[existing] = pref;
        resultStr = `Preference updated: ${pref.key} = ${pref.value}`;
      } else {
        prefs.push(pref);
        resultStr = `Preference learned: ${pref.key} = ${pref.value}`;
      }

      savePreferences(prefs);
      io.emit("system_status", `[MEMORY] Preference: ${pref.key} = ${pref.value}`);
      logActivity("LEARN_PREFERENCE", { key: pref.key, value: pref.value });

    } else if (fc.name === "get_all_preferences") {
      const prefs = loadPreferences();
      if (prefs.length === 0) {
        resultStr = "No preferences learned yet.";
      } else {
        const grouped: Record<string, UserPreference[]> = {};
        prefs.forEach(p => {
          if (!grouped[p.category]) grouped[p.category] = [];
          grouped[p.category].push(p);
        });
        const lines = Object.entries(grouped).map(([cat, ps]) =>
          `[${cat.toUpperCase()}]\n${ps.map(p => `  ${p.key}: ${p.value} (confidence: ${Math.round(p.confidence * 100)}%)`).join("\n")}`
        );
        resultStr = `User Preferences (${prefs.length}):\n\n${lines.join("\n\n")}`;
      }
      io.emit("system_status", `[MEMORY] Preferences retrieved`);

    } else if (fc.name === "memory_summary") {
      const entries = loadMemory();
      const projects = loadProjects();
      const prefs = loadPreferences();

      const typeCounts: Record<string, number> = {};
      entries.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });

      resultStr = [
        `=== Memory Summary ===`,
        `Long-term memories: ${entries.length}`,
        Object.entries(typeCounts).map(([t, c]) => `  ${t}: ${c}`).join("\n"),
        ``,
        `Projects: ${projects.length}`,
        projects.map(p => `  [${p.status}] ${p.name}`).join("\n"),
        ``,
        `User preferences: ${prefs.length}`,
        ``,
        `Top memories by importance:`,
        entries.sort((a, b) => b.importance - a.importance).slice(0, 5)
          .map(e => `  [${e.importance}/10] ${e.content.slice(0, 80)}`).join("\n"),
      ].join("\n");
      io.emit("system_status", `[MEMORY] Summary generated`);
    }
  } catch (err: any) {
    resultStr = `Error: ${err.message}`;
    io.emit("system_status", `[MEMORY ERROR] ${err.message?.slice(0, 80)}`);
  }

  return { id: fc.id, name: fc.name, response: { result: resultStr } };
};

// ── Export memory context for system prompt injection ─────────────────────────
export function getEnhancedMemoryContext(): string {
  try {
    const prefs = loadPreferences();
    const projects = loadProjects().filter(p => p.status === "active");
    const entries = loadMemory()
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 10);

    const parts: string[] = [];

    if (prefs.length > 0) {
      parts.push(`User Preferences:\n${prefs.map(p => `  ${p.key}: ${p.value}`).join("\n")}`);
    }

    if (projects.length > 0) {
      parts.push(`Active Projects:\n${projects.map(p => `  ${p.name}: ${p.description.slice(0, 100)}`).join("\n")}`);
    }

    if (entries.length > 0) {
      parts.push(`Key Memories:\n${entries.map(e => `  [${e.type}] ${e.content.slice(0, 100)}`).join("\n")}`);
    }

    return parts.length > 0 ? `\n\n=== Enhanced Memory Context ===\n${parts.join("\n\n")}` : "";
  } catch { return ""; }
}
