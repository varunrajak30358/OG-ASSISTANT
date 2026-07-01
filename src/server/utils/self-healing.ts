import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import net from "net";
import { execSync } from "child_process";

export interface HealingResult {
  success: boolean;
  healedCount: number;
  report: string;
}

export const isPortAvailable = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", (err: any) => {
      if (err.code === "EADDRNOTAVAIL" || err.code === "EADDRINUSE") {
        if (err.code === "EADDRINUSE") {
          return resolve(false);
        }
        const s4 = net.createServer();
        s4.once("error", () => resolve(false));
        s4.once("listening", () => {
          s4.close(() => resolve(true));
        });
        s4.listen(port, "0.0.0.0");
      } else {
        resolve(false);
      }
    });
    s.once("listening", () => {
      s.close(() => {
        const s4 = net.createServer();
        s4.once("error", () => resolve(false));
        s4.once("listening", () => {
          s4.close(() => resolve(true));
        });
        s4.listen(port, "0.0.0.0");
      });
    });
    s.listen(port, "::");
  });
};

export const runSelfHealing = async (
  log: (msg: string) => void
): Promise<HealingResult> => {
  let healedCount = 0;
  const reports: string[] = [];

  log("[START] Initiating System Self-Healing...");
  
  // ── 1. Check Env & Config ──
  log("[STEP 1/4] Checking Environment Configuration...");
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    log("[WARNING] .env file not found in project root!");
    try {
      const envExamplePath = path.resolve(process.cwd(), ".env.example");
      if (fs.existsSync(envExamplePath)) {
        fs.copyFileSync(envExamplePath, envPath);
        log("[HEALED] Restored .env file from .env.example");
        healedCount++;
        reports.push("Restored .env file from template.");
      } else {
        fs.writeFileSync(envPath, "GOOGLE_API_KEY=\nOG_VOICE=Aoede\nPORT=6753\n", "utf-8");
        log("[HEALED] Created new basic .env file");
        healedCount++;
        reports.push("Created empty .env file.");
      }
    } catch (e: any) {
      log(`[ERROR] Failed to restore .env: ${e.message}`);
    }
  } else {
    log("[SUCCESS] .env file exists.");
    // Check if API key is populated
    try {
      const envContent = fs.readFileSync(envPath, "utf-8");
      if (!envContent.includes("GOOGLE_API_KEY") || envContent.match(/GOOGLE_API_KEY=\s*$/m)) {
        log("[WARNING] GOOGLE_API_KEY is empty or missing in .env!");
        reports.push("GOOGLE_API_KEY is empty in .env.");
      }
    } catch {}
  }

  // ── 2. Clean Temp Files ──
  log("[STEP 2/4] Scanning for orphaned temporary scripts...");
  try {
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    let cleanedTempCount = 0;
    const now = Date.now();
    const TEN_MINUTES = 10 * 60 * 1000;

    for (const file of files) {
      if (file.startsWith("og_")) {
        const filePath = path.join(tmpDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > TEN_MINUTES) {
            fs.unlinkSync(filePath);
            cleanedTempCount++;
          }
        } catch {}
      }
    }
    if (cleanedTempCount > 0) {
      log(`[HEALED] Cleaned up ${cleanedTempCount} orphaned temp files.`);
      healedCount++;
      reports.push(`Cleaned up ${cleanedTempCount} temporary files.`);
    } else {
      log("[SUCCESS] No orphaned temp files found.");
    }
  } catch (e: any) {
    log(`[ERROR] Failed to scan temp directory: ${e.message}`);
  }

  // ── 3. Check Port Conflicts ──
  log("[STEP 3/4] Checking for zombie port conflicts...");
  const targetPort = 6753;
  const platform = os.platform();
  
  try {
    if (platform === "win32") {
      try {
        const output = execSync(`netstat -ano | findstr :${targetPort}`, { encoding: "utf-8" });
        const lines = output.split("\n").map(l => l.trim()).filter(Boolean);
        let killedOther = 0;

        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length < 3) continue;
          const localAddr = parts[1];
          const pid = parts[parts.length - 1];
          if (localAddr.endsWith(`:${targetPort}`) && pid && pid !== "0" && parseInt(pid) !== process.pid) {
            log(`[HEAL CONFLICT] Found other process ${pid} on port ${targetPort}. Terminating...`);
            try {
              execSync(`taskkill /F /PID ${pid}`);
              killedOther++;
            } catch (err: any) {
              log(`[WARNING] Failed to terminate process ${pid}: ${err.message}`);
            }
          }
        }
        if (killedOther > 0) {
          healedCount++;
          reports.push(`Killed ${killedOther} zombie process(es) holding port ${targetPort}.`);
          log(`[HEALED] Cleared port conflict on ${targetPort}.`);
        } else {
          log("[SUCCESS] No conflicting processes found on port.");
        }
      } catch {
        log("[SUCCESS] No conflicting processes found on port.");
      }
    } else {
      try {
        const output = execSync(`lsof -t -i:${targetPort}`, { encoding: "utf-8" }).trim();
        const pids = output.split("\n").map(l => l.trim()).filter(Boolean);
        let killedOther = 0;

        for (const pid of pids) {
          if (pid && parseInt(pid) !== process.pid) {
            log(`[HEAL CONFLICT] Found other process ${pid} on port ${targetPort}. Terminating...`);
            execSync(`kill -9 ${pid}`);
            killedOther++;
          }
        }
        if (killedOther > 0) {
          healedCount++;
          reports.push(`Killed ${killedOther} zombie process(es) holding port ${targetPort}.`);
          log(`[HEALED] Cleared port conflict on ${targetPort}.`);
        } else {
          log("[SUCCESS] No conflicting processes found on port.");
        }
      } catch {
        log("[SUCCESS] No conflicting processes found on port.");
      }
    }
  } catch (e: any) {
    log(`[ERROR] Failed to check port conflicts: ${e.message}`);
  }

  // ── 4. Verify Node Modules & Dependencies ──
  log("[STEP 4/4] Verifying node_modules integrity...");
  const nmPath = path.resolve(process.cwd(), "node_modules");
  if (!fs.existsSync(nmPath)) {
    log("[WARNING] node_modules folder is missing! Run 'npm install'.");
    reports.push("node_modules folder is missing.");
  } else {
    log("[SUCCESS] node_modules exists.");
  }

  log("[FINISH] System self-healing complete.");
  
  const reportSummary = reports.length > 0 
    ? `Healed ${healedCount} issues:\n- ${reports.join("\n- ")}`
    : "System is in perfect health. No issues detected.";

  return {
    success: true,
    healedCount,
    report: reportSummary,
  };
};
