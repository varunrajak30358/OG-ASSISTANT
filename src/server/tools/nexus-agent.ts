import { Type, type FunctionDeclaration } from "@google/genai";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Server } from "socket.io";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ── Smart Path Resolution ─────────────────────────────────────────────────────
// Common locations to search when a path doesn't exist or fails
const COMMON_ROOT_DIRS = [
  os.homedir(),
  path.join(os.homedir(), "Desktop"),
  path.join(os.homedir(), "Documents"),
  path.join(os.homedir(), "Downloads"),
  process.cwd(),
];

/**
 * Resolves a path intelligently:
 * 1. If the path exists as-is, return it
 * 2. If relative, try resolving from CWD and common locations
 * 3. If file not found, try matching by filename only
 */
function smartResolvePath(inputPath: string): string {
  // Normalize path separators
  const normalized = inputPath.replace(/\\/g, "/");

  // 1. Try as absolute path
  const asAbsolute = path.resolve(normalized);
  if (fs.existsSync(asAbsolute)) {
    return asAbsolute;
  }

  // 2. Try relative to CWD
  const asCwd = path.resolve(process.cwd(), normalized);
  if (fs.existsSync(asCwd)) {
    return asCwd;
  }

  // 3. Try relative to each common root
  for (const root of COMMON_ROOT_DIRS) {
    const candidate = path.resolve(root, normalized);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // 4. Try finding by basename (partial match) in common locations
  const basename = path.basename(normalized);
  if (basename) {
    for (const root of COMMON_ROOT_DIRS) {
      try {
        if (fs.existsSync(root)) {
          const entries = fs.readdirSync(root);
          for (const entry of entries) {
            if (entry.toLowerCase().includes(basename.toLowerCase())) {
              const match = path.join(root, entry);
              if (fs.existsSync(match)) {
                return match;
              }
            }
          }
        }
      } catch {}
    }
  }

  // Return the original path if nothing worked — the caller will handle errors
  return asCwd;
}

/**
 * Finds the closest existing parent directory for a given path.
 * e.g., "C:/Users/HP/Desktop/NewFolder/test.txt" -> "C:/Users/HP/Desktop" if NewFolder doesn't exist
 */
function findClosestExistingDir(inputPath: string): string {
  let dir = path.dirname(inputPath);
  while (dir && dir !== "." && dir !== "/") {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        return dir;
      }
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break; // Reached root
    dir = parent;
  }
  return os.homedir(); // fallback
}

// ── Path Validation & Correction ──────────────────────────────────────────────
/**
 * Validates a write path: ensures parent directory exists, creates if needed.
 * If permission denied, attempts to fix permissions automatically.
 * Returns an object with { success, path, message }
 */
async function ensureWritablePath(filePath: string): Promise<{ success: boolean; path: string; message: string }> {
  try {
    const dir = path.dirname(filePath);

    // Ensure parent directory exists
    if (dir && dir !== ".") {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          return { success: true, path: filePath, message: `Created directory: ${dir}` };
        } catch (err: any) {
          if (err.code === "EACCES" || err.code === "EPERM") {
            // Auto-fix permissions: take ownership or grant write access
            const fixResult = await autoFixPermissions(dir);
            if (fixResult) {
              fs.mkdirSync(dir, { recursive: true });
              return { success: true, path: filePath, message: `Fixed permissions and created directory: ${dir}` };
            }
            return { success: false, path: filePath, message: `Permission denied creating directory: ${dir}. Auto-fix failed.` };
          }
          throw err;
        }
      }

      // Check if we can write to the parent directory
      try {
        const testFile = path.join(dir, `.og_write_test_${Date.now()}`);
        fs.writeFileSync(testFile, "test");
        fs.unlinkSync(testFile);
        return { success: true, path: filePath, message: "Path is writable." };
      } catch (permErr: any) {
        if (permErr.code === "EACCES" || permErr.code === "EPERM") {
          const fixResult = await autoFixPermissions(dir);
          if (fixResult) {
            return { success: true, path: filePath, message: `Fixed permissions for: ${dir}` };
          }
          // Try finding an alternative writable location
          const altDir = findClosestExistingDir(dir);
          if (altDir !== dir) {
            const altPath = path.join(altDir, path.basename(filePath));
            return { success: true, path: altPath, message: `Permission denied at original path. Using alternative location: ${altPath}` };
          }
          return { success: false, path: filePath, message: `Permission denied writing to: ${dir}. Auto-fix failed. No alternative found.` };
        }
        throw permErr;
      }
    }

    return { success: true, path: filePath, message: "Path is writable." };
  } catch (err: any) {
    return { success: false, path: filePath, message: `Error: ${err.message}` };
  }
}

