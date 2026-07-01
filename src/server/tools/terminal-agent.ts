/**
 * Terminal Agent — execute shell/PowerShell commands with safety gating
 * Dangerous commands are blocked unless explicitly whitelisted by the user.
 */
import { Type, type FunctionDeclaration } from "@google/genai";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";
import { Server } from "socket.io";
import { logActivity } from "../utils/activity-log.js";

const execAsync = promisify(exec);

// ── Dangerous pattern blocklist ───────────────────────────────────────────────
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//i,
  /format\s+[a-z]:/i,
  /del\s+\/[sf]/i,
  /rmdir\s+\/s\s+\/q\s+[a-z]:\\/i,
  /shutdown\s+\/[sr]/i,   // handled by system-agent with PIN
  /reg\s+delete/i,
  /bcdedit/i,
  /diskpart/i,
  /cipher\s+\/w/i,
  /netsh\s+firewall/i,
  /sc\s+delete/i,
  /taskkill\s+\/f\s+\/im\s+system/i,
  /drop\s+database/i,
  /truncate\s+table/i,
  />\s*\/dev\/sda/i,
  /dd\s+if=.*of=\/dev\/(sd|hd)/i,
];

function isDangerous(cmd: string): string | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(cmd)) {
      return `Blocked: command matches dangerous pattern (${pattern.source})`;
    }
  }
  return null;
}

export const terminalToolDeclarations: FunctionDeclaration[] = [
  {
    name: "execute_command",
    description:
      "Executes a shell command or PowerShell script on the local system. Use for running scripts, installing packages, checking git status, running builds, etc. Returns stdout and stderr.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "The shell command to execute, e.g., 'npm install', 'git status', 'python script.py'",
        },
        working_dir: {
          type: Type.STRING,
          description: "Optional: working directory to run the command in. Defaults to user home.",
        },
        use_powershell: {
          type: Type.BOOLEAN,
          description: "Set to true to run via PowerShell instead of cmd. Default false.",
        },
        timeout_seconds: {
          type: Type.NUMBER,
          description: "Max seconds to wait for command. Default 30, max 120.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "run_python",
    description:
      "Executes a Python script or inline Python code. Use for data processing, ML tasks, calculations, etc.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        code: {
          type: Type.STRING,
          description: "Python code to execute (inline) OR a path to a .py file.",
        },
        is_file: {
          type: Type.BOOLEAN,
          description: "Set to true if 'code' is a file path. Default false (inline code).",
        },
        working_dir: {
          type: Type.STRING,
          description: "Optional working directory.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "install_package",
    description:
      "Installs a package using npm, pip, or winget. Use when user says 'install X', 'npm install X', 'pip install X'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        package_name: {
          type: Type.STRING,
          description: "Package name to install, e.g., 'express', 'numpy', 'vscode'",
        },
        manager: {
          type: Type.STRING,
          description: "Package manager: 'npm', 'pip', 'winget', 'yarn', 'pnpm'. Auto-detected if not specified.",
          enum: ["npm", "pip", "winget", "yarn", "pnpm", "auto"],
        },
        working_dir: {
          type: Type.STRING,
          description: "Optional: directory to run npm/yarn install in.",
        },
      },
      required: ["package_name"],
    },
  },
];

