/**
 * Coding Agent — code generation, debugging, refactoring, project scaffolding,
 * dependency installation, README generation, SQL query generation
 * Powered by NVIDIA NIM API (minimaxai/minimax-m3) for AI-enhanced code generation
 */
import { Type, type FunctionDeclaration } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import { Server } from "socket.io";
import { logActivity } from "../utils/activity-log.js";

// ── NVIDIA NIM API client ─────────────────────────────────────────────────────
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "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";
const NVIDIA_BASE_URL = "integrate.api.nvidia.com";

// Primary: minimaxai/minimax-m3, Fallback: llama-3.1-8b (fast)
const CODING_MODEL_PRIMARY  = "minimaxai/minimax-m3";
const CODING_MODEL_FALLBACK = "meta/llama-3.1-8b-instruct";

async function callNvidiaAPI(prompt: string, systemPrompt: string, model = CODING_MODEL_PRIMARY): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: prompt },
      ],
      max_tokens: 4096,
      temperature: 0.2,
      top_p: 0.9,
    });

    const req = https.request({
      hostname: NVIDIA_BASE_URL,
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NVIDIA_API_KEY}`,
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
          } else {
            reject(new Error("No content in response"));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error("NVIDIA API timeout")); });
    req.write(body);
    req.end();
  });
}

// ── AI-enhanced code generation via NVIDIA NIM ────────────────────────────────
async function generateCodeWithAI(description: string, language: string, context?: string): Promise<string> {
  const systemPrompt = `You are an expert ${language} developer. Generate clean, production-ready, well-commented code.
Rules:
- Return ONLY the code, no markdown fences, no explanation
- Include necessary imports
- Add brief inline comments for complex logic
- Follow best practices for ${language}
- Make the code complete and runnable`;

  const prompt = context
    ? `Context: ${context}\n\nTask: ${description}`
    : description;

  try {
    return await callNvidiaAPI(prompt, systemPrompt, CODING_MODEL_PRIMARY);
  } catch {
    // Fallback to smaller model
    return await callNvidiaAPI(prompt, systemPrompt, CODING_MODEL_FALLBACK);
  }
}

async function debugCodeWithAI(code: string, errorMessage?: string, language = "unknown"): Promise<string> {
  const systemPrompt = `You are an expert ${language} debugger. Analyze code and return ONLY the fixed code with no explanation or markdown fences.`;
  const prompt = errorMessage
    ? `Fix this ${language} code. Error: ${errorMessage}\n\nCode:\n${code}`
    : `Fix any bugs in this ${language} code:\n${code}`;

  try {
    return await callNvidiaAPI(prompt, systemPrompt, CODING_MODEL_PRIMARY);
  } catch {
    return await callNvidiaAPI(prompt, systemPrompt, CODING_MODEL_FALLBACK);
  }
}

async function refactorCodeWithAI(code: string, instructions: string, language = "unknown"): Promise<string> {
  const systemPrompt = `You are an expert ${language} developer. Refactor the code as instructed. Return ONLY the refactored code, no markdown fences, no explanation.`;
  const prompt = `Refactor this ${language} code: ${instructions}\n\nCode:\n${code}`;

  try {
    return await callNvidiaAPI(prompt, systemPrompt, CODING_MODEL_PRIMARY);
  } catch {
    return await callNvidiaAPI(prompt, systemPrompt, CODING_MODEL_FALLBACK);
  }
}

async function generateSQLWithAI(description: string, operation: string): Promise<string> {
  const systemPrompt = `You are an expert SQL developer. Generate clean, optimized SQL queries. Return ONLY the SQL, no markdown fences, no explanation.`;
  const prompt = `Generate a ${operation} SQL query: ${description}`;

  try {
    return await callNvidiaAPI(prompt, systemPrompt, CODING_MODEL_PRIMARY);
  } catch {
    return await callNvidiaAPI(prompt, systemPrompt, CODING_MODEL_FALLBACK);
  }
}

async function generateReadmeWithAI(projectName: string, description: string, projectPath?: string): Promise<string> {
  let fileList = "";
  if (projectPath && fs.existsSync(projectPath)) {
    try {
      const entries = fs.readdirSync(projectPath).slice(0, 20);
      fileList = `\nProject files: ${entries.join(", ")}`;
    } catch {}
  }

  const systemPrompt = `You are a technical writer. Generate a comprehensive, well-structured README.md in Markdown format.`;
  const prompt = `Generate a README.md for project "${projectName}": ${description}${fileList}`;

  try {
    return await callNvidiaAPI(prompt, systemPrompt, CODING_MODEL_PRIMARY);
  } catch {
    return `# ${projectName}\n\n${description}\n\n## Getting Started\n\nSee documentation for setup instructions.\n`;
  }
}