/**
 * Attempts to auto-fix file/folder permissions on Windows and Unix systems.
 * On Windows: takes ownership via takeown and grants full control via icacls.
 * On Unix: chmod 755 for dirs, 644 for files.
 */
async function autoFixPermissions(targetPath: string): Promise<boolean> {
  const platform = os.platform();
  try {
    if (platform === "win32") {
      // Step 1: Take ownership
      try {
        await execAsync(`takeown /f "${targetPath}" /r /d y 2>nul`, { timeout: 5000 });
      } catch {
        // takeown may fail silently on some paths, continue
      }

      // Step 2: Grant full control to current user
      try {
        const currentUser = process.env.USERNAME || process.env.USER || "Everyone";
        await execAsync(`icacls "${targetPath}" /grant "${currentUser}:(OI)(CI)F" /t /q 2>nul`, { timeout: 5000 });
      } catch {
        // Try granting to Everyone as fallback
        try {
          await execAsync(`icacls "${targetPath}" /grant "Everyone:(OI)(CI)F" /t /q 2>nul`, { timeout: 5000 });
        } catch {}
      }

      // Verify fix worked
      try {
        const testFile = path.join(targetPath, `.og_perm_test_${Date.now()}`);
        fs.writeFileSync(testFile, "test");
        fs.unlinkSync(testFile);
        return true;
      } catch {
        return false;
      }
    } else {
      // Unix / macOS
      try {
        await execAsync(`chmod -R 755 "${targetPath}" 2>/dev/null`, { timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }
}

export const nexusToolDeclarations: FunctionDeclaration[] = [
  // ── Existing tools ──────────────────────────────────────────────────────────
  {
    name: "create_directory",
    description: "Creates a new directory/folder at the specified path on the local file system. Automatically handles permissions — if access is denied, it will attempt to auto-fix permissions and retry. If the path doesn't exist, it will create all parent directories.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        dir_path: {
          type: Type.STRING,
          description: "The path of the directory to create, e.g., './new_folder' or 'src/components'",
        },
      },
      required: ["dir_path"],
    },
  },
  {
    name: "write_file",
    description: "Creates a new file or overwrites an existing file with the specified text content. Automatically creates parent directories if they don't exist. If permission is denied, automatically fixes permissions and retries. If the original path fails, finds an alternative writable location.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        file_path: {
          type: Type.STRING,
          description: "The path of the file to create, e.g., './index.js' or 'README.md' or 'C:/Users/HP/Desktop/notes.txt'",
        },
        content: {
          type: Type.STRING,
          description: "The text content to write inside the file.",
        },
      },
      required: ["file_path", "content"],
    },
  },

  // ── New File System tools ───────────────────────────────────────────────────
  {
    name: "fs_read_file",
    description: "Reads and returns the content of a file from the local file system. Use when user says 'file padhao', 'read file', 'file ka content batao', 'file mein kya likha hai', etc. Automatically resolves partial paths.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        file_path: {
          type: Type.STRING,
          description: "The full path of the file to read, e.g., 'C:/Users/HP/Desktop/notes.txt' or './README.md' or just 'notes.txt' (will auto-search)",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "delete_file",
    description: "Deletes a file or an empty/non-empty directory from the local file system. Use when user says 'file delete karo', 'hatao', 'remove karo'. If access denied, automatically fixes permissions first.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target_path: {
          type: Type.STRING,
          description: "The path of the file or directory to delete.",
        },
        is_directory: {
          type: Type.BOOLEAN,
          description: "Set to true if deleting a directory (folder). Default is false for files.",
        },
      },
      required: ["target_path"],
    },
  },
  {
    name: "list_directory",
    description: "Lists all files and folders inside a directory. Use when user says 'folder mein kya hai', 'list files', 'show contents', 'directory dikhao'. Automatically resolves partial paths.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        dir_path: {
          type: Type.STRING,
          description: "The path of the directory to list, e.g., 'C:/Users/HP/Desktop' or './src'",
        },
      },
      required: ["dir_path"],
    },
  },
  {
    name: "move_file",
    description: "Moves or renames a file or folder from one location to another. Use when user says 'file move karo', 'rename karo', 'shift karo'. If permission is denied, auto-fixes permissions and retries.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        source_path: {
          type: Type.STRING,
          description: "The current path of the file or folder.",
        },
        destination_path: {
          type: Type.STRING,
          description: "The new path or new name for the file or folder.",
        },
      },
      required: ["source_path", "destination_path"],
    },
  },
  {
    name: "get_file_info",
    description: "Gets metadata about a file or folder: size, creation date, last modified date, type. Use when user asks 'file ki info do', 'size batao', 'kab bana tha'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target_path: {
          type: Type.STRING,
          description: "The path of the file or folder to inspect.",
        },
      },
      required: ["target_path"],
    },
  },

  // ── File Search & Open ──────────────────────────────────────────────────────
  {
    name: "search_files",
    description: "Searches the entire system (or a specific folder) for files matching a name or keyword. Use when user says 'file dhundo', 'search karo', 'X naam ki file kahan hai', 'find file'. Returns a list of matching file paths.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The file name or keyword to search for. Can be partial name, e.g., 'resume', 'project', 'notes.txt'",
        },
        search_in: {
          type: Type.STRING,
          description: "Optional: specific folder to search in, e.g., 'C:/Users/HP/Documents'. Defaults to common locations (Desktop, Documents, Downloads, Pictures, Videos, C drive).",
        },
        file_extension: {
          type: Type.STRING,
          description: "Optional: filter by extension, e.g., 'pdf', 'docx', 'mp4', 'jpg'. Leave empty to search all types.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "open_file",
    description: "Opens a file or folder using the system default application. Use when user says 'file kholo', 'open karo', 'chalao'. Also used after search_files to open a specific result.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        file_path: {
          type: Type.STRING,
          description: "The full path of the file or folder to open.",
        },
      },
      required: ["file_path"],
    },
  },
];

