import { Type, GoogleGenAI, type FunctionDeclaration } from "@google/genai";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Server } from "socket.io";
import { runSelfHealing } from "../utils/self-healing.js";
import { sendDaemonClick } from "../utils/click-daemon.js";

const execAsync  = promisify(exec);
const execFileAsync = promisify(execFile);

// ── Helper: write a temp .ps1 file and run it (avoids all quoting nightmares) ─
async function runPowerShellScript(script: string): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `og_ps_${Date.now()}.ps1`);
  try {
    fs.writeFileSync(tmpFile, script, "utf-8");
    const { stdout, stderr } = await execFileAsync("powershell.exe", [
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

// ── Tool Declarations ─────────────────────────────────────────────────────────
export const systemToolDeclarations: FunctionDeclaration[] = [

  // ── Volume Control ──────────────────────────────────────────────────────────
  {
    name: "set_volume",
    description: "Sets the system volume to a specific level (0-100). Use when user says 'volume 50 karo', 'volume badhao', 'volume kam karo', 'mute karo', 'unmute karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        level: {
          type: Type.NUMBER,
          description: "Volume level from 0 (mute) to 100 (max).",
        },
        action: {
          type: Type.STRING,
          description: "Optional: 'mute', 'unmute', or 'set'. Default is 'set'.",
          enum: ["set", "mute", "unmute"],
        },
      },
      required: ["level"],
    },
  },

  // ── Brightness Control ──────────────────────────────────────────────────────
  {
    name: "set_brightness",
    description: "Sets the screen brightness to a specific level (0-100). Use when user says 'brightness badhao', 'brightness kam karo', 'brightness 50 karo', 'screen bright karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        level: {
          type: Type.NUMBER,
          description: "Brightness level from 0 (darkest) to 100 (brightest).",
        },
      },
      required: ["level"],
    },
  },

  // ── Screenshot ──────────────────────────────────────────────────────────────
  {
    name: "take_screenshot",
    description: "Takes a screenshot of the current screen and saves it to the Desktop. Use when user says 'screenshot lo', 'screen capture karo', 'screen shot'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        save_path: {
          type: Type.STRING,
          description: "Optional full path to save the screenshot. Defaults to Desktop with a timestamp filename.",
        },
      },
      required: [],
    },
  },

  // ── Clipboard ───────────────────────────────────────────────────────────────
  {
    name: "clipboard_write",
    description: "Copies text to the system clipboard. Use when user says 'clipboard mein copy karo', 'copy this text', 'clipboard pe daalo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: {
          type: Type.STRING,
          description: "The text to copy to clipboard.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "clipboard_read",
    description: "Reads and returns the current text content from the system clipboard. Use when user says 'clipboard mein kya hai', 'clipboard padhao', 'paste kya hoga'.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },

  // ── Reminder / Timer ────────────────────────────────────────────────────────
  {
    name: "set_reminder",
    description: "Sets a reminder or timer that will notify the user after a specified time. Use when user says 'remind karo', 'timer lagao', 'X minute baad batana', 'alarm set karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        message: {
          type: Type.STRING,
          description: "The reminder message to show when the timer fires.",
        },
        minutes: {
          type: Type.NUMBER,
          description: "Number of minutes from now to trigger the reminder.",
        },
        seconds: {
          type: Type.NUMBER,
          description: "Additional seconds on top of minutes. Use for sub-minute timers like '30 seconds baad'.",
        },
      },
      required: ["message", "minutes"],
    },
  },

  // ── Running Processes ───────────────────────────────────────────────────────
  {
    name: "list_processes",
    description: "Lists currently running processes on the system. Use when user says 'kya kya chal raha hai', 'running apps batao', 'processes dikhao', 'task manager'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filter: {
          type: Type.STRING,
          description: "Optional: filter processes by name, e.g., 'chrome' or 'node'. Leave empty for top processes by CPU.",
        },
      },
      required: [],
    },
  },

  // ── System Info ─────────────────────────────────────────────────────────────
  {
    name: "get_system_info",
    description: "Returns system information: CPU, RAM usage, disk space, OS version, uptime. Use when user says 'system info do', 'RAM kitni hai', 'disk space batao', 'CPU usage kya hai'.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },

  // ── Lock / Sleep / Shutdown ─────────────────────────────────────────────────
  {
    name: "power_action",
    description: "Performs a system power action: lock screen, sleep, restart, or shutdown. Use when user says 'screen lock karo', 'sleep mode', 'restart karo', 'shutdown karo', 'band karo PC'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "The power action to perform.",
          enum: ["lock", "sleep", "restart", "shutdown"],
        },
        delay_seconds: {
          type: Type.NUMBER,
          description: "Optional delay in seconds before performing the action. Default is 0.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "heal_system_problems",
    description: "Scans the system for common problems (zombie processes, port conflicts, temp file buildup, configuration errors) and heals them. Use when user says 'self heal', 'problems theek karo', 'check health', 'system troubleshoot'.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
  {
    name: "screen_click",
    description: "Locates a UI element (button, icon, input box, text link, etc.) on the screen using Vision AI and performs a mouse action (click, double_click, right_click, hover, or type). Use when user says 'Downloads button click karo', 'double click on chrome', 'type hello in the search bar', 'move mouse to recycle bin', 'click here'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        description: {
          type: Type.STRING,
          description: "The description of the element to click/find, e.g., 'the Chrome icon' or 'the Downloads button'.",
        },
        action: {
          type: Type.STRING,
          description: "The mouse action to perform on the located element.",
          enum: ["click", "double_click", "right_click", "hover", "type"],
        },
        text_to_type: {
          type: Type.STRING,
          description: "Required only if the action is 'type'. The text to write into the element after clicking it.",
        },
      },
      required: ["description"],
    },
  },
];