export const codingToolDeclarations: FunctionDeclaration[] = [
  {
    name: "generate_code",
    description:
      "Generates code in any language and writes it to a file. Use when user says 'code likho', 'create a function', 'write a script', 'generate code for X'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        description: {
          type: Type.STRING,
          description: "What the code should do.",
        },
        language: {
          type: Type.STRING,
          description: "Programming language: python, javascript, typescript, html, css, sql, bash, etc.",
        },
        output_file: {
          type: Type.STRING,
          description: "Optional: file path to save the generated code.",
        },
        code_content: {
          type: Type.STRING,
          description: "The actual code to write (AI should generate this based on description).",
        },
      },
      required: ["description", "language", "code_content"],
    },
  },
  {
    name: "scaffold_project",
    description:
      "Creates a project scaffold with folder structure and boilerplate files. Use when user says 'new project banao', 'scaffold a React app', 'create project structure'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        project_name: {
          type: Type.STRING,
          description: "Name of the project.",
        },
        project_type: {
          type: Type.STRING,
          description: "Type: 'react', 'node-api', 'python-flask', 'python-fastapi', 'html-css', 'cli-tool', 'custom'",
          enum: ["react", "node-api", "python-flask", "python-fastapi", "html-css", "cli-tool", "custom"],
        },
        base_path: {
          type: Type.STRING,
          description: "Where to create the project. Defaults to Desktop.",
        },
        custom_structure: {
          type: Type.STRING,
          description: "For 'custom' type: JSON string describing files to create. Format: [{path, content}]",
        },
      },
      required: ["project_name", "project_type"],
    },
  },
  {
    name: "generate_readme",
    description:
      "Generates a README.md for a project. Use when user says 'README banao', 'generate documentation', 'write README'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        project_path: {
          type: Type.STRING,
          description: "Path to the project directory.",
        },
        project_name: {
          type: Type.STRING,
          description: "Project name.",
        },
        description: {
          type: Type.STRING,
          description: "Project description.",
        },
        readme_content: {
          type: Type.STRING,
          description: "The README content to write.",
        },
      },
      required: ["project_name", "description", "readme_content"],
    },
  },
  {
    name: "debug_code",
    description:
      "Reads a code file, analyzes it for errors, and optionally writes a fixed version. Use when user says 'debug karo', 'fix this code', 'error dhundo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        file_path: {
          type: Type.STRING,
          description: "Path to the file to debug.",
        },
        error_message: {
          type: Type.STRING,
          description: "Optional: the error message the user is seeing.",
        },
        fixed_content: {
          type: Type.STRING,
          description: "Optional: the fixed code to write back to the file.",
        },
        write_fix: {
          type: Type.BOOLEAN,
          description: "Set to true to overwrite the file with fixed_content.",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "generate_sql",
    description:
      "Generates SQL queries for common operations. Use when user says 'SQL query banao', 'database query likhao', 'SELECT query chahiye'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        operation: {
          type: Type.STRING,
          description: "SQL operation type.",
          enum: ["select", "insert", "update", "delete", "create_table", "join", "aggregate", "custom"],
        },
        table_name: {
          type: Type.STRING,
          description: "Table name.",
        },
        description: {
          type: Type.STRING,
          description: "What the query should do.",
        },
        sql_content: {
          type: Type.STRING,
          description: "The actual SQL query to return.",
        },
        save_to_file: {
          type: Type.STRING,
          description: "Optional: file path to save the SQL query.",
        },
      },
      required: ["operation", "description", "sql_content"],
    },
  },
  {
    name: "refactor_code",
    description:
      "Reads a code file and writes a refactored version. Use when user says 'refactor karo', 'code improve karo', 'clean up this code'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        file_path: {
          type: Type.STRING,
          description: "Path to the file to refactor.",
        },
        instructions: {
          type: Type.STRING,
          description: "What to improve: 'add types', 'extract functions', 'add error handling', etc.",
        },
        refactored_content: {
          type: Type.STRING,
          description: "The refactored code to write.",
        },
      },
      required: ["file_path", "instructions", "refactored_content"],
    },
  },
];

