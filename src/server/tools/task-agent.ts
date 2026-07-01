/**
 * Task Agent — Autonomous task planning, multi-step execution, goal-based workflows,
 * background task handling, auto-retry on failure, task decomposition, milestone creation,
 * dependency mapping, timeline estimation, scheduling
 */
import { Type, type FunctionDeclaration } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Server } from "socket.io";
import { logActivity } from "../utils/activity-log.js";

const TASKS_FILE = path.join(process.cwd(), "data", "tasks.json");
const SCHEDULES_FILE = path.join(process.cwd(), "data", "schedules.json");

// ── Task store ────────────────────────────────────────────────────────────────
export type Task = {
  id: string;
  goal: string;
  steps: TaskStep[];
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  createdAt: string;
  updatedAt: string;
  retries: number;
  maxRetries: number;
  result?: string;
  tags?: string[];
  deadline?: string;
  dependencies?: string[];
};

export type TaskStep = {
  id: string;
  description: string;
  tool?: string;
  args?: Record<string, any>;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: string;
  order: number;
};

export type Schedule = {
  id: string;
  name: string;
  trigger: "cron" | "interval" | "once" | "event";
  cronExpr?: string;
  intervalMs?: number;
  runAt?: string;
  eventName?: string;
  action: string;
  args?: Record<string, any>;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
};

// ── Active background tasks (reserved for future background execution) ────────
// const backgroundTasks = new Map<string, { task: Task; timer?: ReturnType<typeof setTimeout> }>();
const scheduleTimers = new Map<string, ReturnType<typeof setInterval>>();

function loadTasks(): Task[] {
  try {
    if (!fs.existsSync(TASKS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8"));
  } catch { return []; }
}

function saveTasks(tasks: Task[]): void {
  const dir = path.dirname(TASKS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

function loadSchedules(): Schedule[] {
  try {
    if (!fs.existsSync(SCHEDULES_FILE)) return [];
    return JSON.parse(fs.readFileSync(SCHEDULES_FILE, "utf-8"));
  } catch { return []; }
}

function saveSchedules(schedules: Schedule[]): void {
  const dir = path.dirname(SCHEDULES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const taskToolDeclarations: FunctionDeclaration[] = [
  {
    name: "create_task_plan",
    description:
      "Creates a multi-step task plan for a goal. Use when user says 'plan karo', 'task banao', 'steps batao', 'goal achieve karna hai', 'project plan do'. Breaks down a goal into ordered steps.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        goal: {
          type: Type.STRING,
          description: "The high-level goal to achieve.",
        },
        steps: {
          type: Type.STRING,
          description: "JSON array of step objects: [{description, tool?, args?, order}]. Each step describes what to do.",
        },
        priority: {
          type: Type.STRING,
          description: "Task priority: 'low', 'medium', 'high', 'critical'. Default 'medium'.",
          enum: ["low", "medium", "high", "critical"],
        },
        max_retries: {
          type: Type.NUMBER,
          description: "Max retry attempts on failure. Default 2.",
        },
        deadline: {
          type: Type.STRING,
          description: "Optional deadline in ISO format or natural language like '2 hours', 'tomorrow'.",
        },
        tags: {
          type: Type.STRING,
          description: "Optional comma-separated tags for categorization.",
        },
      },
      required: ["goal", "steps"],
    },
  },
  {
    name: "list_tasks",
    description:
      "Lists all tasks with their status. Use when user says 'tasks dikhao', 'kya kya pending hai', 'task status batao', 'show tasks'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        status_filter: {
          type: Type.STRING,
          description: "Filter by status: 'pending', 'running', 'completed', 'failed', 'all'. Default 'all'.",
          enum: ["pending", "running", "completed", "failed", "cancelled", "all"],
        },
        limit: {
          type: Type.NUMBER,
          description: "Max tasks to return. Default 10.",
        },
      },
      required: [],
    },
  },
  {
    name: "update_task_status",
    description:
      "Updates the status of a task. Use to mark tasks as completed, cancelled, or failed.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_id: {
          type: Type.STRING,
          description: "The task ID to update.",
        },
        status: {
          type: Type.STRING,
          description: "New status.",
          enum: ["pending", "running", "completed", "failed", "cancelled"],
        },
        result: {
          type: Type.STRING,
          description: "Optional result or notes about the status change.",
        },
      },
      required: ["task_id", "status"],
    },
  },
  {
    name: "delete_task",
    description: "Deletes a task from the task list.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_id: {
          type: Type.STRING,
          description: "The task ID to delete.",
        },
      },
      required: ["task_id"],
    },
  },
  {
    name: "create_schedule",
    description:
      "Creates a scheduled or recurring task. Use when user says 'schedule karo', 'har din X karo', 'X baje remind karo', 'every hour do X', 'trigger-based automation'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: "Schedule name.",
        },
        trigger: {
          type: Type.STRING,
          description: "Trigger type: 'interval' (every N ms), 'once' (run once at a time), 'event' (on a named event).",
          enum: ["interval", "once", "event"],
        },
        interval_minutes: {
          type: Type.NUMBER,
          description: "For 'interval' trigger: how often to run in minutes.",
        },
        run_at: {
          type: Type.STRING,
          description: "For 'once' trigger: when to run (ISO datetime or 'in X minutes').",
        },
        event_name: {
          type: Type.STRING,
          description: "For 'event' trigger: the event name to listen for.",
        },
        action: {
          type: Type.STRING,
          description: "What to do when triggered. Describe the action in plain text.",
        },
      },
      required: ["name", "trigger", "action"],
    },
  },
  {
    name: "list_schedules",
    description: "Lists all scheduled tasks and automations.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
  {
    name: "cancel_schedule",
    description: "Cancels/disables a scheduled task.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        schedule_id: {
          type: Type.STRING,
          description: "The schedule ID to cancel.",
        },
      },
      required: ["schedule_id"],
    },
  },
  {
    name: "analyze_requirements",
    description:
      "Analyzes project requirements and generates architecture, milestones, and task decomposition. Use when user says 'project analyze karo', 'requirements batao', 'architecture generate karo', 'milestones banao'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        project_name: {
          type: Type.STRING,
          description: "Project name.",
        },
        requirements: {
          type: Type.STRING,
          description: "Project requirements description.",
        },
        analysis_result: {
          type: Type.STRING,
          description: "The full analysis including architecture, milestones, tasks, dependencies, and timeline estimate.",
        },
        save_to_file: {
          type: Type.BOOLEAN,
          description: "Save the analysis to Desktop as a markdown file.",
        },
      },
      required: ["project_name", "requirements", "analysis_result"],
    },
  },
];

