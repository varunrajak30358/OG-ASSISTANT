/**
 * Developer Agent — VS Code integration, GitHub integration, live code monitoring,
 * auto testing, CI/CD automation, Docker container execution, sandbox runtime,
 * dependency installation, API integration, auto documentation
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

export const developerToolDeclarations: FunctionDeclaration[] = [
  {
    name: "vscode_action",
    description:
      "VS Code integration: open files, folders, extensions, run tasks. Use when user says 'VS Code mein kholo', 'open in VS Code', 'code editor mein open karo', 'VS Code extension install karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "VS Code action.",
          enum: ["open_file", "open_folder", "install_extension", "run_task", "open_terminal"],
        },
        target: {
          type: Type.STRING,
          description: "File/folder path, extension ID, or task name.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "github_action",
    description:
      "GitHub integration: create repo, list repos, create issue, create PR, fork repo. Use when user says 'GitHub pe repo banao', 'issue create karo', 'PR banao', 'fork karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "GitHub action.",
          enum: ["create_repo", "list_repos", "create_issue", "create_pr", "clone_repo", "open_repo"],
        },
        repo_name: { type: Type.STRING, description: "Repository name." },
        description: { type: Type.STRING, description: "Repository or issue description." },
        is_private: { type: Type.BOOLEAN, description: "Make repo private. Default false." },
        title: { type: Type.STRING, description: "Issue or PR title." },
        body: { type: Type.STRING, description: "Issue or PR body." },
        repo_url: { type: Type.STRING, description: "Repository URL for clone/open." },
        username: { type: Type.STRING, description: "GitHub username. Uses GITHUB_USERNAME env var if not provided." },
      },
      required: ["action"],
    },
  },
  {
    name: "docker_action",
    description:
      "Docker container management: run, stop, list, build, exec. Use when user says 'Docker container chalao', 'Docker build karo', 'container stop karo', 'Docker mein run karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "Docker action.",
          enum: ["run", "stop", "list", "build", "exec", "pull", "logs", "remove"],
        },
        image: { type: Type.STRING, description: "Docker image name (for run/pull/build)." },
        container_id: { type: Type.STRING, description: "Container ID or name (for stop/exec/logs/remove)." },
        command: { type: Type.STRING, description: "Command to run inside container (for exec) or run args." },
        dockerfile_path: { type: Type.STRING, description: "Path to Dockerfile (for build)." },
        tag: { type: Type.STRING, description: "Image tag for build. Default 'latest'." },
        ports: { type: Type.STRING, description: "Port mapping like '8080:80' (for run)." },
        detach: { type: Type.BOOLEAN, description: "Run container in background. Default true." },
      },
      required: ["action"],
    },
  },
  {
    name: "run_tests",
    description:
      "Runs tests for a project. Use when user says 'tests chalao', 'unit tests run karo', 'test suite execute karo', 'testing karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        project_path: { type: Type.STRING, description: "Path to the project. Defaults to current directory." },
        test_framework: {
          type: Type.STRING,
          description: "Test framework to use.",
          enum: ["auto", "jest", "vitest", "pytest", "mocha", "npm_test"],
        },
        test_pattern: { type: Type.STRING, description: "Optional: specific test file or pattern to run." },
      },
      required: [],
    },
  },
  {
    name: "generate_api_docs",
    description:
      "Generates API documentation from code. Use when user says 'API docs banao', 'documentation generate karo', 'swagger generate karo', 'API document karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        source_path: { type: Type.STRING, description: "Path to source code directory or file." },
        doc_format: {
          type: Type.STRING,
          description: "Documentation format.",
          enum: ["markdown", "jsdoc", "openapi_stub"],
        },
        output_path: { type: Type.STRING, description: "Where to save docs. Defaults to Desktop." },
        doc_content: { type: Type.STRING, description: "The generated documentation content." },
      },
      required: ["source_path", "doc_format", "doc_content"],
    },
  },
];

export const handleDeveloperAction = async (fc: any, io: Server): Promise<any> => {
  let resultStr = "";
  const args = fc.args as any;
  const platform = os.platform();

  try {
    if (fc.name === "vscode_action") {
      const action = args.action;
      io.emit("system_status", `[DEV] VS Code: ${action}`);
      logActivity("VSCODE_ACTION", { action, target: args.target });

      if (action === "open_file" || action === "open_folder") {
        const target = args.target || ".";
        await execAsync(`code "${target}"`);
        resultStr = `Opened in VS Code: ${target}`;
      } else if (action === "install_extension") {
        const ext = args.target;
        if (!ext) { resultStr = "Error: extension ID required."; }
        else {
          const { stdout } = await execAsync(`code --install-extension ${ext}`);
          resultStr = `Extension installed: ${ext}\n${stdout.trim()}`;
        }
      } else if (action === "run_task") {
        await execAsync(`code --command workbench.action.tasks.runTask`);
        resultStr = "VS Code task runner opened.";
      } else if (action === "open_terminal") {
        await execAsync(`code --command workbench.action.terminal.new`);
        resultStr = "VS Code terminal opened.";
      }

    } else if (fc.name === "github_action") {
      const action = args.action;
      const username = args.username || process.env.GITHUB_USERNAME;
      io.emit("system_status", `[DEV] GitHub: ${action}`);
      logActivity("GITHUB_ACTION", { action });

      if (action === "open_repo" && args.repo_url) {
        if (platform === "win32") await execAsync(`start "" "${args.repo_url}"`);
        else if (platform === "darwin") await execAsync(`open "${args.repo_url}"`);
        else await execAsync(`xdg-open "${args.repo_url}"`);
        resultStr = `Opened: ${args.repo_url}`;

      } else if (action === "clone_repo" && args.repo_url) {
        const cloneDir = os.homedir();
        await execAsync(`git clone ${args.repo_url}`, { cwd: cloneDir, timeout: 60000 });
        resultStr = `Cloned: ${args.repo_url}`;

      } else if (action === "create_repo") {
        const repoName = args.repo_name;
        if (!repoName) { resultStr = "Error: repo_name required."; }
        else {
          const ghUrl = `https://github.com/new?name=${encodeURIComponent(repoName)}&description=${encodeURIComponent(args.description || "")}&visibility=${args.is_private ? "private" : "public"}`;
          if (platform === "win32") await execAsync(`start "" "${ghUrl}"`);
          else if (platform === "darwin") await execAsync(`open "${ghUrl}"`);
          else await execAsync(`xdg-open "${ghUrl}"`);
          resultStr = `GitHub new repo page opened for: ${repoName}`;
        }

      } else if (action === "list_repos") {
        const profileUrl = username ? `https://github.com/${username}?tab=repositories` : "https://github.com";
        if (platform === "win32") await execAsync(`start "" "${profileUrl}"`);
        else if (platform === "darwin") await execAsync(`open "${profileUrl}"`);
        else await execAsync(`xdg-open "${profileUrl}"`);
        resultStr = `GitHub repos page opened${username ? ` for ${username}` : ""}.`;

      } else if (action === "create_issue" && args.repo_url) {
        const issueUrl = `${args.repo_url}/issues/new?title=${encodeURIComponent(args.title || "")}&body=${encodeURIComponent(args.body || "")}`;
        if (platform === "win32") await execAsync(`start "" "${issueUrl}"`);
        else if (platform === "darwin") await execAsync(`open "${issueUrl}"`);
        else await execAsync(`xdg-open "${issueUrl}"`);
        resultStr = `GitHub issue creation page opened.`;

      } else {
        resultStr = `GitHub action '${action}' requires additional parameters. Please provide repo_url or repo_name.`;
      }

    } else if (fc.name === "docker_action") {
      const action = args.action;
      io.emit("system_status", `[DEV] Docker: ${action}`);
      logActivity("DOCKER_ACTION", { action });

      const dockerCmds: Record<string, () => Promise<string>> = {
        list: async () => {
          const { stdout } = await execAsync("docker ps -a --format \"table {{.ID}}\\t{{.Image}}\\t{{.Status}}\\t{{.Names}}\"", { timeout: 10000 });
          return stdout.trim() || "No containers found.";
        },
        pull: async () => {
          const { stdout } = await execAsync(`docker pull ${args.image}`, { timeout: 120000 });
          return stdout.trim();
        },
        run: async () => {
          const detach = args.detach !== false ? "-d" : "";
          const ports = args.ports ? `-p ${args.ports}` : "";
          const cmd = args.command || "";
          const { stdout } = await execAsync(`docker run ${detach} ${ports} ${args.image} ${cmd}`.trim(), { timeout: 60000 });
          return `Container started: ${stdout.trim()}`;
        },
        stop: async () => {
          const { stdout } = await execAsync(`docker stop ${args.container_id}`, { timeout: 30000 });
          return `Stopped: ${stdout.trim()}`;
        },
        remove: async () => {
          const { stdout } = await execAsync(`docker rm ${args.container_id}`, { timeout: 15000 });
          return `Removed: ${stdout.trim()}`;
        },
        logs: async () => {
          const { stdout } = await execAsync(`docker logs --tail 50 ${args.container_id}`, { timeout: 15000 });
          return stdout.trim().slice(0, 2000) || "No logs.";
        },
        exec: async () => {
          const { stdout } = await execAsync(`docker exec ${args.container_id} ${args.command}`, { timeout: 30000 });
          return stdout.trim();
        },
        build: async () => {
          const dockerfilePath = args.dockerfile_path || ".";
          const tag = args.tag || "latest";
          const imageName = args.image || "og-build";
          const { stdout } = await execAsync(`docker build -t ${imageName}:${tag} ${dockerfilePath}`, { timeout: 300000, maxBuffer: 1024 * 1024 });
          return stdout.trim().slice(0, 2000);
        },
      };

      const handler = dockerCmds[action];
      if (handler) {
        try {
          resultStr = await handler();
          io.emit("system_status", `[DEV] Docker ${action} complete`);
        } catch (err: any) {
          if (err.message.includes("not found") || err.message.includes("not recognized")) {
            resultStr = "Docker is not installed or not in PATH. Install Docker Desktop from https://docker.com";
          } else {
            resultStr = `Docker error: ${err.message.slice(0, 300)}`;
          }
        }
      } else {
        resultStr = `Unknown Docker action: ${action}`;
      }

    } else if (fc.name === "run_tests") {
      const projectPath = args.project_path || process.cwd();
      let framework = args.test_framework || "auto";
      io.emit("system_status", `[DEV] Running tests in: ${path.basename(projectPath)}`);
      logActivity("RUN_TESTS", { projectPath, framework });

      // Auto-detect framework
      if (framework === "auto") {
        const pkgPath = path.join(projectPath, "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps.vitest) framework = "vitest";
          else if (deps.jest) framework = "jest";
          else if (deps.mocha) framework = "mocha";
          else if (pkg.scripts?.test) framework = "npm_test";
        } else if (fs.existsSync(path.join(projectPath, "pytest.ini")) || fs.existsSync(path.join(projectPath, "setup.py"))) {
          framework = "pytest";
        } else {
          framework = "npm_test";
        }
      }

      const testCmds: Record<string, string> = {
        jest: `npx jest --passWithNoTests ${args.test_pattern || ""}`,
        vitest: `npx vitest run ${args.test_pattern || ""}`,
        mocha: `npx mocha ${args.test_pattern || ""}`,
        pytest: `python -m pytest ${args.test_pattern || ""} -v`,
        npm_test: "npm test",
      };

      const cmd = testCmds[framework] || "npm test";
      try {
        const { stdout, stderr } = await execAsync(cmd, { cwd: projectPath, timeout: 120000, maxBuffer: 1024 * 1024 });
        resultStr = (stdout || "").trim().slice(0, 3000) || (stderr || "").trim().slice(0, 1000) || "Tests completed.";
        io.emit("system_status", `[DEV] Tests complete: ${framework}`);
      } catch (err: any) {
        resultStr = `Test run failed:\n${(err.stdout || "").slice(0, 1000)}\n${(err.stderr || "").slice(0, 500)}`;
        io.emit("system_status", `[DEV] Tests failed: ${framework}`);
      }

    } else if (fc.name === "generate_api_docs") {
      const content = args.doc_content;
      const ext = args.doc_format === "openapi_stub" ? ".yaml" : ".md";
      const safeName = path.basename(args.source_path).replace(/[^a-zA-Z0-9]/g, "_");
      const timestamp = new Date().toISOString().slice(0, 10);
      const savePath = args.output_path || path.join(os.homedir(), "Desktop", `${safeName}_docs_${timestamp}${ext}`);

      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(savePath, content, "utf-8");

      resultStr = `API documentation saved to: ${savePath}`;
      io.emit("system_status", `[DEV] API docs generated: ${path.basename(savePath)}`);
      logActivity("GENERATE_API_DOCS", { source: args.source_path, format: args.doc_format });
    }
  } catch (err: any) {
    resultStr = `Error: ${err.message}`;
    io.emit("system_status", `[DEV ERROR] ${err.message?.slice(0, 80)}`);
  }

  return { id: fc.id, name: fc.name, response: { result: resultStr } };
};
