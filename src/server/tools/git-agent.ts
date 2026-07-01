/**
 * Git Agent — full git automation tool
 * Handles status, commit, push, pull, clone, branch, diff, log, stash
 */
import { Type, type FunctionDeclaration } from "@google/genai";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as os from "os";
import { Server } from "socket.io";
import { logActivity } from "../utils/activity-log.js";

const execAsync = promisify(exec);

async function git(cmd: string, cwd: string): Promise<string> {
  const { stdout, stderr } = await execAsync(`git ${cmd}`, {
    cwd,
    timeout: 60000,
    maxBuffer: 1024 * 512,
  });
  return (stdout || "").trim() || (stderr || "").trim();
}

export const gitToolDeclarations: FunctionDeclaration[] = [
  {
    name: "git_action",
    description:
      "Performs git operations: status, add, commit, push, pull, clone, branch, checkout, diff, log, stash, init. Use when user says 'git commit', 'push karo', 'git status', 'clone this repo', etc.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "Git action to perform.",
          enum: [
            "status", "add", "commit", "push", "pull", "clone",
            "branch", "checkout", "diff", "log", "stash", "stash_pop",
            "init", "remote_add", "fetch", "merge", "reset_soft",
          ],
        },
        repo_path: {
          type: Type.STRING,
          description: "Path to the git repository. Defaults to current working directory.",
        },
        message: {
          type: Type.STRING,
          description: "Commit message (for 'commit' action).",
        },
        branch_name: {
          type: Type.STRING,
          description: "Branch name (for 'branch', 'checkout' actions).",
        },
        remote_url: {
          type: Type.STRING,
          description: "Remote URL (for 'clone' or 'remote_add' actions).",
        },
        remote_name: {
          type: Type.STRING,
          description: "Remote name, default 'origin'.",
        },
        files: {
          type: Type.STRING,
          description: "Files to add (for 'add' action). Use '.' for all files.",
        },
        num_commits: {
          type: Type.NUMBER,
          description: "Number of commits to show in log. Default 10.",
        },
      },
      required: ["action"],
    },
  },
];

export const handleGitAction = async (fc: any, io: Server): Promise<any> => {
  let resultStr = "";
  const args = fc.args as any;
  const repoPath = args.repo_path || process.cwd();
  const action = args.action as string;

  io.emit("system_status", `[GIT] ${action.toUpperCase()}: ${path.basename(repoPath)}`);
  logActivity("GIT_ACTION", { action, repoPath });

  try {
    switch (action) {
      case "status":
        resultStr = await git("status", repoPath);
        break;

      case "add":
        const files = args.files || ".";
        resultStr = await git(`add ${files}`, repoPath);
        resultStr = resultStr || `Added: ${files}`;
        break;

      case "commit":
        if (!args.message) {
          resultStr = "Error: commit message is required.";
          break;
        }
        resultStr = await git(`commit -m "${args.message.replace(/"/g, "'")}"`, repoPath);
        break;

      case "push":
        const pushRemote = args.remote_name || "origin";
        const pushBranch = args.branch_name || "";
        resultStr = await git(`push ${pushRemote} ${pushBranch}`.trim(), repoPath);
        break;

      case "pull":
        const pullRemote = args.remote_name || "origin";
        resultStr = await git(`pull ${pullRemote}`.trim(), repoPath);
        break;

      case "clone":
        if (!args.remote_url) {
          resultStr = "Error: remote_url is required for clone.";
          break;
        }
        const cloneDir = args.repo_path || os.homedir();
        resultStr = await git(`clone ${args.remote_url}`, cloneDir);
        break;

      case "branch":
        if (args.branch_name) {
          resultStr = await git(`branch ${args.branch_name}`, repoPath);
          resultStr = resultStr || `Branch '${args.branch_name}' created.`;
        } else {
          resultStr = await git("branch -a", repoPath);
        }
        break;

      case "checkout":
        if (!args.branch_name) {
          resultStr = "Error: branch_name is required for checkout.";
          break;
        }
        resultStr = await git(`checkout ${args.branch_name}`, repoPath);
        break;

      case "diff":
        resultStr = await git("diff --stat HEAD", repoPath);
        if (!resultStr) resultStr = await git("diff", repoPath);
        resultStr = resultStr.slice(0, 3000) || "No changes.";
        break;

      case "log":
        const n = args.num_commits || 10;
        resultStr = await git(`log --oneline -${n}`, repoPath);
        break;

      case "stash":
        resultStr = await git("stash", repoPath);
        break;

      case "stash_pop":
        resultStr = await git("stash pop", repoPath);
        break;

      case "init":
        resultStr = await git("init", repoPath);
        break;

      case "remote_add":
        if (!args.remote_url) {
          resultStr = "Error: remote_url is required.";
          break;
        }
        const remoteName = args.remote_name || "origin";
        resultStr = await git(`remote add ${remoteName} ${args.remote_url}`, repoPath);
        resultStr = resultStr || `Remote '${remoteName}' added.`;
        break;

      case "fetch":
        resultStr = await git("fetch --all", repoPath);
        break;

      case "merge":
        if (!args.branch_name) {
          resultStr = "Error: branch_name is required for merge.";
          break;
        }
        resultStr = await git(`merge ${args.branch_name}`, repoPath);
        break;

      case "reset_soft":
        resultStr = await git("reset --soft HEAD~1", repoPath);
        resultStr = resultStr || "Last commit undone (files kept staged).";
        break;

      default:
        resultStr = `Unknown git action: ${action}`;
    }

    io.emit("system_status", `[GIT] ${action} complete`);
  } catch (err: any) {
    resultStr = `Git error: ${err.message}`;
    io.emit("system_status", `[GIT ERROR] ${err.message?.slice(0, 80)}`);
  }

  return { id: fc.id, name: fc.name, response: { result: resultStr } };
};
