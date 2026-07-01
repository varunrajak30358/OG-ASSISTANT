import { spawn, ChildProcess } from "child_process";
import * as net from "net";
import * as path from "path";
import * as fs from "fs";

let daemonProcess: ChildProcess | null = null;
const DAEMON_PORT = 9993;

export function startClickDaemon() {
  if (daemonProcess) return;

  const helperPath = path.resolve(process.cwd(), "src/server/utils/click-helper.py");
  if (!fs.existsSync(helperPath)) {
    console.warn("[DAEMON WARNING] click-helper.py not found, daemon will not start.");
    return;
  }

  console.log("[DAEMON] Starting Python Mouse Click Daemon on port", DAEMON_PORT);
  daemonProcess = spawn("python", [helperPath, "--daemon", String(DAEMON_PORT)]);

  daemonProcess.stdout?.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg.includes("daemon_ready")) {
      console.log(`[DAEMON SUCCESS] Mouse Click Daemon online: ${msg}`);
    }
  });

  daemonProcess.stderr?.on("data", (data) => {
    console.warn(`[DAEMON ERROR LOG] ${data.toString().trim()}`);
  });

  daemonProcess.on("close", (code) => {
    console.log(`[DAEMON] Mouse Click Daemon exited with code ${code}`);
    daemonProcess = null;
  });

  // Automatically kill daemon on process exit
  process.on("exit", () => stopClickDaemon());
  process.on("SIGINT", () => { stopClickDaemon(); process.exit(); });
  process.on("SIGTERM", () => { stopClickDaemon(); process.exit(); });
}

export function stopClickDaemon() {
  if (daemonProcess) {
    console.log("[DAEMON] Stopping Mouse Click Daemon...");
    try {
      daemonProcess.kill("SIGTERM");
    } catch {}
    daemonProcess = null;
  }
}

export function sendDaemonClick(action: string, x: number, y: number, text = ""): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let responseData = "";

    client.connect(DAEMON_PORT, "127.0.0.1", () => {
      const cmd = JSON.stringify({ action, x, y, text });
      client.write(cmd);
    });

    client.on("data", (chunk) => {
      responseData += chunk.toString();
    });

    client.on("end", () => {
      resolve(responseData.trim());
    });

    client.on("error", (err) => {
      reject(err);
    });

    // Timeout socket if no response in 5 seconds
    client.setTimeout(5000, () => {
      client.destroy();
      reject(new Error("Daemon socket timeout"));
    });
  });
}
