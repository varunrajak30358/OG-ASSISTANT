/**
 * YouTube Agent — Full YouTube media control via PowerShell keyboard simulation.
 * Supports: play/pause, stop, skip forward/backward, next/prev video,
 * volume up/down, mute, fullscreen, search & play, open playlist, like/dislike.
 *
 * Strategy: Focus the Chrome/Edge window that has youtube.com open,
 * then send the appropriate YouTube keyboard shortcut.
 *
 * YouTube keyboard shortcuts used:
 *   k or Space  → Play / Pause
 *   l           → Forward 10 seconds
 *   j           → Rewind 10 seconds
 *   Shift+N     → Next video
 *   Shift+P     → Previous video
 *   Up Arrow    → Volume Up
 *   Down Arrow  → Volume Down
 *   m           → Mute / Unmute
 *   f           → Fullscreen toggle
 *   t           → Theatre mode
 *   ,           → Previous frame
 *   .           → Next frame
 *   0-9         → Seek to 0-90%
 */

import { Type, type FunctionDeclaration } from "@google/genai";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { Server } from "socket.io";
import open from "open";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ── PowerShell script helper ───────────────────────────────────────────────────
async function runPS(script: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `yt_ps_${Date.now()}.ps1`);
  try {
    fs.writeFileSync(tmp, script, "utf-8");
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tmp,
    ], { timeout: 8000 });
    return (stdout || "").trim();
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/**
 * Focus the YouTube browser window and send a key.
 * Works for Chrome, Edge, Firefox, Brave.
 */
async function sendYouTubeKey(key: string): Promise<{ ok: boolean; detail: string }> {
  const platform = os.platform();

  if (platform === "win32") {
    // This PS script:
    // 1. Finds any visible window whose title contains "YouTube"
    // 2. Brings it to foreground
    // 3. Sends the key via SendKeys
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc e, IntPtr l);
    [DllImport("user32.dll")] public static extern int  GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
}
"@

$found = $false
$hwnd  = [IntPtr]::Zero

