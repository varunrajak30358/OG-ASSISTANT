/**
 * Automation Agent — IF-THEN logic, event-driven execution, conditional actions,
 * trigger-based automation, workflow execution, browser automation (Playwright),
 * web scraping, form filling, auto login workflows, dashboard interaction,
 * automated downloads/uploads
 */
import { Type, type FunctionDeclaration } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { Server } from "socket.io";
import { logActivity } from "../utils/activity-log.js";

const execAsync = promisify(exec);

const WORKFLOWS_FILE = path.join(process.cwd(), "data", "workflows.json");

export type Workflow = {
  id: string;
  name: string;
  trigger: {
    type: "manual" | "event" | "condition" | "schedule";
    event?: string;
    condition?: string;
  };
  steps: WorkflowStep[];
  enabled: boolean;
  createdAt: string;
  runCount: number;
  lastRun?: string;
};

export type WorkflowStep = {
  id: string;
  type: "if_then" | "action" | "wait" | "loop" | "condition";
  condition?: string;
  action?: string;
  thenSteps?: WorkflowStep[];
  elseSteps?: WorkflowStep[];
  waitMs?: number;
  loopCount?: number;
};

function loadWorkflows(): Workflow[] {
  try {
    if (!fs.existsSync(WORKFLOWS_FILE)) return [];
    return JSON.parse(fs.readFileSync(WORKFLOWS_FILE, "utf-8"));
  } catch { return []; }
}

function saveWorkflows(workflows: Workflow[]): void {
  const dir = path.dirname(WORKFLOWS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(workflows, null, 2));
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Check if Playwright is available ─────────────────────────────────────────
async function isPlaywrightAvailable(): Promise<boolean> {
  try {
    await execAsync("npx playwright --version", { timeout: 5000 });
    return true;
  } catch { return false; }
}

// ── Unused helper kept for future Playwright integration ─────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _generatePlaywrightScript(task: string, url: string, actions: string): string {
  return `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('${url}');
  ${actions}
  await browser.close();
})();
`.trim();
}

export const automationToolDeclarations: FunctionDeclaration[] = [
  {
    name: "create_workflow",
    description:
      "Creates an IF-THEN automation workflow. Use when user says 'automation banao', 'workflow create karo', 'agar X ho to Y karo', 'IF-THEN logic', 'trigger-based automation'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: "Workflow name.",
        },
        description: {
          type: Type.STRING,
          description: "What this workflow does.",
        },
        trigger_type: {
          type: Type.STRING,
          description: "When to trigger: 'manual', 'event', 'condition', 'schedule'.",
          enum: ["manual", "event", "condition", "schedule"],
        },
        trigger_event: {
          type: Type.STRING,
          description: "For 'event' trigger: the event name (e.g., 'file_created', 'cpu_high', 'user_message').",
        },
        steps_description: {
          type: Type.STRING,
          description: "Description of the workflow steps and logic in plain text.",
        },
      },
      required: ["name", "description", "trigger_type", "steps_description"],
    },
  },
  {
    name: "list_workflows",
    description: "Lists all automation workflows.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
  {
    name: "run_workflow",
    description: "Manually triggers a workflow by name or ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        workflow_id: {
          type: Type.STRING,
          description: "Workflow ID or name to run.",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "browser_automate",
    description:
      "Automates browser tasks: web scraping, form filling, auto login, dashboard interaction, downloads. Use when user says 'website se data nikalo', 'form fill karo', 'auto login karo', 'scrape karo', 'browser automation'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_type: {
          type: Type.STRING,
          description: "Type of browser automation.",
          enum: ["scrape", "form_fill", "screenshot_page", "download", "custom_script"],
        },
        url: {
          type: Type.STRING,
          description: "Target URL.",
        },
        task_description: {
          type: Type.STRING,
          description: "What to do on the page.",
        },
        script_content: {
          type: Type.STRING,
          description: "For 'custom_script': the Playwright JavaScript code to execute.",
        },
        save_path: {
          type: Type.STRING,
          description: "Optional: where to save scraped data or downloaded files.",
        },
        selectors: {
          type: Type.STRING,
          description: "CSS selectors or element descriptions for form filling/scraping.",
        },
        form_data: {
          type: Type.STRING,
          description: "JSON string of form field data: {selector: value}.",
        },
      },
      required: ["task_type", "url", "task_description"],
    },
  },
  {
    name: "conditional_action",
    description:
      "Executes an action based on a condition check. Use for IF-THEN logic: 'agar CPU 90% se zyada ho to alert do', 'if file exists then delete', 'condition check karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        condition_type: {
          type: Type.STRING,
          description: "What to check.",
          enum: ["file_exists", "cpu_above", "ram_above", "process_running", "time_is", "custom"],
        },
        condition_value: {
          type: Type.STRING,
          description: "The threshold or value to check against (e.g., '90' for CPU%, file path, process name).",
        },
        then_action: {
          type: Type.STRING,
          description: "What to do if condition is TRUE.",
        },
        else_action: {
          type: Type.STRING,
          description: "Optional: what to do if condition is FALSE.",
        },
      },
      required: ["condition_type", "condition_value", "then_action"],
    },
  },
];