export const handleTerminalAction = async (fc: any, io: Server): Promise<any> => {
  let resultStr = "";
  const args = fc.args as any;
  const platform = os.platform();

  try {
    if (fc.name === "execute_command") {
      const cmd = (args.command || "").trim();
      const workDir = args.working_dir || os.homedir();
      const usePwsh = args.use_powershell === true;
      const timeoutMs = Math.min((args.timeout_seconds || 30), 120) * 1000;

      // Safety check
      const danger = isDangerous(cmd);
      if (danger) {
        resultStr = `⛔ ${danger}. This command has been blocked for safety.`;
        io.emit("system_status", `[TERMINAL] BLOCKED: ${cmd.slice(0, 60)}`);
        logActivity("BLOCKED_COMMAND", { command: cmd, reason: danger });
        return { id: fc.id, name: fc.name, response: { result: resultStr } };
      }

      io.emit("system_status", `[TERMINAL] Running: ${cmd.slice(0, 80)}`);
      logActivity("EXECUTE_COMMAND", { command: cmd, workDir });

      let fullCmd: string;
      if (usePwsh || platform === "win32") {
        fullCmd = usePwsh
          ? `powershell -NoProfile -NonInteractive -Command "${cmd.replace(/"/g, '\\"')}"`
          : cmd;
      } else {
        fullCmd = cmd;
      }

      const { stdout, stderr } = await execAsync(fullCmd, {
        cwd: workDir,
        timeout: timeoutMs,
        maxBuffer: 1024 * 512, // 512KB
      });

      const out = (stdout || "").trim();
      const err = (stderr || "").trim();

      if (out && err) {
        resultStr = `Output:\n${out.slice(0, 3000)}\n\nStderr:\n${err.slice(0, 500)}`;
      } else if (out) {
        resultStr = out.slice(0, 3500);
      } else if (err) {
        resultStr = `Stderr:\n${err.slice(0, 1000)}`;
      } else {
        resultStr = "Command completed with no output.";
      }

      io.emit("system_status", `[TERMINAL] Done: ${cmd.slice(0, 60)}`);

    } else if (fc.name === "run_python") {
      const isFile = args.is_file === true;
      const workDir = args.working_dir || os.homedir();

      if (isFile) {
        const filePath = args.code;
        io.emit("system_status", `[PYTHON] Running file: ${path.basename(filePath)}`);
        const { stdout, stderr } = await execAsync(`python "${filePath}"`, {
          cwd: workDir,
          timeout: 60000,
          maxBuffer: 1024 * 512,
        });
        resultStr = (stdout || "").trim() || (stderr || "").trim() || "Script completed.";
      } else {
        // Inline code — write to temp file and run
        const tmpFile = path.join(os.tmpdir(), `og_py_${Date.now()}.py`);
        const fs = await import("fs");
        fs.writeFileSync(tmpFile, args.code, "utf-8");
        io.emit("system_status", `[PYTHON] Running inline code...`);
        try {
          const { stdout, stderr } = await execAsync(`python "${tmpFile}"`, {
            cwd: workDir,
            timeout: 60000,
            maxBuffer: 1024 * 512,
          });
          resultStr = (stdout || "").trim() || (stderr || "").trim() || "Code executed.";
        } finally {
          try { fs.unlinkSync(tmpFile); } catch {}
        }
      }
      io.emit("system_status", `[PYTHON] Execution complete`);

    } else if (fc.name === "install_package") {
      const pkg = args.package_name;
      let manager = (args.manager || "auto").toLowerCase();
      const workDir = args.working_dir || process.cwd();

      // Auto-detect manager
      if (manager === "auto") {
        if (pkg.includes("/") || pkg.startsWith("@")) manager = "npm";
        else if (pkg.includes("-") && platform === "win32") manager = "winget";
        else manager = "npm";
      }

      const cmds: Record<string, string> = {
        npm:   `npm install ${pkg}`,
        yarn:  `yarn add ${pkg}`,
        pnpm:  `pnpm add ${pkg}`,
        pip:   `pip install ${pkg}`,
        winget: `winget install ${pkg}`,
      };

      const installCmd = cmds[manager];
      if (!installCmd) {
        resultStr = `Unknown package manager: ${manager}`;
      } else {
        io.emit("system_status", `[TERMINAL] Installing ${pkg} via ${manager}...`);
        logActivity("INSTALL_PACKAGE", { package: pkg, manager });
        const { stdout, stderr } = await execAsync(installCmd, {
          cwd: workDir,
          timeout: 120000,
          maxBuffer: 1024 * 1024,
        });
        resultStr = (stdout || "").trim().slice(0, 2000) || (stderr || "").trim().slice(0, 500) || `${pkg} installed via ${manager}.`;
        io.emit("system_status", `[TERMINAL] Installed: ${pkg}`);
      }
    }
  } catch (err: any) {
    resultStr = `Error: ${err.message}`;
    if (err.stdout) resultStr += `\nOutput: ${err.stdout.slice(0, 500)}`;
    if (err.stderr) resultStr += `\nStderr: ${err.stderr.slice(0, 500)}`;
    io.emit("system_status", `[TERMINAL ERROR] ${err.message?.slice(0, 80)}`);
  }

  return { id: fc.id, name: fc.name, response: { result: resultStr } };
};