[Win32]::EnumWindows({
    param($h, $l)
    if (-not [Win32]::IsWindowVisible($h)) { return $true }
    $sb = New-Object System.Text.StringBuilder 512
    [Win32]::GetWindowText($h, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t -match "YouTube" -or $t -match "youtube") {
        $script:hwnd  = $h
        $script:found = $true
        return $false   # stop enum
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

if ($found) {
    [Win32]::ShowWindow($hwnd, 9)          # SW_RESTORE
    [Win32]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 350
    $wsh = New-Object -ComObject WScript.Shell
    $wsh.SendKeys("${key}")
    Write-Output "OK"
} else {
    Write-Output "NOT_FOUND"
}
`;
    const out = await runPS(script);
    if (out === "OK") return { ok: true, detail: "Key sent to YouTube window" };
    if (out === "NOT_FOUND") return { ok: false, detail: "No YouTube window found. Open YouTube in your browser first." };
    return { ok: false, detail: `Unexpected: ${out}` };

  } else if (platform === "darwin") {
    // macOS: use AppleScript to activate Chrome and send key
    const appleScript = `
tell application "Google Chrome"
  activate
  set w to first window
  set t to title of active tab of w
  if t contains "YouTube" then
    tell application "System Events"
      key code ${key}
    end tell
    return "OK"
  else
    return "NOT_FOUND"
  end if
end tell
`;
    const { stdout } = await execAsync(`osascript -e '${appleScript}'`);
    return stdout.trim() === "OK"
      ? { ok: true, detail: "Key sent" }
      : { ok: false, detail: "YouTube tab not active in Chrome" };
  } else {
    // Linux: xdotool
    try {
      await execAsync(`xdotool search --name "YouTube" windowfocus --sync key "${key}"`);
      return { ok: true, detail: "Key sent" };
    } catch (e: any) {
      return { ok: false, detail: e.message };
    }
  }
}

/**
 * Send SendKeys-compatible special key sequences for YouTube.
 * Maps logical action names to the correct SendKeys string.
 */
const ACTION_KEY_MAP: Record<string, string> = {
  play_pause:    "k",
  forward_10:    "l",
  rewind_10:     "j",
  forward_5:     "{RIGHT}",
  rewind_5:      "{LEFT}",
  next_video:    "+N",          // Shift+N
  prev_video:    "+P",          // Shift+P
  volume_up:     "{UP}",
  volume_down:   "{DOWN}",
  mute:          "m",
  fullscreen:    "f",
  theatre_mode:  "t",
  seek_0:        "0",
  seek_10:       "1",
  seek_20:       "2",
  seek_30:       "3",
  seek_40:       "4",
  seek_50:       "5",
  seek_60:       "6",
  seek_70:       "7",
  seek_80:       "8",
  seek_90:       "9",
  like:          "+.",          // actually opens "Like" — not reliable, skip
  captions:      "c",
  speed_up:      ">",
  speed_down:    "<",
  miniplayer:    "i",
};

// ── Tool declarations ─────────────────────────────────────────────────────────
export const youtubeToolDeclarations: FunctionDeclaration[] = [
  {
    name: "youtube_control",
    description: `Controls YouTube playback in the browser. Use for:
- 'play' / 'pause' / 'play karo' / 'pause karo' / 'roko' → action: play_pause
- 'forward karo' / 'aage karo' / 'skip forward' → action: forward_10
- 'peeche karo' / 'rewind' / 'wapas karo' → action: rewind_10
- 'agla video' / 'next song' / 'next track' → action: next_video
- 'pichla video' / 'previous' → action: prev_video
- 'volume badhao' / 'louder' → action: volume_up (repeat N times)
- 'volume kam karo' / 'quiet' → action: volume_down (repeat N times)
- 'mute karo' / 'sound band karo' → action: mute
- 'fullscreen karo' / 'bada karo' → action: fullscreen
- 'shuru se chalao' / 'beginning se' → action: seek_0
- 'speed badhao' / 'fast karo' → action: speed_up
- 'speed kam karo' / 'slow karo' → action: speed_down
- 'captions on/off' / 'subtitle' → action: captions`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "The YouTube control action to perform.",
          enum: [
            "play_pause",
            "forward_10",
            "rewind_10",
            "forward_5",
            "rewind_5",
            "next_video",
            "prev_video",
            "volume_up",
            "volume_down",
            "mute",
            "fullscreen",
            "theatre_mode",
            "seek_0",
            "seek_10",
            "seek_20",
            "seek_30",
            "seek_40",
            "seek_50",
            "seek_60",
            "seek_70",
            "seek_80",
            "seek_90",
            "captions",
            "speed_up",
            "speed_down",
            "miniplayer",
          ],
        },
        repeat: {
          type: Type.NUMBER,
          description: "How many times to repeat the action. Useful for volume: 'volume 5 baar badhao'. Default 1, max 20.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "youtube_search_play",
    description: `Searches YouTube for a song/video and opens the first result directly.
Use for: 'play [song name] on YouTube', 'YouTube pe [song] chalao', 'play [artist] song'.
This opens the YouTube search results — user can click the first result, OR use youtube_play_first_result to auto-click.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Song or video to search and play, e.g., 'Kesariya Arijit Singh', 'Shape of You Ed Sheeran'",
        },
        auto_play: {
          type: Type.BOOLEAN,
          description: "If true, automatically clicks the first video result. Default false (opens search page).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "youtube_seek",
    description: "Seeks to a specific time in a YouTube video. Use when user says 'X minute pe ja', '2:30 pe jao', 'seek to 1 minute 30 seconds'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        minutes: {
          type: Type.NUMBER,
          description: "Minutes to seek to.",
        },
        seconds: {
          type: Type.NUMBER,
          description: "Seconds to seek to (added to minutes).",
        },
      },
      required: ["minutes"],
    },
  },
];