// ── Nexus FS handler ──────────────────────────────────────────────────────────
export const handleNexusFs = async (toolCall: any, io: Server) => {
  const functionResponses = [];

  for (const fc of toolCall.functionCalls) {
    let resultStr = "";

    try {
      const args = fc.args as any;

      // ── create_directory ──────────────────────────────────────────────────
      if (fc.name === "create_directory") {
        const resolvedPath = path.resolve(args.dir_path);
        io.emit("system_status", `[NEXUS-FS] Creating directory: ${resolvedPath}`);
        try {
          fs.mkdirSync(resolvedPath, { recursive: true });
          resultStr = `Success: Directory created at ${resolvedPath}`;
          io.emit("system_status", `[NEXUS-FS] Directory Created: ${resolvedPath}`);
        } catch (err: any) {
          if (err.code === "EACCES" || err.code === "EPERM") {
            io.emit("system_status", `[NEXUS-FS] Permission denied. Attempting auto-fix...`);
            const fixed = await autoFixPermissions(findClosestExistingDir(resolvedPath));
            if (fixed) {
              fs.mkdirSync(resolvedPath, { recursive: true });
              resultStr = `Success: Directory created at ${resolvedPath} (permission was auto-fixed)`;
              io.emit("system_status", `[NEXUS-FS] Directory Created after auto-fix: ${resolvedPath}`);
            } else {
              // Try alternative location
              const altBase = path.join(os.homedir(), "Desktop");
              const altPath = path.join(altBase, path.basename(resolvedPath));
              fs.mkdirSync(altPath, { recursive: true });
              resultStr = `Note: Original path was not writable (${resolvedPath}). Created directory at alternative location instead: ${altPath}`;
              io.emit("system_status", `[NEXUS-FS] Directory created at alternative: ${altPath}`);
            }
          } else {
            throw err;
          }
        }

      // ── write_file ────────────────────────────────────────────────────────
      } else if (fc.name === "write_file") {
        const rawPath = args.file_path;
        const resolvedPath = path.resolve(rawPath);
        io.emit("system_status", `[NEXUS-FS] Writing file: ${resolvedPath}`);

        // Validate and fix path/write permissions
        const writeCheck = await ensureWritablePath(resolvedPath);
        if (!writeCheck.success) {
          // Try alternative location on Desktop
          const altPath = path.join(os.homedir(), "Desktop", path.basename(resolvedPath));
          io.emit("system_status", `[NEXUS-FS] Trying alternative path: ${altPath}`);
          const altCheck = await ensureWritablePath(altPath);
          if (altCheck.success) {
            fs.writeFileSync(altPath, args.content, "utf-8");
            resultStr = `Note: Original path "${resolvedPath}" had permission issues. File saved to alternative location instead:\n${altPath}`;
            io.emit("system_status", `[NEXUS-FS] File saved at alternative: ${altPath}`);
          } else {
            resultStr = `Error: Could not write file. ${writeCheck.message}`;
            io.emit("system_status", `[NEXUS-FS ERROR] ${writeCheck.message}`);
          }
        } else {
          // Ensure parent directory exists
          const dir = path.dirname(resolvedPath);
          if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(resolvedPath, args.content, "utf-8");
          resultStr = `Success: File written at ${resolvedPath}`;
          io.emit("system_status", `[NEXUS-FS] File Created: ${resolvedPath}`);
        }

      // ── fs_read_file ──────────────────────────────────────────────────────────
      } else if (fc.name === "fs_read_file") {
        const smartPath = smartResolvePath(args.file_path);
        if (!fs.existsSync(smartPath)) {
          resultStr = `Error: File not found at ${args.file_path}. I searched common locations but could not find it. Try using search_files first to locate the file.`;
        } else {
          const stat = fs.statSync(smartPath);
          if (stat.isDirectory()) {
            resultStr = `Error: ${smartPath} is a directory, not a file. Use list_directory instead.`;
          } else {
            // Limit to 8KB to avoid overwhelming Gemini context
            const MAX_BYTES = 8192;
            const content = fs.readFileSync(smartPath, "utf-8");
            const truncated = content.length > MAX_BYTES;
            resultStr = truncated
              ? `File content (first 8KB) from ${smartPath}:\n${content.slice(0, MAX_BYTES)}\n\n[...truncated, file is ${content.length} chars total]`
              : `File content from ${smartPath}:\n${content}`;
            io.emit("system_status", `[NEXUS-FS] File Read: ${smartPath}`);
          }
        }

      // ── delete_file ───────────────────────────────────────────────────────
      } else if (fc.name === "delete_file") {
        const smartPath = smartResolvePath(args.target_path);
        if (!fs.existsSync(smartPath)) {
          resultStr = `Error: Path not found: ${args.target_path}`;
        } else {
          try {
            const stat = fs.statSync(smartPath);
            if (stat.isDirectory() || args.is_directory) {
              fs.rmSync(smartPath, { recursive: true, force: true });
              resultStr = `Success: Directory deleted: ${smartPath}`;
              io.emit("system_status", `[NEXUS-FS] Directory Deleted: ${smartPath}`);
            } else {
              fs.unlinkSync(smartPath);
              resultStr = `Success: File deleted: ${smartPath}`;
              io.emit("system_status", `[NEXUS-FS] File Deleted: ${smartPath}`);
            }
          } catch (err: any) {
            if (err.code === "EACCES" || err.code === "EPERM") {
              io.emit("system_status", `[NEXUS-FS] Permission denied. Attempting auto-fix...`);
              const fixed = await autoFixPermissions(smartPath);
              if (fixed) {
                const stat = fs.statSync(smartPath);
                if (stat.isDirectory() || args.is_directory) {
                  fs.rmSync(smartPath, { recursive: true, force: true });
                } else {
                  fs.unlinkSync(smartPath);
                }
                resultStr = `Success: Deleted ${smartPath} (permission was auto-fixed)`;
                io.emit("system_status", `[NEXUS-FS] Deleted after auto-fix: ${smartPath}`);
              } else {
                resultStr = `Error: Permission denied deleting ${smartPath}. Auto-fix also failed.`;
              }
            } else {
              throw err;
            }
          }
        }

      // ── list_directory ────────────────────────────────────────────────────
      } else if (fc.name === "list_directory") {
        const smartPath = smartResolvePath(args.dir_path);
        if (!fs.existsSync(smartPath)) {
          resultStr = `Error: Directory not found: ${args.dir_path}. I searched common locations but could not find it.`;
        } else {
          const entries = fs.readdirSync(smartPath, { withFileTypes: true });
          if (entries.length === 0) {
            resultStr = `Directory is empty: ${smartPath}`;
          } else {
            const lines = entries.map((e) => {
              const type = e.isDirectory() ? "[DIR] " : "[FILE]";
              let size = "";
              if (e.isFile()) {
                try {
                  const s = fs.statSync(path.join(smartPath, e.name));
                  size = ` (${(s.size / 1024).toFixed(1)} KB)`;
                } catch {}
              }
              return `${type} ${e.name}${size}`;
            });
            resultStr = `Contents of ${smartPath} (${entries.length} items):\n${lines.join("\n")}`;
            io.emit("system_status", `[NEXUS-FS] Listed: ${smartPath}`);
          }
        }

      // ── move_file ─────────────────────────────────────────────────────────
      } else if (fc.name === "move_file") {
        const smartSource = smartResolvePath(args.source_path);
        if (!fs.existsSync(smartSource)) {
          resultStr = `Error: Source not found: ${args.source_path}`;
        } else {
          const destDir = path.dirname(args.destination_path);
          if (destDir && destDir !== ".") fs.mkdirSync(destDir, { recursive: true });
          try {
            fs.renameSync(smartSource, args.destination_path);
            resultStr = `Success: Moved/Renamed '${smartSource}' → '${args.destination_path}'`;
            io.emit("system_status", `[NEXUS-FS] Moved: ${path.basename(smartSource)} → ${args.destination_path}`);
          } catch (err: any) {
            if (err.code === "EACCES" || err.code === "EPERM") {
              // Try copy-then-delete approach
              try {
                const content = fs.readFileSync(smartSource);
                if (destDir && destDir !== ".") fs.mkdirSync(destDir, { recursive: true });
                fs.writeFileSync(args.destination_path, content);
                fs.unlinkSync(smartSource);
                resultStr = `Success: Moved '${smartSource}' → '${args.destination_path}' (copy-delete fallback due to permissions)`;
                io.emit("system_status", `[NEXUS-FS] Moved via copy-delete: ${path.basename(smartSource)}`);
              } catch (moveErr: any) {
                resultStr = `Error moving file: ${moveErr.message}`;
              }
            } else {
              throw err;
            }
          }
        }

      // ── get_file_info ─────────────────────────────────────────────────────
      } else if (fc.name === "get_file_info") {
        const smartPath = smartResolvePath(args.target_path);
        if (!fs.existsSync(smartPath)) {
          resultStr = `Error: Path not found: ${args.target_path}`;
        } else {
          const stat = fs.statSync(smartPath);
          const type = stat.isDirectory() ? "Directory" : "File";
          const sizeKB = (stat.size / 1024).toFixed(2);
          const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
          resultStr = [
            `Type: ${type}`,
            `Name: ${path.basename(smartPath)}`,
            `Path: ${path.resolve(smartPath)}`,
            `Size: ${stat.size} bytes (${sizeKB} KB / ${sizeMB} MB)`,
            `Created: ${stat.birthtime.toLocaleString()}`,
            `Modified: ${stat.mtime.toLocaleString()}`,
            `Accessed: ${stat.atime.toLocaleString()}`,
          ].join("\n");
          io.emit("system_status", `[NEXUS-FS] Info: ${smartPath}`);
        }

      // ── search_files ──────────────────────────────────────────────────────
      } else if (fc.name === "search_files") {
        const query     = (args.query || "").trim();
        const ext       = (args.file_extension || "").replace(/^\./, "").trim();
        const searchIn  = args.search_in || null;
        const platform  = os.platform();

        io.emit("system_status", `[NEXUS-FS] Searching for: ${query}${ext ? "." + ext : ""}...`);

        // Build search pattern
        const pattern = ext ? `*${query}*.${ext}` : `*${query}*`;

        let results: string[] = [];

        if (platform === "win32") {
          // Search in common locations if no specific path given
          const searchDirs = searchIn
            ? [searchIn]
            : [
                path.join(os.homedir(), "Desktop"),
                path.join(os.homedir(), "Documents"),
                path.join(os.homedir(), "Downloads"),
                path.join(os.homedir(), "Pictures"),
                path.join(os.homedir(), "Videos"),
                path.join(os.homedir(), "Music"),
              ];

          for (const dir of searchDirs) {
            if (!fs.existsSync(dir)) continue;
            try {
              // /s = recursive, /b = bare (paths only), /a-d = files only (no dirs)
              const cmd = `dir /s /b /a-d "${path.join(dir, pattern)}" 2>nul`;
              const { stdout } = await execAsync(cmd, { timeout: 8000 });
              const lines = stdout.trim().split("\r\n").filter(Boolean);
              results.push(...lines);
              // Stop early if we have enough results
              if (results.length >= 30) break;
            } catch {
              // dir returns exit code 1 if no files found — ignore
            }
          }
        } else {
          // macOS / Linux — use find
          const searchDir = searchIn || os.homedir();
          const namePattern = ext ? `*${query}*.${ext}` : `*${query}*`;
          try {
            const { stdout } = await execAsync(
              `find "${searchDir}" -iname "${namePattern}" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -30`,
              { timeout: 10000 }
            );
            results = stdout.trim().split("\n").filter(Boolean);
          } catch {}
        }

        // Deduplicate and limit
        results = [...new Set(results)].slice(0, 25);

        if (results.length === 0) {
          resultStr = `No files found matching "${query}"${ext ? " with extension ." + ext : ""}. Try a different name or location.`;
          io.emit("system_status", `[NEXUS-FS] Search: No results for "${query}"`);
        } else if (results.length === 1) {
          resultStr = `Found 1 file:\n1. ${results[0]}\n\nShall I open it?`;
          io.emit("system_status", `[NEXUS-FS] Search: Found 1 result`);
        } else {
          const numbered = results.map((r, i) => `${i + 1}. ${r}`).join("\n");
          resultStr = `Found ${results.length} files matching "${query}":\n${numbered}\n\nMultiple files found. Ask the user which one to open (by number or name).`;
          io.emit("system_status", `[NEXUS-FS] Search: Found ${results.length} results`);
        }

      // ── open_file ─────────────────────────────────────────────────────────
      } else if (fc.name === "open_file") {
        const smartPath = smartResolvePath(args.file_path);
        if (!fs.existsSync(smartPath)) {
          resultStr = `Error: File not found: ${args.file_path}`;
        } else {
          const platform = os.platform();
          if (platform === "win32") {
            await execAsync(`start "" "${smartPath}"`);
          } else if (platform === "darwin") {
            await execAsync(`open "${smartPath}"`);
          } else {
            await execAsync(`xdg-open "${smartPath}"`);
          }
          resultStr = `Opened: ${smartPath}`;
          io.emit("system_status", `[NEXUS-FS] Opened: ${path.basename(smartPath)}`);
        }

      } else {
        resultStr = `Error: Function ${fc.name} not found.`;
      }
    } catch (err: any) {
      resultStr = `Error executing ${fc.name}: ${err.message}`;
      io.emit("system_status", `[NEXUS-FS ERROR] ${err.message}`);
    }

    functionResponses.push({
      id: fc.id,
      name: fc.name,
      response: { result: resultStr },
    });
  }

  return functionResponses;
};