export const handleTaskAction = async (fc: any, io: Server): Promise<any> => {
  let resultStr = "";
  const args = fc.args as any;

  try {
    if (fc.name === "create_task_plan") {
      const tasks = loadTasks();
      let steps: TaskStep[] = [];

      try {
        const rawSteps = JSON.parse(args.steps);
        steps = rawSteps.map((s: any, i: number) => ({
          id: generateId(),
          description: s.description || `Step ${i + 1}`,
          tool: s.tool,
          args: s.args,
          status: "pending" as const,
          order: s.order ?? i + 1,
        }));
      } catch {
        // If steps is not valid JSON, create a single step
        steps = [{ id: generateId(), description: args.steps, status: "pending", order: 1 }];
      }

      const task: Task = {
        id: generateId(),
        goal: args.goal,
        steps,
        status: "pending",
        priority: args.priority || "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        retries: 0,
        maxRetries: args.max_retries ?? 2,
        tags: args.tags ? args.tags.split(",").map((t: string) => t.trim()) : [],
        deadline: args.deadline,
      };

      tasks.push(task);
      saveTasks(tasks);

      const stepList = steps.map((s, i) => `  ${i + 1}. ${s.description}`).join("\n");
      resultStr = `Task plan created!\nID: ${task.id}\nGoal: ${task.goal}\nPriority: ${task.priority}\nSteps (${steps.length}):\n${stepList}${args.deadline ? `\nDeadline: ${args.deadline}` : ""}`;
      io.emit("system_status", `[TASK] Plan created: ${task.goal.slice(0, 50)}`);
      logActivity("CREATE_TASK_PLAN", { id: task.id, goal: task.goal, steps: steps.length });

    } else if (fc.name === "list_tasks") {
      const tasks = loadTasks();
      const filter = args.status_filter || "all";
      const limit = args.limit || 10;

      const filtered = filter === "all" ? tasks : tasks.filter(t => t.status === filter);
      const recent = filtered.slice(-limit).reverse();

      if (recent.length === 0) {
        resultStr = `No tasks found${filter !== "all" ? ` with status '${filter}'` : ""}.`;
      } else {
        const lines = recent.map(t => {
          const stepsDone = t.steps.filter(s => s.status === "completed").length;
          return `[${t.status.toUpperCase()}] ${t.id.slice(0, 8)} | ${t.goal.slice(0, 60)} | ${stepsDone}/${t.steps.length} steps | ${t.priority}`;
        });
        resultStr = `Tasks (${recent.length}):\n${lines.join("\n")}`;
      }
      io.emit("system_status", `[TASK] Listed ${recent.length} tasks`);

    } else if (fc.name === "update_task_status") {
      const tasks = loadTasks();
      const idx = tasks.findIndex(t => t.id === args.task_id || t.id.startsWith(args.task_id));
      if (idx === -1) {
        resultStr = `Task not found: ${args.task_id}`;
      } else {
        tasks[idx].status = args.status;
        tasks[idx].updatedAt = new Date().toISOString();
        if (args.result) tasks[idx].result = args.result;
        saveTasks(tasks);
        resultStr = `Task ${tasks[idx].id.slice(0, 8)} updated to '${args.status}'.`;
        io.emit("system_status", `[TASK] Updated: ${tasks[idx].goal.slice(0, 40)} → ${args.status}`);
        logActivity("UPDATE_TASK", { id: tasks[idx].id, status: args.status });
      }

    } else if (fc.name === "delete_task") {
      const tasks = loadTasks();
      const idx = tasks.findIndex(t => t.id === args.task_id || t.id.startsWith(args.task_id));
      if (idx === -1) {
        resultStr = `Task not found: ${args.task_id}`;
      } else {
        const removed = tasks.splice(idx, 1)[0];
        saveTasks(tasks);
        resultStr = `Task deleted: ${removed.goal.slice(0, 60)}`;
        io.emit("system_status", `[TASK] Deleted: ${removed.goal.slice(0, 40)}`);
        logActivity("DELETE_TASK", { id: removed.id });
      }

    } else if (fc.name === "create_schedule") {
      const schedules = loadSchedules();
      const schedule: Schedule = {
        id: generateId(),
        name: args.name,
        trigger: args.trigger,
        intervalMs: args.interval_minutes ? args.interval_minutes * 60 * 1000 : undefined,
        runAt: args.run_at,
        eventName: args.event_name,
        action: args.action,
        enabled: true,
        runCount: 0,
      };

      // Set up timer for interval schedules
      if (schedule.trigger === "interval" && schedule.intervalMs) {
        const timer = setInterval(() => {
          const s = loadSchedules().find(s => s.id === schedule.id);
          if (!s || !s.enabled) { clearInterval(timer); scheduleTimers.delete(schedule.id); return; }
          s.lastRun = new Date().toISOString();
          s.runCount++;
          const all = loadSchedules();
          const idx = all.findIndex(x => x.id === s.id);
          if (idx !== -1) { all[idx] = s; saveSchedules(all); }
          io.emit("system_status", `[SCHEDULE] Triggered: ${s.name}`);
          io.emit("transcript_chunk", { role: "AGENT", text: `⏰ Scheduled task triggered: ${s.action}` });
          io.emit("turn_complete");
        }, schedule.intervalMs);
        scheduleTimers.set(schedule.id, timer);
        schedule.nextRun = new Date(Date.now() + schedule.intervalMs).toISOString();
      } else if (schedule.trigger === "once" && schedule.runAt) {
        // Parse "in X minutes" or ISO datetime
        let runMs = 0;
        const inMatch = schedule.runAt.match(/in\s+(\d+)\s*(minute|min|hour|second|sec)/i);
        if (inMatch) {
          const n = parseInt(inMatch[1]);
          const unit = inMatch[2].toLowerCase();
          runMs = unit.startsWith("h") ? n * 3600000 : unit.startsWith("s") ? n * 1000 : n * 60000;
        } else {
          const d = new Date(schedule.runAt);
          runMs = d.getTime() - Date.now();
        }
        if (runMs > 0) {
          const timer = setTimeout(() => {
            io.emit("system_status", `[SCHEDULE] One-time trigger: ${schedule.name}`);
            io.emit("transcript_chunk", { role: "AGENT", text: `⏰ Scheduled task: ${schedule.action}` });
            io.emit("turn_complete");
            // Mark as completed
            const all = loadSchedules();
            const idx = all.findIndex(x => x.id === schedule.id);
            if (idx !== -1) { all[idx].enabled = false; all[idx].runCount++; all[idx].lastRun = new Date().toISOString(); saveSchedules(all); }
          }, runMs);
          scheduleTimers.set(schedule.id, timer as any);
          schedule.nextRun = new Date(Date.now() + runMs).toISOString();
        }
      }

      schedules.push(schedule);
      saveSchedules(schedules);

      resultStr = `Schedule created!\nID: ${schedule.id}\nName: ${schedule.name}\nTrigger: ${schedule.trigger}${schedule.intervalMs ? ` (every ${args.interval_minutes} min)` : ""}${schedule.nextRun ? `\nNext run: ${new Date(schedule.nextRun).toLocaleString()}` : ""}\nAction: ${schedule.action}`;
      io.emit("system_status", `[SCHEDULE] Created: ${schedule.name}`);
      logActivity("CREATE_SCHEDULE", { id: schedule.id, name: schedule.name, trigger: schedule.trigger });

    } else if (fc.name === "list_schedules") {
      const schedules = loadSchedules();
      if (schedules.length === 0) {
        resultStr = "No schedules found.";
      } else {
        const lines = schedules.map(s =>
          `[${s.enabled ? "ON" : "OFF"}] ${s.id.slice(0, 8)} | ${s.name} | ${s.trigger} | runs: ${s.runCount} | ${s.action.slice(0, 50)}`
        );
        resultStr = `Schedules (${schedules.length}):\n${lines.join("\n")}`;
      }
      io.emit("system_status", `[SCHEDULE] Listed ${schedules.length} schedules`);

    } else if (fc.name === "cancel_schedule") {
      const schedules = loadSchedules();
      const idx = schedules.findIndex(s => s.id === args.schedule_id || s.id.startsWith(args.schedule_id));
      if (idx === -1) {
        resultStr = `Schedule not found: ${args.schedule_id}`;
      } else {
        schedules[idx].enabled = false;
        saveSchedules(schedules);
        // Clear timer
        const timer = scheduleTimers.get(schedules[idx].id);
        if (timer) { clearInterval(timer as any); scheduleTimers.delete(schedules[idx].id); }
        resultStr = `Schedule '${schedules[idx].name}' cancelled.`;
        io.emit("system_status", `[SCHEDULE] Cancelled: ${schedules[idx].name}`);
        logActivity("CANCEL_SCHEDULE", { id: schedules[idx].id });
      }

    } else if (fc.name === "analyze_requirements") {
      const analysis = args.analysis_result;
      if (args.save_to_file) {
        const safeName = args.project_name.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_").slice(0, 40);
        const timestamp = new Date().toISOString().slice(0, 10);
        const savePath = path.join(os.homedir(), "Desktop", `${safeName}_analysis_${timestamp}.md`);
        const content = `# Project Analysis: ${args.project_name}\n\nDate: ${new Date().toLocaleDateString()}\n\n---\n\n## Requirements\n\n${args.requirements}\n\n---\n\n## Analysis\n\n${analysis}`;
        fs.writeFileSync(savePath, content, "utf-8");
        resultStr = `Analysis complete and saved to: ${savePath}\n\n${analysis.slice(0, 1000)}`;
        io.emit("system_status", `[TASK] Analysis saved: ${path.basename(savePath)}`);
      } else {
        resultStr = `Analysis for '${args.project_name}':\n\n${analysis}`;
        io.emit("system_status", `[TASK] Requirements analyzed: ${args.project_name}`);
      }
      logActivity("ANALYZE_REQUIREMENTS", { project: args.project_name });
    }
  } catch (err: any) {
    resultStr = `Error: ${err.message}`;
    io.emit("system_status", `[TASK ERROR] ${err.message?.slice(0, 80)}`);
  }

  return { id: fc.id, name: fc.name, response: { result: resultStr } };
};