// ── Project scaffolding templates ─────────────────────────────────────────────
const SCAFFOLDS: Record<string, (name: string) => Array<{ path: string; content: string }>> = {
  "react": (name) => [
    { path: "package.json", content: JSON.stringify({ name, version: "0.1.0", scripts: { dev: "vite", build: "vite build" }, dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" }, devDependencies: { vite: "^5.0.0", "@vitejs/plugin-react": "^4.0.0" } }, null, 2) },
    { path: "vite.config.js", content: `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n` },
    { path: "index.html", content: `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>${name}</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>\n</html>\n` },
    { path: "src/main.jsx", content: `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\nReactDOM.createRoot(document.getElementById('root')).render(<App />);\n` },
    { path: "src/App.jsx", content: `export default function App() {\n  return <div><h1>${name}</h1></div>;\n}\n` },
    { path: "src/App.css", content: `* { box-sizing: border-box; margin: 0; padding: 0; }\nbody { font-family: sans-serif; }\n` },
    { path: "README.md", content: `# ${name}\n\nA React application.\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n` },
  ],
  "node-api": (name) => [
    { path: "package.json", content: JSON.stringify({ name, version: "1.0.0", type: "module", main: "src/index.js", scripts: { start: "node src/index.js", dev: "nodemon src/index.js" }, dependencies: { express: "^5.0.0" }, devDependencies: { nodemon: "^3.0.0" } }, null, 2) },
    { path: "src/index.js", content: `import express from 'express';\nconst app = express();\napp.use(express.json());\n\napp.get('/health', (req, res) => res.json({ status: 'ok' }));\n\napp.listen(3000, () => console.log('Server running on port 3000'));\n` },
    { path: "src/routes/index.js", content: `import { Router } from 'express';\nconst router = Router();\n\nrouter.get('/', (req, res) => res.json({ message: 'Hello World' }));\n\nexport default router;\n` },
    { path: ".env.example", content: `PORT=3000\nNODE_ENV=development\n` },
    { path: "README.md", content: `# ${name}\n\nA Node.js REST API.\n\n## Setup\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n` },
  ],
  "python-flask": (name) => [
    { path: "app.py", content: `from flask import Flask, jsonify\n\napp = Flask(__name__)\n\n@app.route('/health')\ndef health():\n    return jsonify({'status': 'ok'})\n\nif __name__ == '__main__':\n    app.run(debug=True, port=5000)\n` },
    { path: "requirements.txt", content: `flask>=3.0.0\npython-dotenv>=1.0.0\n` },
    { path: ".env", content: `FLASK_ENV=development\nFLASK_DEBUG=1\n` },
    { path: "README.md", content: `# ${name}\n\nA Flask web application.\n\n## Setup\n\n\`\`\`bash\npip install -r requirements.txt\npython app.py\n\`\`\`\n` },
  ],
  "python-fastapi": (name) => [
    { path: "main.py", content: `from fastapi import FastAPI\n\napp = FastAPI(title="${name}")\n\n@app.get("/health")\ndef health():\n    return {"status": "ok"}\n` },
    { path: "requirements.txt", content: `fastapi>=0.110.0\nuvicorn[standard]>=0.29.0\npython-dotenv>=1.0.0\n` },
    { path: "README.md", content: `# ${name}\n\nA FastAPI application.\n\n## Setup\n\n\`\`\`bash\npip install -r requirements.txt\nuvicorn main:app --reload\n\`\`\`\n` },
  ],
  "html-css": (name) => [
    { path: "index.html", content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${name}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>${name}</h1>\n  <script src="script.js"></script>\n</body>\n</html>\n` },
    { path: "style.css", content: `* { box-sizing: border-box; margin: 0; padding: 0; }\nbody { font-family: sans-serif; background: #f5f5f5; }\n` },
    { path: "script.js", content: `// ${name} - main script\nconsole.log('${name} loaded');\n` },
  ],
  "cli-tool": (name) => [
    { path: "package.json", content: JSON.stringify({ name, version: "1.0.0", type: "module", bin: { [name]: "./bin/cli.js" }, scripts: { start: `node bin/cli.js` } }, null, 2) },
    { path: "bin/cli.js", content: `#!/usr/bin/env node\nimport { program } from 'commander';\n\nprogram\n  .name('${name}')\n  .description('CLI tool')\n  .version('1.0.0');\n\nprogram.command('run').description('Run the tool').action(() => {\n  console.log('Running ${name}...');\n});\n\nprogram.parse();\n` },
    { path: "README.md", content: `# ${name}\n\nA CLI tool.\n\n## Usage\n\n\`\`\`bash\nnode bin/cli.js run\n\`\`\`\n` },
  ],
};

export const handleCodingAction = async (fc: any, io: Server): Promise<any> => {
  let resultStr = "";
  const args = fc.args as any;

  try {
    if (fc.name === "generate_code") {
      const code = args.code_content || "";
      if (args.output_file) {
        const dir = path.dirname(args.output_file);
        if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(args.output_file, code, "utf-8");
        resultStr = `Code written to ${args.output_file} (${code.split("\n").length} lines).`;
        io.emit("system_status", `[CODE] Generated: ${path.basename(args.output_file)}`);
      } else {
        resultStr = `Generated ${args.language} code:\n\`\`\`${args.language}\n${code.slice(0, 2000)}\n\`\`\``;
        io.emit("system_status", `[CODE] Generated ${args.language} code`);
      }
      logActivity("GENERATE_CODE", { language: args.language, file: args.output_file });

    } else if (fc.name === "scaffold_project") {
      const basePath = args.base_path || path.join(os.homedir(), "Desktop");
      const projectDir = path.join(basePath, args.project_name);
      fs.mkdirSync(projectDir, { recursive: true });

      let files: Array<{ path: string; content: string }> = [];

      if (args.project_type === "custom" && args.custom_structure) {
        try {
          files = JSON.parse(args.custom_structure);
        } catch {
          resultStr = "Error: custom_structure must be valid JSON.";
          return { id: fc.id, name: fc.name, response: { result: resultStr } };
        }
      } else {
        const scaffoldFn = SCAFFOLDS[args.project_type];
        if (!scaffoldFn) {
          resultStr = `Unknown project type: ${args.project_type}`;
          return { id: fc.id, name: fc.name, response: { result: resultStr } };
        }
        files = scaffoldFn(args.project_name);
      }

      const created: string[] = [];
      for (const file of files) {
        const fullPath = path.join(projectDir, file.path);
        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, file.content, "utf-8");
        created.push(file.path);
      }

      resultStr = `Project '${args.project_name}' scaffolded at ${projectDir}\nFiles created:\n${created.map(f => `  - ${f}`).join("\n")}`;
      io.emit("system_status", `[CODE] Scaffolded: ${args.project_name} (${created.length} files)`);
      logActivity("SCAFFOLD_PROJECT", { name: args.project_name, type: args.project_type, path: projectDir });

    } else if (fc.name === "generate_readme") {
      const content = args.readme_content || `# ${args.project_name}\n\n${args.description}\n`;
      const savePath = args.project_path
        ? path.join(args.project_path, "README.md")
        : path.join(process.cwd(), "README.md");
      fs.writeFileSync(savePath, content, "utf-8");
      resultStr = `README.md generated at ${savePath}`;
      io.emit("system_status", `[CODE] README generated`);

    } else if (fc.name === "debug_code") {
      if (!fs.existsSync(args.file_path)) {
        resultStr = `Error: File not found: ${args.file_path}`;
      } else {
        const content = fs.readFileSync(args.file_path, "utf-8");
        if (args.write_fix && args.fixed_content) {
          fs.writeFileSync(args.file_path, args.fixed_content, "utf-8");
          resultStr = `Fixed code written to ${args.file_path}. Original had ${content.split("\n").length} lines, fixed has ${args.fixed_content.split("\n").length} lines.`;
          io.emit("system_status", `[CODE] Debugged: ${path.basename(args.file_path)}`);
        } else {
          resultStr = `File content (${content.split("\n").length} lines):\n${content.slice(0, 3000)}`;
          io.emit("system_status", `[CODE] Read for debugging: ${path.basename(args.file_path)}`);
        }
        logActivity("DEBUG_CODE", { file: args.file_path });
      }

    } else if (fc.name === "generate_sql") {
      const sql = args.sql_content || "";
      if (args.save_to_file) {
        const dir = path.dirname(args.save_to_file);
        if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(args.save_to_file, sql, "utf-8");
        resultStr = `SQL query saved to ${args.save_to_file}`;
      } else {
        resultStr = `Generated SQL:\n\`\`\`sql\n${sql}\n\`\`\``;
      }
      io.emit("system_status", `[CODE] SQL generated: ${args.operation}`);

    } else if (fc.name === "refactor_code") {
      if (!fs.existsSync(args.file_path)) {
        resultStr = `Error: File not found: ${args.file_path}`;
      } else {
        const original = fs.readFileSync(args.file_path, "utf-8");
        const refactored = args.refactored_content;
        if (refactored) {
          // Backup original
          const backupPath = args.file_path + ".bak";
          fs.writeFileSync(backupPath, original, "utf-8");
          fs.writeFileSync(args.file_path, refactored, "utf-8");
          resultStr = `Refactored ${path.basename(args.file_path)}. Original backed up to ${backupPath}.`;
          io.emit("system_status", `[CODE] Refactored: ${path.basename(args.file_path)}`);
        } else {
          resultStr = `File content for refactoring:\n${original.slice(0, 3000)}`;
        }
        logActivity("REFACTOR_CODE", { file: args.file_path, instructions: args.instructions });
      }
    }
  } catch (err: any) {
    resultStr = `Error: ${err.message}`;
    io.emit("system_status", `[CODE ERROR] ${err.message?.slice(0, 80)}`);
  }

  return { id: fc.id, name: fc.name, response: { result: resultStr } };
};