// ── Active reminders store ────────────────────────────────────────────────────
const activeReminders: Map<string, ReturnType<typeof setTimeout>> = new Map();

// ── System Agent Handler ──────────────────────────────────────────────────────
export const handleSystemAction = async (fc: any, io: Server): Promise<any> => {
  let resultStr = "";
  const args = fc.args as any;
  const platform = os.platform();

  try {

    // ── set_volume ────────────────────────────────────────────────────────────
    if (fc.name === "set_volume") {
      const action = args.action || "set";
      const level  = Math.max(0, Math.min(100, Math.round(args.level ?? 50)));

      if (platform === "win32") {
        if (action === "mute") {
          // VK_VOLUME_MUTE = 0xAD (173)
          const script = `
$wsh = New-Object -ComObject WScript.Shell
$wsh.SendKeys([char]173)
`;
          await runPowerShellScript(script);
          resultStr = "System muted.";
          io.emit("system_status", "[SYSTEM] Volume: Muted");

        } else if (action === "unmute") {
          const script = `
$wsh = New-Object -ComObject WScript.Shell
$wsh.SendKeys([char]173)
`;
          await runPowerShellScript(script);
          resultStr = "System unmuted.";
          io.emit("system_status", "[SYSTEM] Volume: Unmuted");

        } else {
          // Use Windows Audio COM API via a proper .ps1 file
          const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int _VtblGap1_4();
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int _VtblGap2_1();
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int _VtblGap3_4();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute(out bool pbMute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid id, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int _VtblGap1_1();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorClass {}

public static class AudioHelper {
    public static void SetVolume(float level) {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorClass());
        IMMDevice device;
        enumerator.GetDefaultAudioEndpoint(0, 1, out device);
        var iid = typeof(IAudioEndpointVolume).GUID;
        object epvObj;
        device.Activate(ref iid, 23, IntPtr.Zero, out epvObj);
        var epv = (IAudioEndpointVolume)epvObj;
        epv.SetMasterVolumeLevelScalar(level, Guid.Empty);
    }
}
"@
[AudioHelper]::SetVolume(${(level / 100).toFixed(4)})
Write-Output "Volume set to ${level}%"
`;
          await runPowerShellScript(script);
          resultStr = `Volume set to ${level}%.`;
          io.emit("system_status", `[SYSTEM] Volume: ${level}%`);
        }

      } else if (platform === "darwin") {
        await execAsync(`osascript -e "set volume output volume ${level}"`);
        resultStr = `Volume set to ${level}%.`;
        io.emit("system_status", `[SYSTEM] Volume: ${level}%`);
      } else {
        await execAsync(`amixer -D pulse sset Master ${level}%`);
        resultStr = `Volume set to ${level}%.`;
        io.emit("system_status", `[SYSTEM] Volume: ${level}%`);
      }

    // ── set_brightness ────────────────────────────────────────────────────────
    } else if (fc.name === "set_brightness") {
      const level = Math.max(0, Math.min(100, Math.round(args.level ?? 50)));

      if (platform === "win32") {
        // WMI method — works on most laptops with integrated display
        const script = `
$monitors = Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue
if ($monitors -and $monitors.Count -gt 0) {
    $monitors[0].WmiSetBrightness(1, ${level})
    Write-Output "Brightness set to ${level}%"
} else {
    # Fallback: try PowerShell display brightness via CIM
    $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue
    if ($b) {
        Invoke-CimMethod -InputObject ($b | Select-Object -First 1) -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=${level}}
        Write-Output "Brightness set to ${level}%"
    } else {
        Write-Output "ERROR: Brightness control not available on this display (external monitors not supported via WMI)"
    }
}
`;
        const out = await runPowerShellScript(script);
        if (out.startsWith("ERROR:")) {
          resultStr = `Could not set brightness: ${out.replace("ERROR: ", "")}. Note: Brightness control only works on laptop built-in displays, not external monitors.`;
        } else {
          resultStr = `Brightness set to ${level}%.`;
        }
        io.emit("system_status", `[SYSTEM] Brightness: ${level}%`);

      } else if (platform === "darwin") {
        // brightness CLI tool or osascript
        try {
          await execAsync(`brightness ${(level / 100).toFixed(2)}`);
        } catch {
          await execAsync(`osascript -e "tell application \\"System Events\\" to set brightness of display 1 to ${level / 100}"`);
        }
        resultStr = `Brightness set to ${level}%.`;
        io.emit("system_status", `[SYSTEM] Brightness: ${level}%`);
      } else {
        // Linux: xrandr or brightnessctl
        try {
          await execAsync(`brightnessctl set ${level}%`);
        } catch {
          await execAsync(`xrandr --output $(xrandr | grep ' connected' | head -1 | cut -d' ' -f1) --brightness ${(level / 100).toFixed(2)}`);
        }
        resultStr = `Brightness set to ${level}%.`;
        io.emit("system_status", `[SYSTEM] Brightness: ${level}%`);
      }

    // ── take_screenshot ───────────────────────────────────────────────────────
    } else if (fc.name === "take_screenshot") {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const desktopPath = path.join(os.homedir(), "Desktop");
      const fileName    = `screenshot-${timestamp}.png`;
      const savePath    = args.save_path || path.join(desktopPath, fileName);

      if (platform === "win32") {
        const savePathEscaped = savePath.replace(/\\/g, "\\\\");
        const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Force DPI awareness so we get real physical pixel dimensions
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiHelper {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
}
"@
[DpiHelper]::SetProcessDPIAware() | Out-Null

# SM_CXSCREEN=0, SM_CYSCREEN=1 — returns TRUE physical pixels after DPI-aware call
$width  = [DpiHelper]::GetSystemMetrics(0)
$height = [DpiHelper]::GetSystemMetrics(1)

$bitmap   = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size($width, $height)), [System.Drawing.CopyPixelOperation]::SourceCopy)
$bitmap.Save("${savePathEscaped}", [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "saved"
`;
        const out = await runPowerShellScript(script);
        if (out.includes("saved")) {
          resultStr = `Screenshot saved to: ${savePath}`;
          io.emit("system_status", `[SYSTEM] Screenshot saved: ${fileName}`);
        } else {
          resultStr = `Screenshot failed. Output: ${out}`;
          io.emit("system_status", `[SYSTEM] Screenshot error: ${out}`);
        }

      } else if (platform === "darwin") {
        await execAsync(`screencapture -x "${savePath}"`);
        resultStr = `Screenshot saved to: ${savePath}`;
        io.emit("system_status", `[SYSTEM] Screenshot saved: ${fileName}`);
      } else {
        await execAsync(`scrot "${savePath}"`);
        resultStr = `Screenshot saved to: ${savePath}`;
        io.emit("system_status", `[SYSTEM] Screenshot saved: ${fileName}`);
      }

    // ── clipboard_write ───────────────────────────────────────────────────────
    } else if (fc.name === "clipboard_write") {
      const text = args.text || "";

      if (platform === "win32") {
        const script = `Set-Clipboard -Value @"\n${text.replace(/"/g, '`"')}\n"@\nWrite-Output "done"`;
        await runPowerShellScript(script);
      } else if (platform === "darwin") {
        await execAsync(`printf '%s' ${JSON.stringify(text)} | pbcopy`);
      } else {
        await execAsync(`printf '%s' ${JSON.stringify(text)} | xclip -selection clipboard`);
      }
      resultStr = `Copied to clipboard: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`;
      io.emit("system_status", "[SYSTEM] Clipboard: Text copied");

    // ── clipboard_read ────────────────────────────────────────────────────────
    } else if (fc.name === "clipboard_read") {
      let clipText = "";

      if (platform === "win32") {
        const script = `$c = Get-Clipboard -Raw; if ($c) { Write-Output $c } else { Write-Output "__EMPTY__" }`;
        const out = await runPowerShellScript(script);
        clipText = out === "__EMPTY__" ? "" : out;
      } else if (platform === "darwin") {
        const { stdout } = await execAsync("pbpaste");
        clipText = stdout.trim();
      } else {
        const { stdout } = await execAsync("xclip -selection clipboard -o");
        clipText = stdout.trim();
      }

      resultStr = clipText
        ? `Clipboard content:\n${clipText.slice(0, 500)}${clipText.length > 500 ? "\n[...truncated]" : ""}`
        : "Clipboard is empty.";
      io.emit("system_status", "[SYSTEM] Clipboard: Read");

    // ── set_reminder ──────────────────────────────────────────────────────────
    } else if (fc.name === "set_reminder") {
      const minutes  = Math.max(0, args.minutes || 0);
      const seconds  = Math.max(0, args.seconds || 0);
      const totalMs  = (minutes * 60 + seconds) * 1000;
      const message  = args.message || "Reminder!";
      const reminderId = `reminder-${Date.now()}`;

      if (totalMs === 0) {
        resultStr = "Error: Please specify a time greater than 0 seconds.";
      } else {
        const displayTime = minutes > 0
          ? `${minutes} minute${minutes !== 1 ? "s" : ""}${seconds > 0 ? ` ${seconds}s` : ""}`
          : `${seconds} second${seconds !== 1 ? "s" : ""}`;

        const timer = setTimeout(async () => {
          activeReminders.delete(reminderId);

          if (platform === "win32") {
            const safeMsg = message.replace(/"/g, "'").replace(/\n/g, " ");
            const script = `
Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$notify.BalloonTipTitle = "OG Assistant Reminder"
$notify.BalloonTipText = "${safeMsg}"
$notify.Visible = $true
$notify.ShowBalloonTip(8000)
Start-Sleep -Seconds 9
$notify.Dispose()
`;
            runPowerShellScript(script).catch(() => {});
          } else if (platform === "darwin") {
            execAsync(`osascript -e 'display notification "${message.replace(/"/g, "'")}" with title "OG Assistant Reminder"'`).catch(() => {});
          } else {
            execAsync(`notify-send "OG Assistant Reminder" "${message.replace(/"/g, "'")}"`).catch(() => {});
          }

          io.emit("system_status", `[REMINDER] ${message}`);
          io.emit("transcript_chunk", { role: "AGENT", text: `⏰ Reminder: ${message}` });
          io.emit("turn_complete");
        }, totalMs);

        activeReminders.set(reminderId, timer);
        resultStr = `Reminder set! I'll remind you in ${displayTime}: "${message}"`;
        io.emit("system_status", `[SYSTEM] Reminder set: ${displayTime}`);
      }

    // ── list_processes ────────────────────────────────────────────────────────
    } else if (fc.name === "list_processes") {
      const filter = (args.filter || "").toLowerCase().trim();

      if (platform === "win32") {
        try {
          const { stdout } = await execAsync(`tasklist /fo csv`);
          const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          const processes: { name: string; pid: string; mem: string }[] = [];
          
          for (let i = 1; i < lines.length; i++) {
            const cleanLine = lines[i].replace(/^"/, "").replace(/"$/, "");
            const parts = cleanLine.split('","');
            if (parts.length >= 5) {
              processes.push({
                name: parts[0],
                pid: parts[1],
                mem: parts[4]
              });
            }
          }

          // Filter by keyword if provided
          let filtered = processes;
          if (filter) {
            filtered = processes.filter(p => p.name.toLowerCase().includes(filter));
          }

          if (filtered.length > 0) {
            // Sort by Memory Usage (descending)
            const parseMem = (m: string) => {
              const num = parseInt(m.replace(/[^0-9]/g, ''), 10);
              return isNaN(num) ? 0 : num;
            };
            filtered.sort((a, b) => parseMem(b.mem) - parseMem(a.mem));

            // Format as a neat table
            const header = `${"Image Name".padEnd(25)} ${"PID".padEnd(8)} ${"Mem Usage".padEnd(15)}`;
            const separator = "-".repeat(50);
            const rows = filtered.slice(0, 20).map(p => {
              return `${p.name.slice(0, 24).padEnd(25)} ${p.pid.padEnd(8)} ${p.mem.padEnd(15)}`;
            });
            resultStr = [header, separator, ...rows].join("\n");
          } else {
            resultStr = `No processes found matching "${filter}".`;
          }
        } catch {
          // Fallback to powershell if tasklist fails
          const script = filter
            ? `Get-Process | Where-Object { $_.Name -like '*${filter}*' } | Select-Object Name, Id, @{N='CPU';E={[math]::Round($_.CPU,1)}}, @{N='RAM_MB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | Sort-Object CPU -Descending | Select-Object -First 20 | Format-Table -AutoSize | Out-String`
            : `Get-Process | Select-Object Name, Id, @{N='CPU';E={[math]::Round($_.CPU,1)}}, @{N='RAM_MB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | Sort-Object CPU -Descending | Select-Object -First 20 | Format-Table -AutoSize | Out-String`;
          const out = await runPowerShellScript(script);
          resultStr = out || "No processes found.";
        }
      } else {
        const cmd = filter
          ? `ps aux | grep -i "${filter}" | head -20`
          : `ps aux --sort=-%cpu | head -21`;
        const { stdout } = await execAsync(cmd);
        resultStr = stdout.trim() || "No processes found.";
      }
      io.emit("system_status", "[SYSTEM] Processes listed");

    // ── get_system_info ───────────────────────────────────────────────────────
    } else if (fc.name === "get_system_info") {
      const cpus      = os.cpus();
      const totalMem  = os.totalmem();
      const freeMem   = os.freemem();
      const usedMem   = totalMem - freeMem;
      const uptimeSec = os.uptime();
      const uptimeHrs = Math.floor(uptimeSec / 3600);
      const uptimeMins = Math.floor((uptimeSec % 3600) / 60);

      let diskInfo = "N/A";
      try {
        if (platform === "win32") {
          const script = `Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N='Used_GB';E={[math]::Round($_.Used/1GB,2)}}, @{N='Free_GB';E={[math]::Round($_.Free/1GB,2)}} | Format-Table -AutoSize | Out-String`;
          diskInfo = await runPowerShellScript(script);
        } else {
          const { stdout } = await execAsync("df -h | head -6");
          diskInfo = stdout.trim();
        }
      } catch {}

      resultStr = [
        `OS: ${os.type()} ${os.release()} (${os.arch()})`,
        `Hostname: ${os.hostname()}`,
        `CPU: ${cpus[0]?.model || "Unknown"} × ${cpus.length} cores`,
        `RAM: ${(usedMem / 1024 ** 3).toFixed(2)} GB used / ${(totalMem / 1024 ** 3).toFixed(2)} GB total (${Math.round((usedMem / totalMem) * 100)}% used)`,
        `Uptime: ${uptimeHrs}h ${uptimeMins}m`,
        `Platform: ${platform}`,
        `\nDisk:\n${diskInfo}`,
      ].join("\n");
      io.emit("system_status", "[SYSTEM] System info fetched");

    // ── power_action ──────────────────────────────────────────────────────────
    } else if (fc.name === "power_action") {
      const action = args.action as string;
      const delay  = Math.max(0, args.delay_seconds || 0);

      if (platform === "win32") {
        const cmds: Record<string, string> = {
          lock:     `rundll32.exe user32.dll,LockWorkStation`,
          sleep:    `powershell -Command "Add-Type -Assembly System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"`,
          restart:  `shutdown /r /t ${delay}`,
          shutdown: `shutdown /s /t ${delay}`,
        };
        if (cmds[action]) {
          await execAsync(cmds[action]);
          resultStr = `${action} initiated.`;
          io.emit("system_status", `[SYSTEM] Power: ${action}`);
        } else {
          resultStr = `Unknown power action: ${action}`;
        }
      } else if (platform === "darwin") {
        const cmds: Record<string, string> = {
          lock:     `pmset displaysleepnow`,
          sleep:    `pmset sleepnow`,
          restart:  `osascript -e 'tell app "System Events" to restart'`,
          shutdown: `osascript -e 'tell app "System Events" to shut down'`,
        };
        if (cmds[action]) {
          await execAsync(cmds[action]);
          resultStr = `${action} initiated.`;
          io.emit("system_status", `[SYSTEM] Power: ${action}`);
        }
      } else {
        const cmds: Record<string, string> = {
          lock:     `xdg-screensaver lock`,
          sleep:    `systemctl suspend`,
          restart:  `shutdown -r +${Math.ceil(delay / 60)}`,
          shutdown: `shutdown -h +${Math.ceil(delay / 60)}`,
        };
        if (cmds[action]) {
          await execAsync(cmds[action]);
          resultStr = `${action} initiated.`;
          io.emit("system_status", `[SYSTEM] Power: ${action}`);
        }
      }

    } else if (fc.name === "heal_system_problems") {
      const logCallback = (msg: string) => {
        io.emit("system_status", `[SELF-HEALING] ${msg}`);
      };
      const summary = await runSelfHealing(logCallback);
      resultStr = summary.report;
      io.emit("system_status", "[SYSTEM] Self-healing complete");

    } else if (fc.name === "screen_click") {
      const clickAction = args.action || "click";
      const desc = args.description;
      const textToType = args.text_to_type || "";

      io.emit("system_status", `[VISION] Capture screen to locate: "${desc}"...`);

      // 1. Take a screenshot to a temp file and find screen dimensions
      const tempDir = os.tmpdir();
      const tempPath = path.join(tempDir, `og_vision_capture_${Date.now()}.png`);
      const tempPathEscaped = tempPath.replace(/\\/g, "\\\\");

      let width = 1920;
      let height = 1080;

      if (platform === "win32") {
        const captureExe = path.join(process.cwd(), "bin", "ScreenCapture.exe");
        try {
          const { stdout } = await execFileAsync(captureExe, [tempPath]);
          const out = stdout.trim();
          if (out.includes("saved")) {
            const match = out.match(/width:(\d+)\|height:(\d+)/);
            if (match) {
              width = parseInt(match[1]);
              height = parseInt(match[2]);
            }
          } else {
            throw new Error(out);
          }
        } catch (err: any) {
          // Fallback to PowerShell if ScreenCapture.exe fails or is missing
          const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiHelper {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
}
"@
[DpiHelper]::SetProcessDPIAware() | Out-Null
$width  = [DpiHelper]::GetSystemMetrics(0)
$height = [DpiHelper]::GetSystemMetrics(1)

$bitmap   = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size($width, $height)), [System.Drawing.CopyPixelOperation]::SourceCopy)
$bitmap.Save("${tempPathEscaped}", [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "saved|width:$width|height:$height"
`;
          const out = await runPowerShellScript(script);
          if (out.includes("saved")) {
            const match = out.match(/width:(\d+)\|height:(\d+)/);
            if (match) {
              width = parseInt(match[1]);
              height = parseInt(match[2]);
            }
          } else {
            throw new Error("Failed to capture screen (both exe and powershell failed): " + out + " (exe error: " + err.message + ")");
          }
        }
      } else {
        throw new Error("Vision click is currently only supported on Windows.");
      }

      // 2. Read image and encode to base64
      if (!fs.existsSync(tempPath)) {
        throw new Error("Screenshot file not found after capture.");
      }
      const base64Image = fs.readFileSync(tempPath, { encoding: "base64" });

      // Clean up temp screenshot file asynchronously
      setTimeout(() => {
        try { fs.unlinkSync(tempPath); } catch {}
      }, 5000);

      // 3. Query Gemini for coordinates
      io.emit("system_status", `[VISION] Analyzing screen resolution ${width}x${height}...`);

      const apiKey = process.env.GOOGLE_API_KEY || "";
      if (!apiKey) {
        throw new Error("GOOGLE_API_KEY environment variable is not configured.");
      }
      const aiClient = new GoogleGenAI({ apiKey });

      const prompt = `
You are a Computer Use Vision Agent.
Your task is to locate the user interface element described as: "${desc}" on the provided screenshot.
The screenshot is captured from a screen of resolution: ${width}x${height}.
Analyze the screenshot carefully. Look for buttons, icons, text inputs, links, or regions matching the description.
Provide the exact center coordinate (x, y) of the element in pixels.
You MUST respond with a JSON object in this format:
{
  "x": <integer_pixel_x>,
  "y": <integer_pixel_y>,
  "confidence": <float_between_0_and_1>,
  "reason": "<short description of what you found>"
}
Do not include any markdown fences or other text. Just the JSON object.
`;

      const response = await aiClient.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: base64Image
                }
              },
              {
                text: prompt
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const respText = response.text?.trim() || "";
      if (!respText) {
        throw new Error("Empty response from Gemini Vision model.");
      }

      let parsed: { x: number; y: number; confidence: number; reason?: string };
      try {
        parsed = JSON.parse(respText);
      } catch (err: any) {
        throw new Error(`Failed to parse coordinate response: ${respText}. Error: ${err.message}`);
      }

      if (typeof parsed.x !== "number" || typeof parsed.y !== "number") {
        throw new Error(`Invalid coordinate response structure: ${respText}`);
      }

      const x = Math.round(parsed.x);
      const y = Math.round(parsed.y);
      const confidence = parsed.confidence || 0.0;
      const reason = parsed.reason || "Element found";

      io.emit("system_status", `[VISION] Element located at (${x}, ${y}) with confidence ${Math.round(confidence * 100)}% (${reason}). Performing action: "${clickAction}"...`);

      // 4. Perform mouse action (PyAutoGUI Daemon -> PyAutoGUI Process -> PowerShell Fallback)
      const helperPath = path.resolve(process.cwd(), "src/server/utils/click-helper.py");
      let success = false;
      let executionMsg = "";
      let pythonErrorMsg = "";

      // Try sending to the running Python click daemon first (super fast, <5ms communication)
      try {
        const daemonRes = await sendDaemonClick(clickAction, x, y, textToType);
        if (daemonRes.includes("done")) {
          success = true;
          executionMsg = "Executed mouse action using PyAutoGUI Daemon.";
        } else {
          throw new Error(daemonRes);
        }
      } catch (daemonErr: any) {
        console.warn("[VISION WARNING] Python Click Daemon failed, falling back to spawning python process:", daemonErr.message);
        // Fallback: spawn one-off python process (slower but robust)
        try {
          const runArgs = [helperPath, clickAction, String(x), String(y)];
          if (clickAction === "type") {
            runArgs.push(textToType);
          }
          const { stdout } = await execFileAsync("python", runArgs);
          if (stdout.trim().includes("done")) {
            success = true;
            executionMsg = "Executed mouse action using PyAutoGUI process fallback.";
          }
        } catch (pythonErr: any) {
          pythonErrorMsg = pythonErr.message;
          console.warn("[VISION WARNING] Python one-off process failed, falling back to PowerShell mouse control:", pythonErr.message);
        }
      }

      if (!success) {
        try {
          if (clickAction === "hover" || clickAction === "click" || clickAction === "double_click" || clickAction === "right_click") {
            let clickScript = `
Add-Type -MemberDefinition @'
[DllImport("user32.dll")]
public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, uint dwExtraInfo);
'@ -Name "Win32Mouse" -Namespace "Win32"

[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
`;
            if (clickAction === "click") {
              clickScript += `
[Win32.Win32Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
[Win32.Win32Mouse]::mouse_event(0x0004, 0, 0, 0, 0)
`;
            } else if (clickAction === "double_click") {
              clickScript += `
[Win32.Win32Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
[Win32.Win32Mouse]::mouse_event(0x0004, 0, 0, 0, 0)
[Win32.Win32Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
[Win32.Win32Mouse]::mouse_event(0x0004, 0, 0, 0, 0)
`;
            } else if (clickAction === "right_click") {
              clickScript += `
[Win32.Win32Mouse]::mouse_event(0x0008, 0, 0, 0, 0)
[Win32.Win32Mouse]::mouse_event(0x0010, 0, 0, 0, 0)
`;
            }
            await runPowerShellScript(clickScript);
            success = true;
            executionMsg = "Executed mouse action using native PowerShell fallback.";
          } else {
            throw new Error(`Action "${clickAction}" not supported by PowerShell fallback.`);
          }
        } catch (psErr: any) {
          throw new Error(`Both PyAutoGUI and PowerShell click fallbacks failed. Python error: ${pythonErrorMsg}, PS error: ${psErr.message}`);
        }
      }

      resultStr = `Successfully located "${desc}" at (${x}, ${y}) [confidence: ${Math.round(confidence * 100)}%] and performed action "${clickAction}". ${executionMsg}`;
      io.emit("system_status", `[VISION SUCCESS] Action "${clickAction}" completed at (${x}, ${y})`);
    } else {
      resultStr = `Error: Unknown system function ${fc.name}`;
    }

  } catch (err: any) {
    resultStr = `Error executing ${fc.name}: ${err.message}`;
    io.emit("system_status", `[SYSTEM ERROR] ${fc.name}: ${err.message}`);
  }

  return {
    id: fc.id,
    name: fc.name,
    response: { result: resultStr },
  };
};