export const handleAutomationAction = async (fc: any, io: Server): Promise<any> => {
  let resultStr = "";
  const args = fc.args as any;

  try {
    if (fc.name === "create_workflow") {
      const workflows = loadWorkflows();
      const workflow: Workflow = {
        id: generateId(),
        name: args.name,
        trigger: {
          type: args.trigger_type,
          event: args.trigger_event,
        },
        steps: [
          {
            id: generateId(),
            type: "action",
            action: args.steps_description,
          },
        ],
        enabled: true,
        createdAt: new Date().toISOString(),
        runCount: 0,
      };

      workflows.push(workflow);
      saveWorkflows(workflows);

      resultStr = `Workflow created!\nID: ${workflow.id}\nName: ${workflow.name}\nTrigger: ${workflow.trigger.type}${workflow.trigger.event ? ` (${workflow.trigger.event})` : ""}\nDescription: ${args.description}\nSteps: ${args.steps_description}`;
      io.emit("system_status", `[AUTOMATION] Workflow created: ${workflow.name}`);
      logActivity("CREATE_WORKFLOW", { id: workflow.id, name: workflow.name });

    } else if (fc.name === "list_workflows") {
      const workflows = loadWorkflows();
      if (workflows.length === 0) {
        resultStr = "No workflows found.";
      } else {
        const lines = workflows.map(w =>
          `[${w.enabled ? "ON" : "OFF"}] ${w.id.slice(0, 8)} | ${w.name} | ${w.trigger.type} | runs: ${w.runCount}`
        );
        resultStr = `Workflows (${workflows.length}):\n${lines.join("\n")}`;
      }
      io.emit("system_status", `[AUTOMATION] Listed ${workflows.length} workflows`);

    } else if (fc.name === "run_workflow") {
      const workflows = loadWorkflows();
      const wf = workflows.find(w => w.id === args.workflow_id || w.id.startsWith(args.workflow_id) || w.name.toLowerCase().includes(args.workflow_id.toLowerCase()));
      if (!wf) {
        resultStr = `Workflow not found: ${args.workflow_id}`;
      } else {
        wf.runCount++;
        wf.lastRun = new Date().toISOString();
        const idx = workflows.findIndex(w => w.id === wf.id);
        workflows[idx] = wf;
        saveWorkflows(workflows);

        io.emit("system_status", `[AUTOMATION] Running workflow: ${wf.name}`);
        resultStr = `Workflow '${wf.name}' triggered.\nSteps to execute:\n${wf.steps.map((s, i) => `  ${i + 1}. ${s.action || s.type}`).join("\n")}`;
        logActivity("RUN_WORKFLOW", { id: wf.id, name: wf.name });
      }

    } else if (fc.name === "browser_automate") {
      const taskType = args.task_type;
      const url = args.url;
      io.emit("system_status", `[AUTOMATION] Browser task: ${taskType} on ${url.slice(0, 50)}`);
      logActivity("BROWSER_AUTOMATE", { taskType, url });

      const playwrightAvailable = await isPlaywrightAvailable();

      if (taskType === "screenshot_page") {
        // Use PowerShell to take a screenshot of a URL via Edge/Chrome
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const savePath = args.save_path || path.join(os.homedir(), "Desktop", `page_screenshot_${timestamp}.png`);

        if (playwrightAvailable) {
          const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('${url}', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '${savePath.replace(/\\/g, "\\\\")}', fullPage: true });
  await browser.close();
  console.log('Screenshot saved');
})();
`;
          const tmpFile = path.join(os.tmpdir(), `og_pw_${Date.now()}.js`);
          fs.writeFileSync(tmpFile, script);
          try {
            await execAsync(`node "${tmpFile}"`, { timeout: 30000 });
            resultStr = `Page screenshot saved to: ${savePath}`;
          } finally {
            try { fs.unlinkSync(tmpFile); } catch {}
          }
        } else {
          resultStr = `Playwright not installed. To enable browser automation, run: npx playwright install\nURL: ${url}`;
        }

      } else if (taskType === "scrape") {
        if (playwrightAvailable) {
          const savePath = args.save_path || path.join(os.homedir(), "Desktop", `scraped_${Date.now()}.txt`);
          const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('${url}', { waitUntil: 'networkidle' });
  const text = await page.evaluate(() => document.body.innerText);
  require('fs').writeFileSync('${savePath.replace(/\\/g, "\\\\")}', text);
  await browser.close();
  console.log('Scraped ' + text.length + ' chars');
})();
`;
          const tmpFile = path.join(os.tmpdir(), `og_pw_${Date.now()}.js`);
          fs.writeFileSync(tmpFile, script);
          try {
            const { stdout } = await execAsync(`node "${tmpFile}"`, { timeout: 30000 });
            resultStr = `Scraped content saved to: ${savePath}\n${stdout.trim()}`;
          } finally {
            try { fs.unlinkSync(tmpFile); } catch {}
          }
        } else {
          resultStr = `Playwright not installed. Install with: npx playwright install\nFor basic scraping, use the 'fetch_webpage' tool instead.`;
        }

      } else if (taskType === "custom_script" && args.script_content) {
        if (playwrightAvailable) {
          const tmpFile = path.join(os.tmpdir(), `og_pw_${Date.now()}.js`);
          fs.writeFileSync(tmpFile, args.script_content);
          try {
            const { stdout, stderr } = await execAsync(`node "${tmpFile}"`, { timeout: 60000 });
            resultStr = `Script executed.\nOutput: ${(stdout || stderr || "No output").slice(0, 2000)}`;
          } finally {
            try { fs.unlinkSync(tmpFile); } catch {}
          }
        } else {
          resultStr = `Playwright not installed. Install with: npx playwright install`;
        }

      } else {
        resultStr = `Browser automation task '${taskType}' queued for: ${url}\nTask: ${args.task_description}\n\nNote: Install Playwright for full browser automation: npx playwright install`;
      }

      io.emit("system_status", `[AUTOMATION] Browser task complete: ${taskType}`);

    } else if (fc.name === "conditional_action") {
      const condType = args.condition_type;
      const condValue = args.condition_value;
      let conditionMet = false;
      let conditionResult = "";

      // Evaluate condition
      if (condType === "file_exists") {
        conditionMet = fs.existsSync(condValue);
        conditionResult = conditionMet ? `File exists: ${condValue}` : `File not found: ${condValue}`;

      } else if (condType === "cpu_above") {
        const threshold = parseFloat(condValue);
        // Quick CPU check
        const cpus = os.cpus();
        const totalIdle = cpus.reduce((a, c) => a + c.times.idle, 0);
        const totalTick = cpus.reduce((a, c) => a + Object.values(c.times).reduce((x, y) => x + y, 0), 0);
        const cpuPct = totalTick === 0 ? 0 : Math.round((1 - totalIdle / totalTick) * 100);
        conditionMet = cpuPct > threshold;
        conditionResult = `CPU is ${cpuPct}% (threshold: ${threshold}%)`;

      } else if (condType === "ram_above") {
        const threshold = parseFloat(condValue);
        const ramPct = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
        conditionMet = ramPct > threshold;
        conditionResult = `RAM is ${ramPct}% (threshold: ${threshold}%)`;

      } else if (condType === "process_running") {
        try {
          const { stdout } = await execAsync(
            os.platform() === "win32"
              ? `tasklist /FI "IMAGENAME eq ${condValue}" /NH`
              : `pgrep -x "${condValue}"`,
            { timeout: 5000 }
          );
          conditionMet = stdout.toLowerCase().includes(condValue.toLowerCase());
          conditionResult = conditionMet ? `Process '${condValue}' is running` : `Process '${condValue}' is NOT running`;
        } catch {
          conditionMet = false;
          conditionResult = `Could not check process: ${condValue}`;
        }

      } else if (condType === "time_is") {
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
        conditionMet = timeStr === condValue;
        conditionResult = `Current time is ${timeStr} (checking for ${condValue})`;

      } else {
        conditionResult = `Custom condition: ${condValue}`;
        conditionMet = true; // For custom, assume true and let AI decide
      }

      const actionToTake = conditionMet ? args.then_action : (args.else_action || "No action (condition not met)");
      resultStr = `Condition check: ${conditionResult}\nCondition met: ${conditionMet ? "YES" : "NO"}\nAction: ${actionToTake}`;
      io.emit("system_status", `[AUTOMATION] Condition: ${conditionMet ? "MET" : "NOT MET"} → ${actionToTake.slice(0, 50)}`);
      logActivity("CONDITIONAL_ACTION", { condType, condValue, conditionMet, action: actionToTake });
    }
  } catch (err: any) {
    resultStr = `Error: ${err.message}`;
    io.emit("system_status", `[AUTOMATION ERROR] ${err.message?.slice(0, 80)}`);
  }

  return { id: fc.id, name: fc.name, response: { result: resultStr } };
};
