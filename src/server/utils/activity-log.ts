/**
 * Activity Logger — logs all agent actions to data/activity.log
 * Used by all tool agents for audit trail and self-healing diagnostics
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const LOG_FILE = path.join(process.cwd(), "data", "activity.log");
const MAX_LOG_LINES = 500;

export function logActivity(action: string, details: Record<string, any> = {}): void {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      action,
      user: os.userInfo().username,
      ...details,
    });

    // Append to log
    fs.appendFileSync(LOG_FILE, entry + "\n", "utf-8");

    // Trim if too large
    try {
      const content = fs.readFileSync(LOG_FILE, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      if (lines.length > MAX_LOG_LINES) {
        fs.writeFileSync(LOG_FILE, lines.slice(-MAX_LOG_LINES).join("\n") + "\n", "utf-8");
      }
    } catch {}
  } catch {}
}

export function getRecentActivity(n = 20): string {
  try {
    if (!fs.existsSync(LOG_FILE)) return "No activity logged yet.";
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    return lines.slice(-n).join("\n");
  } catch {
    return "Could not read activity log.";
  }
}

export function clearActivityLog(): void {
  try {
    fs.writeFileSync(LOG_FILE, "", "utf-8");
  } catch {}
}
