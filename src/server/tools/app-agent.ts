import { Type, type FunctionDeclaration } from "@google/genai";
import { exec, execFile, spawn } from "child_process";
import { promisify } from "util";
import fkill from "fkill";
import open, { openApp } from "open";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { Server } from "socket.io";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Helper: write a temp .ps1 file and run it (avoids all comment collapsing and quoting bugs)
async function runPowerShellScript(script: string): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `og_app_ps_${Date.now()}.ps1`);
  try {
    fs.writeFileSync(tmpFile, script, "utf-8");
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", tmpFile,
    ]);
    return (stdout || "").trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

let cachedIsSession0: boolean | null = null;
async function checkIsSession0(): Promise<boolean> {
  if (cachedIsSession0 !== null) return cachedIsSession0;
  try {
    const { stdout } = await execAsync('powershell -NoProfile -Command "[System.Diagnostics.Process]::GetCurrentProcess().SessionId"');
    cachedIsSession0 = stdout.trim() === "0";
  } catch {
    cachedIsSession0 = false;
  }
  return cachedIsSession0;
}

// Prefetch session status in background to avoid any startup latency on first run
checkIsSession0().catch(() => {});

// Helper to launch processes interactively in active desktop session of logged-in user on Windows
async function launchInteractively(target: string): Promise<void> {
  // Check if we are running in Session 0 (Windows Service background context)
  const isSession0 = await checkIsSession0();

  if (isSession0) {
    const { stdout } = await execAsync("whoami");
    const currentUser = stdout.trim();
    const taskName = `OGLaunch_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const isProtocol = target.endsWith(":");
    const isFilePath = (target.includes("\\") || target.includes("/")) && !target.toLowerCase().endsWith(".exe");
    const programCall = (isProtocol || (isFilePath && !target.startsWith("explorer.exe") && !target.startsWith("powershell.exe"))) 
      ? `explorer.exe "${target}"` 
      : target;
    const escapedCall = programCall.replace(/"/g, '\\"');

    await execAsync(`schtasks /create /tn "${taskName}" /tr "${escapedCall}" /sc ONCE /st 00:00 /sd 01/01/2000 /ru "${currentUser}" /it /f`);
    try {
      await execAsync(`schtasks /run /tn "${taskName}"`);
    } finally {
      await execAsync(`schtasks /delete /tn "${taskName}" /f`);
    }
  } else {
    // Running in active interactive user session (Session 1+)
    // Run via cmd.exe /c start in detached mode to bypass hidden console window parenting
    const child = spawn("cmd.exe", ["/c", "start", "", target], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  }
}

// Map of site keywords to URL patterns for tab closing
const SITE_TAB_MAP: Record<string, string> = {
  "whatsapp":   "web.whatsapp.com",
  "gmail":      "mail.google.com",
  "youtube":    "youtube.com",
  "google":     "google.com",
  "facebook":   "facebook.com",
  "instagram":  "instagram.com",
  "twitter":    "twitter.com",
  "x":          "x.com",
  "linkedin":   "linkedin.com",
  "github":     "github.com",
  "netflix":    "netflix.com",
  "spotify":    "open.spotify.com",
  "chatgpt":    "chatgpt.com",
};

// Close a specific Chrome tab by URL pattern using PowerShell + Chrome DevTools
async function closeChromeTab(urlPattern: string): Promise<boolean> {
  try {
    // Use Chrome's remote debugging or just send Ctrl+W to matching window
    // Most reliable: use PowerShell to find Chrome window with title matching site
    const ps = `
$pattern = "${urlPattern}"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@
$found = $false
[WinAPI]::EnumWindows({
  param($hwnd, $lparam)
  $sb = New-Object System.Text.StringBuilder 256
  [WinAPI]::GetWindowText($hwnd, $sb, 256) | Out-Null
  $title = $sb.ToString()
  if ([WinAPI]::IsWindowVisible($hwnd) -and $title -match $pattern) {
    [WinAPI]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 300
    # Ctrl+W closes current tab
    [WinAPI]::keybd_event(0x11, 0, 0, 0)  # Ctrl down
    [WinAPI]::keybd_event(0x57, 0, 0, 0)  # W down
    [WinAPI]::keybd_event(0x57, 0, 2, 0)  # W up
    [WinAPI]::keybd_event(0x11, 0, 2, 0)  # Ctrl up
    $script:found = $true
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
Write-Output $found
`.trim();

    const stdout = await runPowerShellScript(ps);
    return stdout.toLowerCase() === "true";
  } catch {
    return false;
  }
}

// Helper: Fuzzy close process by name / keyword using PowerShell
async function closeProcessFuzzy(appName: string): Promise<boolean> {
  const clean = appName.toLowerCase().trim();
  const keywords: string[] = [clean];
  if (clean.includes("vs code") || clean.includes("vscode") || clean.includes("visual studio code")) {
    keywords.push("code");
  }
  if (clean.includes("chrome") || clean.includes("google chrome")) {
    keywords.push("chrome");
  }
  if (clean.includes("calculator") || clean.includes("calc")) {
    keywords.push("calc", "calculator", "calculatorapp");
  }
  if (clean.includes("spotify")) {
    keywords.push("spotify");
  }
  if (clean.includes("excel")) {
    keywords.push("excel");
  }
  if (clean.includes("word")) {
    keywords.push("winword");
  }
  if (clean.includes("powerpoint") || clean.includes("ppt")) {
    keywords.push("powerpnt");
  }
  if (clean.includes("notepad")) {
    keywords.push("notepad");
  }

  let filterConditions = keywords.map(kw => `$_.Name -like '*${kw}*' -or $_.Description -like '*${kw}*' -or $_.MainWindowTitle -like '*${kw}*'`).join(" -or ");
  const ps = `
$found = $false
$procs = Get-Process | Where-Object { ${filterConditions} }
if ($procs) {
  $procs | Stop-Process -Force -ErrorAction SilentlyContinue
  $found = $true
}
Write-Output $found
`.trim();

  try {
    const stdout = await runPowerShellScript(ps);
    return stdout.toLowerCase() === "true";
  } catch {
    return false;
  }
}

export const appToolDeclarations: FunctionDeclaration[] = [
  {
    name: "open_app",
    description: "Opens a specific application on the user's local computer.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        app_name: {
          type: Type.STRING,
          description: "The exact system name of the application, e.g., 'Spotify', 'Calculator', 'Code', 'Notepad'",
        },
      },
      required: ["app_name"],
    },
  },
  {
    name: "close_app",
    description: "Closes a running application OR a browser tab/website. Use for: 'close WhatsApp', 'close YouTube tab', 'close Gmail', 'band karo', 'close Notepad', etc. For websites/tabs use the site name.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        app_name: {
          type: Type.STRING,
          description: "App name like 'Notepad', 'Spotify' OR website name like 'WhatsApp', 'YouTube', 'Gmail', 'Instagram'",
        },
      },
      required: ["app_name"],
    },
  },
];

export const handleAppAction = async (fc: any, io: Server) => {
  let resultStr = "";
  const args = fc.args as any;

  try {
    if (fc.name === "open_app") {
      io.emit("system_status", `[APP] Launching: ${args.app_name}`);

      const platform = os.platform();
      const cleanName = args.app_name.toLowerCase().replace(".exe", "").trim();

      const winMap: Record<string, string> = {
        camera:     "microsoft.windows.camera:",
        settings:   "ms-settings:",
        calculator: "calc",
        paint:      "ms-paint:",
        photos:     "ms-photos:",
        mail:       "outlookmail:",
        clock:      "ms-clock:",
        weather:    "msnweather:",
        explorer:   "explorer",
        files:      "explorer",
        downloads:  "explorer.exe shell:Downloads",
        documents:  "explorer.exe shell:Personal",
        notepad:    "notepad",
        chrome:     "chrome",
        "google chrome": "chrome",
        "vs code":  "code",
        vscode:     "code",
        "visual studio code": "code",
        spotify:    "spotify:",
        word:       "winword",
        excel:      "excel",
        powerpoint: "powerpnt",
        cmd:        "cmd",
        "command prompt": "cmd",
        powershell: "powershell",
        terminal:   "wt",
        instagram:  "https://instagram.com",
        youtube:    "https://youtube.com",
      };

      if (platform === "win32") {
        const target = winMap[cleanName] || args.app_name;
        await launchInteractively(target);
      } else {
        await openApp(args.app_name);
      }
      resultStr = `Success: Launched ${args.app_name}.`;

    } else if (fc.name === "close_app") {
      const platform = os.platform();
      const cleanName = args.app_name.toLowerCase().replace(".exe", "").trim();
      io.emit("system_status", `[APP] Closing: ${args.app_name}`);

      // Check if it's a website/tab first
      const siteKey = Object.keys(SITE_TAB_MAP).find((k) => cleanName.includes(k));

      if (siteKey) {
        // It's a website — close the browser tab
        const urlPattern = SITE_TAB_MAP[siteKey];
        const closed = await closeChromeTab(urlPattern);
        if (closed) {
          resultStr = `Closed ${args.app_name} tab in browser.`;
          io.emit("system_status", `[BROWSER] Closed tab: ${args.app_name}`);
        } else {
          // Tab not found by title — try fuzzy closing or process killing
          if (platform === "win32") {
            const fuzzyClosed = await closeProcessFuzzy(args.app_name);
            if (fuzzyClosed) {
              resultStr = `Closed ${args.app_name} application.`;
              io.emit("system_status", `[APP] Closed process: ${args.app_name}`);
            } else {
              resultStr = `Could not find an open ${args.app_name} tab or app to close.`;
              io.emit("system_status", `[APP] ${args.app_name} not found open`);
            }
          } else {
            try {
              await fkill(args.app_name, { force: true, ignoreCase: true });
              resultStr = `Closed ${args.app_name}.`;
            } catch {
              resultStr = `Could not find an open ${args.app_name} tab or app to close.`;
            }
          }
        }
      } else {
        // Regular app — kill process
        if (platform === "win32") {
          const fuzzyClosed = await closeProcessFuzzy(args.app_name);
          if (fuzzyClosed) {
            resultStr = `Success: Closed ${args.app_name}.`;
            io.emit("system_status", `[APP] Terminated: ${args.app_name}`);
          } else {
            try {
              const processName = args.app_name.replace(/\.exe$/i, "");
              await execAsync(`taskkill /f /im "${processName}.exe" /im "${processName}"`).catch(async () => {
                await execAsync(`powershell -NoProfile -Command "Stop-Process -Name '${processName}' -Force"`);
              });
              resultStr = `Success: Terminated ${args.app_name}.`;
              io.emit("system_status", `[APP] Terminated: ${args.app_name}`);
            } catch {
              resultStr = `Could not find any running app named ${args.app_name} to close.`;
              io.emit("system_status", `[APP] ${args.app_name} not found open`);
            }
          }
        } else {
          try {
            await fkill(args.app_name, { force: true, ignoreCase: true });
            resultStr = `Success: Terminated ${args.app_name}.`;
            io.emit("system_status", `[APP] Terminated: ${args.app_name}`);
          } catch (fkillErr) {
            throw fkillErr;
          }
        }
      }
    }
  } catch (err: any) {
    resultStr = `Error managing ${args.app_name}. Details: ${err.message}`;
    io.emit("system_status", `[APP ERROR] Failed to manage ${args.app_name}`);
  }

  return {
    id: fc.id,
    name: fc.name,
    response: { result: resultStr },
  };
};