async function openUrlInteractive(url: string, io?: Server): Promise<void> {
  let cleaned = url.trim().replace(/"/g, "%22");
  if (!/^[a-zA-Z0-9+-.]+:\/\//.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }

  if (io) {
    io.emit("open_url", { url: cleaned });
  }

  const platform = os.platform();
  if (platform === "win32") {
    try {
      await open(cleaned);
    } catch {
      await execAsync(`start "" "${cleaned}"`);
    }
  } else if (platform === "darwin") {
    await execAsync(`open "${cleaned}"`);
  } else {
    await execAsync(`xdg-open "${cleaned}"`);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export const handleYouTubeAction = async (fc: any, io: Server): Promise<any> => {
  let resultStr = "";
  const args = fc.args as any;
  const platform = os.platform();

  try {
    // ── youtube_control ────────────────────────────────────────────────────────
    if (fc.name === "youtube_control") {
      const action = args.action as string;
      const repeat = Math.min(Math.max(1, Math.round(args.repeat || 1)), 20);
      const key = ACTION_KEY_MAP[action];

      if (!key) {
        resultStr = `Unknown YouTube action: ${action}`;
        return { id: fc.id, name: fc.name, response: { result: resultStr } };
      }

      io.emit("system_status", `[YOUTUBE] ${action.replace(/_/g, " ")} ×${repeat}`);

      // Send key N times (with small delay between repeats for volume)
      let lastResult = { ok: false, detail: "" };
      for (let i = 0; i < repeat; i++) {
        lastResult = await sendYouTubeKey(key);
        if (!lastResult.ok) break;
        if (repeat > 1) await new Promise((r) => setTimeout(r, 120));
      }

      if (lastResult.ok) {
        const actionLabels: Record<string, string> = {
          play_pause:   "Toggled play/pause",
          forward_10:   `Skipped forward 10s${repeat > 1 ? ` ×${repeat}` : ""}`,
          rewind_10:    `Rewound 10s${repeat > 1 ? ` ×${repeat}` : ""}`,
          forward_5:    `Skipped forward 5s`,
          rewind_5:     "Rewound 5s",
          next_video:   "Skipped to next video",
          prev_video:   "Went to previous video",
          volume_up:    `Volume up${repeat > 1 ? ` ×${repeat}` : ""}`,
          volume_down:  `Volume down${repeat > 1 ? ` ×${repeat}` : ""}`,
          mute:         "Toggled mute",
          fullscreen:   "Toggled fullscreen",
          theatre_mode: "Toggled theatre mode",
          captions:     "Toggled captions/subtitles",
          speed_up:     "Increased playback speed",
          speed_down:   "Decreased playback speed",
          miniplayer:   "Toggled miniplayer",
        };
        resultStr = actionLabels[action] || `Executed: ${action}`;
        if (action.startsWith("seek_")) {
          const pct = action.replace("seek_", "");
          resultStr = `Seeked to ${pct}% of the video`;
        }
      } else {
        resultStr = lastResult.detail;
      }

    // ── youtube_search_play ────────────────────────────────────────────────────
    } else if (fc.name === "youtube_search_play") {
      const query = args.query as string;
      const autoPlay = args.auto_play === true;

      io.emit("system_status", `[YOUTUBE] Searching: ${query}`);

      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      await openUrlInteractive(searchUrl, io);

      if (autoPlay && platform === "win32") {
        // Wait for page to load, then auto-click first result using JS injection via keyboard
        await new Promise((r) => setTimeout(r, 2500));

        // Focus YouTube window and navigate to first result
        const psClickFirst = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32YT {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc e, IntPtr l);
    [DllImport("user32.dll")] public static extern int  GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
}
"@
$found = $false
[Win32YT]::EnumWindows({
    param($h, $l)
    if (-not [Win32YT]::IsWindowVisible($h)) { return $true }
    $sb = New-Object System.Text.StringBuilder 512
    [Win32YT]::GetWindowText($h, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t -match "YouTube") {
        $script:found = $true
        [Win32YT]::ShowWindow($h, 9) | Out-Null
        [Win32YT]::SetForegroundWindow($h) | Out-Null
        Start-Sleep -Milliseconds 400
        # Tab to first video result and press Enter
        $wsh = New-Object -ComObject WScript.Shell
        $wsh.SendKeys("{TAB}{TAB}{TAB}{TAB}{ENTER}")
        return $false
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
Write-Output $(if ($found) { "OK" } else { "NOT_FOUND" })
`;
        const out = await runPS(psClickFirst);
        resultStr = out === "OK"
          ? `Playing first YouTube result for: "${query}"`
          : `Opened YouTube search for: "${query}". Click the video to play.`;
      } else {
        resultStr = autoPlay
          ? `Opened YouTube search for: "${query}". Click the video to play.`
          : `Opened YouTube search for: "${query}". Tap the first video to play.`;
      }

      io.emit("system_status", `[YOUTUBE] Search opened: ${query}`);

    // ── youtube_seek ──────────────────────────────────────────────────────────
    } else if (fc.name === "youtube_seek") {
      const minutes = Math.max(0, args.minutes || 0);
      const seconds = Math.max(0, args.seconds || 0);
      const totalSeconds = minutes * 60 + seconds;

      io.emit("system_status", `[YOUTUBE] Seeking to ${minutes}m${seconds}s`);

      if (platform === "win32") {
        // YouTube URL supports t= parameter, but we need to manipulate the current tab.
        // Best approach: use browser console via keyboard shortcut + type JS
        // Actually the cleanest way: focus YouTube, use address bar trick or
        // inject via keyboard. Use the "seek by percentage" approach if < 10 min
        // OR use browser's URL bar to reload at timestamp.

        // Strategy: Focus YouTube window, open dev console (F12 -> Console), type seek JS
        // Problem: this is invasive. Better: use URL navigation with t= param.
        // We'll use PowerShell to:
        // 1. Focus Chrome/YT window
        // 2. Press Ctrl+L (address bar)
        // 3. Append ?t=Xs to current URL

        const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Seek {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc e, IntPtr l);
    [DllImport("user32.dll")] public static extern int  GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
}
"@
$found = $false
$hwnd  = [IntPtr]::Zero
[Win32Seek]::EnumWindows({
    param($h, $l)
    if (-not [Win32Seek]::IsWindowVisible($h)) { return $true }
    $sb = New-Object System.Text.StringBuilder 512
    [Win32Seek]::GetWindowText($h, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ($t -match "YouTube") {
        $script:hwnd  = $h
        $script:found = $true
        return $false
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

if ($found) {
    [Win32Seek]::ShowWindow($hwnd, 9) | Out-Null
    [Win32Seek]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 400
    $wsh = New-Object -ComObject WScript.Shell
    # Open address bar, append &t=${totalSeconds} to URL
    $wsh.SendKeys("^l")             # Ctrl+L = focus address bar
    Start-Sleep -Milliseconds 300
    # Get current URL from clipboard: Ctrl+A, Ctrl+C to copy address bar content
    $wsh.SendKeys("^a")
    $wsh.SendKeys("^c")
    Start-Sleep -Milliseconds 200
    $url = Get-Clipboard -Raw
    # Remove existing t= parameter and add new one
    $url = $url -replace "[?&]t=\\d+", ""
    if ($url -match "\\?") {
        $url = $url + "&t=${totalSeconds}"
    } else {
        $url = $url + "?t=${totalSeconds}"
    }
    $wsh.SendKeys($url)
    $wsh.SendKeys("{ENTER}")
    Write-Output "OK"
} else {
    Write-Output "NOT_FOUND"
}
`;
        const out = await runPS(script);
        if (out === "OK") {
          resultStr = `Seeked to ${minutes > 0 ? minutes + "m " : ""}${seconds}s in the video.`;
        } else {
          resultStr = "No YouTube window found. Open YouTube first.";
        }
      } else {
        resultStr = `Seek by time: ${minutes}m ${seconds}s — Open YouTube manually and use the seek bar. (Auto-seek only supported on Windows)`;
      }
    }

  } catch (err: any) {
    resultStr = `YouTube control error: ${err.message}`;
    io.emit("system_status", `[YOUTUBE ERROR] ${err.message?.slice(0, 80)}`);
  }

  return { id: fc.id, name: fc.name, response: { result: resultStr } };
};
