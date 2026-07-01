import "../config/dot-env.js";
import express from "express";
import http from "http";
import os from "os";
import fs from "fs";
import path from "path";
import net from "net";
import { Server } from "socket.io";
import ViteExpress from "vite-express";
import { startOGVoice, stopOGVoice, sendChatMessage as handleChatMessage, handleVisionFrame } from "./agent/og-voice.js";
import { syncChatSession } from "./utils/memory.js";
import { runSelfHealing } from "./utils/self-healing.js";
import { startClickDaemon } from "./utils/click-daemon.js";
import { fileURLToPath } from "url";
import { exec, execFile, execSync, spawn } from "child_process";
import { promisify } from "util";
import { handleAppAction } from "./tools/app-agent.js";
import { handleYouTubeAction } from "./tools/youtube-agent.js";
import open from "open";

const execAsync     = promisify(exec);
const execFileAsync = promisify(execFile);

async function runPowerShellScript(script: string): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `og_main_ps_${Date.now()}.ps1`);
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
    const escapedCall = target.replace(/"/g, '\\"');

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

if (process.env.NODE_ENV === "production") {
  const originalStdout = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: any, encoding?: any, callback?: any): boolean => {
    if (typeof chunk === "string" && chunk.includes("[vite-express]")) return true;
    return originalStdout(chunk, encoding, callback);
  }) as any;

  const originalStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: any, encoding?: any, callback?: any): boolean => {
    if (typeof chunk === "string" && (chunk.includes("DEP0205") || chunk.includes("DeprecationWarning"))) {
      return true;
    }
    return originalStderr(chunk, encoding, callback);
  }) as any;

  process.on("warning", (warning) => {
    if (warning.name === "DeprecationWarning") return;
  });
}

const app = express();
const server = http.createServer(app);

// ── System stats helper ───────────────────────────────────────────────────────
let prevCpuTimes = os.cpus().map((c) => c.times);

function getCpuUsage(): number {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach((cpu, i) => {
    const prev = prevCpuTimes[i] ?? cpu.times;
    const dIdle = cpu.times.idle - prev.idle;
    const dTotal = Object.values(cpu.times).reduce((a, b) => a + b, 0)
                 - Object.values(prev).reduce((a, b) => a + b, 0);
    totalIdle += dIdle;
    totalTick += dTotal;
  });
  prevCpuTimes = cpus.map((c) => c.times);
  return totalTick === 0 ? 0 : Math.round((1 - totalIdle / totalTick) * 100);
}

app.get("/api/system-stats", (_req, res) => {
  const totalMem  = os.totalmem();
  const freeMem   = os.freemem();
  const usedMem   = totalMem - freeMem;
  const ramPct    = Math.round((usedMem / totalMem) * 100);

  const uptime    = os.uptime(); // seconds
  const cpuPct    = getCpuUsage();
  const platform  = os.platform();
  const cpuModel  = os.cpus()[0]?.model?.split(" ").slice(0, 3).join(" ") ?? "Unknown";

  res.json({
    ram:      { used: Math.round(usedMem / 1024 / 1024), total: Math.round(totalMem / 1024 / 1024), pct: ramPct },
    cpu:      { pct: cpuPct, model: cpuModel, cores: os.cpus().length },
    uptime:   { seconds: uptime },
    platform: platform,
    network:  Object.entries(os.networkInterfaces())
                .flatMap(([, addrs]) => addrs ?? [])
                .find((a) => a.family === "IPv4" && !a.internal)?.address ?? "N/A",
  });
});

if (process.env.NODE_ENV === "production") {
  ViteExpress.config({ mode: "production" });
}

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:6753",
      "https://og-assistant.onrender.com",
      process.env.FRONTEND_URL || "",
    ].filter(Boolean),
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Per-socket clipboard state for file manager
const socketClipboard = new Map<string, { paths: string[]; op: "copy" | "cut" }>();

io.on("connection", (socket) => {
  console.log(`[SOCKET] Client connected: ${socket.id}`);
  
  socket.on("disconnect", (reason) => {
    console.log(`[SOCKET] Client disconnected: ${socket.id}, reason: ${reason}`);
  });

  socket.on("NATALIE_Connected", () => { startOGVoice(io); });
  socket.on("NATALIE_Disconnected", () => { stopOGVoice(io); });
  socket.on("OG_Connected",    () => { startOGVoice(io, true); });
  socket.on("OG_Disconnected", () => { stopOGVoice(io); });

  socket.on("chat_message", (data: { text?: string; image?: string; mimeType?: string }) => {
    handleChatMessage(io, data);
  });

  socket.on("vision_frame", (data: { frame: string }) => {
    try {
      const base64Data = data.frame.split(",")[1];
      handleVisionFrame(base64Data);
    } catch {}
  });

  socket.on("sync_session", (data: {
    id: string; title: string;
    messages: Array<{ role: string; text: string; timestamp?: string; isFinal?: boolean }>;
    createdAt: number; updatedAt: number;
  }) => {
    try { syncChatSession(data); } catch {}
  });

  // ── File System actions (SystemControlPanel) ──────────────────────────────
  socket.on("fs_action", async (payload: { action: string; payload: any }) => {
    const { action, payload: p } = payload;
    try {
      if (action === "list") {
        const dirPath = p.path || os.homedir();
        if (!fs.existsSync(dirPath)) { socket.emit("fs_result", { action: "list", error: `Not found: ${dirPath}` }); return; }
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const items = entries.map(e => {
          let size: number | undefined; let modified: string | undefined;
          try { const st = fs.statSync(path.join(dirPath, e.name)); size = e.isFile() ? st.size : undefined; modified = st.mtime.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }); } catch {}
          return { name: e.name, type: e.isDirectory() ? "folder" : "file" as "file"|"folder", size, modified, path: path.join(dirPath, e.name) };
        });
        items.sort((a, b) => { if (a.type !== b.type) return a.type === "folder" ? -1 : 1; return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }); });
        socket.emit("fs_result", { action: "list", items });

      } else if (action === "create_folder") {
        fs.mkdirSync(path.join(p.path, p.name), { recursive: true });
        socket.emit("fs_result", { action: "create_folder" });

      } else if (action === "delete") {
        for (const fp of (p.paths as string[])) { if (!fs.existsSync(fp)) continue; const st = fs.statSync(fp); if (st.isDirectory()) fs.rmSync(fp, { recursive: true, force: true }); else fs.unlinkSync(fp); }
        socket.emit("fs_result", { action: "delete" });

      } else if (action === "copy") {
        socketClipboard.set(socket.id, { paths: p.paths, op: "copy" });
        socket.emit("fs_result", { action: "copy" });

      } else if (action === "cut") {
        socketClipboard.set(socket.id, { paths: p.paths, op: "cut" });
        socket.emit("fs_result", { action: "cut" });

      } else if (action === "paste") {
        const clip = socketClipboard.get(socket.id);
        if (!clip) { socket.emit("fs_result", { action: "paste", error: "Clipboard empty" }); return; }
        for (const src of clip.paths) {
          if (!fs.existsSync(src)) continue;
          const dest = path.join(p.destination, path.basename(src));
          const st = fs.statSync(src);
          if (clip.op === "copy") { if (st.isDirectory()) fs.cpSync(src, dest, { recursive: true }); else fs.copyFileSync(src, dest); }
          else                    { fs.renameSync(src, dest); }
        }
        if (clip.op === "cut") socketClipboard.delete(socket.id);
        socket.emit("fs_result", { action: "paste" });

      } else if (action === "rename") {
        fs.renameSync(p.path, path.join(path.dirname(p.path), p.newName));
        socket.emit("fs_result", { action: "rename" });

      } else if (action === "open") {
        const plt = os.platform();
        if (plt === "win32") {
          try {
            await launchInteractively(`explorer.exe "${p.path}"`);
          } catch {
            try {
              await open(p.path);
            } catch {
              await execAsync(`start "" "${p.path}"`);
            }
          }
        }
        else if (plt === "darwin") await execAsync(`open "${p.path}"`);
        else await execAsync(`xdg-open "${p.path}"`);
        socket.emit("fs_result", { action: "open" });
      }
    } catch (err: any) { socket.emit("fs_result", { action, error: err.message }); }
  });

  // ── System Controls (SystemControlPanel) ─────────────────────────────────
  socket.on("sys_control", async (data: { type: string; value: any }) => {
    const plt = os.platform();
    try {
      if (data.type === "volume") {
        const lv = Math.max(0, Math.min(100, Math.round(data.value)));
        if (plt === "win32") {
          const tmp = path.join(os.tmpdir(), `og_vol_${Date.now()}.ps1`);
          const script = `Add-Type -TypeDefinition @"\nusing System;using System.Runtime.InteropServices;\n[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IAudioEndpointVolume{int _VtblGap1_4();int SetMasterVolumeLevelScalar(float f,Guid g);int _VtblGap2_1();int GetMasterVolumeLevelScalar(out float p);int _VtblGap3_4();int SetMute([MarshalAs(UnmanagedType.Bool)]bool b,Guid g);int GetMute(out bool p);}\n[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMMDevice{int Activate(ref Guid id,int c,IntPtr p,[MarshalAs(UnmanagedType.IUnknown)]out object pp);}\n[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMMDeviceEnumerator{int _VtblGap1_1();int GetDefaultAudioEndpoint(int d,int r,out IMMDevice p);}\n[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]class MMDeviceEnumeratorClass{}\npublic static class AudioHelper{public static void SetVolume(float l){var e=(IMMDeviceEnumerator)(new MMDeviceEnumeratorClass());IMMDevice d;e.GetDefaultAudioEndpoint(0,1,out d);var iid=typeof(IAudioEndpointVolume).GUID;object o;d.Activate(ref iid,23,IntPtr.Zero,out o);((IAudioEndpointVolume)o).SetMasterVolumeLevelScalar(l,Guid.Empty);}}\n"@\n[AudioHelper]::SetVolume(${(lv/100).toFixed(4)})`;
          fs.writeFileSync(tmp, script, "utf-8");
          await execFileAsync("powershell.exe", ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",tmp]).catch(()=>{});
          try { fs.unlinkSync(tmp); } catch {}
        } else if (plt === "darwin") { await execAsync(`osascript -e "set volume output volume ${lv}"`).catch(()=>{}); }
        else { await execAsync(`amixer -D pulse sset Master ${lv}%`).catch(()=>{}); }
        socket.emit("sys_control_result", { type:"volume", success:true, value:lv });

      } else if (data.type === "brightness") {
        const lv = Math.max(0, Math.min(100, Math.round(data.value)));
        if (plt === "win32") {
          const tmp = path.join(os.tmpdir(), `og_br_${Date.now()}.ps1`);
          fs.writeFileSync(tmp, `$m=Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods -EA SilentlyContinue;if($m){$m[0].WmiSetBrightness(1,${lv})}`, "utf-8");
          await execFileAsync("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",tmp]).catch(()=>{});
          try { fs.unlinkSync(tmp); } catch {}
        } else if (plt === "darwin") { await execAsync(`brightness ${(lv/100).toFixed(2)}`).catch(()=>{}); }
        else { await execAsync(`brightnessctl set ${lv}%`).catch(()=>{}); }
        socket.emit("sys_control_result", { type:"brightness", success:true, value:lv });

      } else if (data.type === "action") {
        const act = data.value as string;
        if (act === "screenshot") {
          const ts   = new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
          const dest = path.join(os.homedir(),"Desktop",`screenshot-${ts}.png`);
          if (plt === "win32") {
            const d = dest.replace(/\\/g,"\\\\");
            const tmp = path.join(os.tmpdir(),`og_ss_${Date.now()}.ps1`);
            fs.writeFileSync(tmp,`Add-Type -AN System.Windows.Forms,System.Drawing;$b=New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height);$g=[System.Drawing.Graphics]::FromImage($b);$g.CopyFromScreen(0,0,0,0,$b.Size);$b.Save("${d}");$g.Dispose();$b.Dispose()`,"utf-8");
            try {
              await launchInteractively(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmp}"`);
              await new Promise(r => setTimeout(r, 1000));
            } catch {
              await execFileAsync("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",tmp]).catch(()=>{});
            }
            try { fs.unlinkSync(tmp); } catch {}
          } else if (plt === "darwin") { await execAsync(`screencapture -x "${dest}"`); }
          else { await execAsync(`scrot "${dest}"`); }
          socket.emit("sys_control_result", { type:"action", action:act, success:true, value:`Saved to Desktop` });
        } else if (act === "lock_screen") {
          if (plt === "win32") await execAsync("rundll32.exe user32.dll,LockWorkStation");
          else if (plt === "darwin") await execAsync("pmset displaysleepnow");
          else await execAsync("xdg-screensaver lock");
          socket.emit("sys_control_result", { type:"action", action:act, success:true });
        } else if (act === "sleep") {
          if (plt === "win32") { const tmp=path.join(os.tmpdir(),`og_slp_${Date.now()}.ps1`); fs.writeFileSync(tmp,`Add-Type -AN System.Windows.Forms;[System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false)`,"utf-8"); await execFileAsync("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",tmp]).catch(()=>{}); try{fs.unlinkSync(tmp);}catch{} }
          else if (plt === "darwin") await execAsync("pmset sleepnow");
          else await execAsync("systemctl suspend");
          socket.emit("sys_control_result", { type:"action", action:act, success:true });
        } else if (act === "restart") {
          if (plt === "win32") await execAsync("shutdown /r /t 5");
          else if (plt === "darwin") await execAsync("osascript -e 'tell app \"System Events\" to restart'");
          else await execAsync("shutdown -r now");
          socket.emit("sys_control_result", { type:"action", action:act, success:true });
        } else if (act === "task_manager") {
          if (plt === "win32") {
            try {
              await launchInteractively("taskmgr.exe");
            } catch {
              await execAsync("start taskmgr").catch(() => execAsync("taskmgr"));
            }
          }
          else if (plt === "darwin") await execAsync("open -a 'Activity Monitor'");
          else await execAsync("gnome-system-monitor").catch(()=>{});
          socket.emit("sys_control_result", { type:"action", action:act, success:true });
        } else if (act === "show_desktop") {
          if (plt === "win32") {
            const tmp = path.join(os.tmpdir(),`og_desk_${Date.now()}.ps1`);
            fs.writeFileSync(tmp,`(New-Object -ComObject Shell.Application).MinimizeAll()`,"utf-8");
            try {
              await launchInteractively(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmp}"`);
              await new Promise(r => setTimeout(r, 500));
            } catch {
              await execFileAsync("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",tmp]).catch(()=>{});
            }
            try { fs.unlinkSync(tmp); } catch {}
          }
          socket.emit("sys_control_result", { type:"action", action:act, success:true });
        } else if (act === "clipboard_read") {
          let text = "";
          if (plt === "win32") {
            const tmp = path.join(os.tmpdir(),`og_cb_${Date.now()}.ps1`);
            const outFile = path.join(os.tmpdir(),`og_cb_out_${Date.now()}.txt`);
            fs.writeFileSync(tmp,`$c=Get-Clipboard -Raw; if($c){$c | Out-File -FilePath "${outFile.replace(/\\/g,"\\\\")}" -Encoding utf8}else{"__EMPTY__" | Out-File -FilePath "${outFile.replace(/\\/g,"\\\\")}" -Encoding utf8}`,"utf-8");
            try {
              await launchInteractively(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmp}"`);
              await new Promise(r => setTimeout(r, 800));
              if (fs.existsSync(outFile)) {
                text = fs.readFileSync(outFile, "utf-8").trim();
                try { fs.unlinkSync(outFile); } catch {}
              }
            } catch {
              const {stdout}=await execFileAsync("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",tmp]).catch(()=>({stdout:""}));
              text=(stdout||"").trim();
            }
            try { fs.unlinkSync(tmp); } catch {}
          }
          else if (plt === "darwin") { const {stdout}=await execAsync("pbpaste"); text=stdout.trim(); }
          else { const {stdout}=await execAsync("xclip -selection clipboard -o"); text=stdout.trim(); }
          socket.emit("sys_control_result", { type:"action", action:act, success:true, value:(text==="__EMPTY__"||!text)?"(empty)":text.slice(0,300) });
        } else if (act === "night_mode") {
          socket.emit("sys_control_result", { type:"action", action:act, success:true });
        } else {
          socket.emit("sys_control_result", { type:"action", action:act, success:false, error:"Unknown action" });
        }
      } else if (data.type === "list_processes") {
        const ps = `Get-Process | Where-Object { $_.CPU -gt 0 -or $_.WorkingSet64 -gt 15MB } | Sort-Object CPU -Descending | Select-Object -First 40 | ForEach-Object { "$($_.Id)|$($_.Name)|$([math]::Round($_.CPU,1))|$([math]::Round($_.WorkingSet64/1MB,1))" }`;
        const out = await runPowerShellScript(ps);
        const list = out.split(/\r?\n/).map(line => {
          const parts = line.trim().split("|");
          if (parts.length < 4) return null;
          return { pid: parts[0], name: parts[1], cpu: parts[2], mem: parts[3] };
        }).filter(Boolean);
        socket.emit("sys_control_result", { type: "processes", list });

      } else if (data.type === "list_windows") {
        const ps = `Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "$($_.MainWindowHandle)|$($_.MainWindowTitle)|$($_.Name)" }`;
        const out = await runPowerShellScript(ps);
        const list = out.split(/\r?\n/).map(line => {
          const parts = line.trim().split("|");
          if (parts.length < 3) return null;
          return { hwnd: parts[0], title: parts[1], process: parts[2] };
        }).filter(Boolean);
        socket.emit("sys_control_result", { type: "windows", list });

      } else if (data.type === "open_app") {
        const appRes = await handleAppAction({ name: "open_app", args: { app_name: data.value.name } }, io);
        socket.emit("sys_control_result", { type: "app_open", success: !appRes.response.result.startsWith("Error"), app: data.value.name, error: appRes.response.result });

      } else if (data.type === "close_app") {
        const appRes = await handleAppAction({ name: "close_app", args: { app_name: data.value.name } }, io);
        socket.emit("sys_control_result", { type: "app_close", success: !appRes.response.result.startsWith("Error"), app: data.value.name, error: appRes.response.result });

      } else if (data.type === "win_focus") {
        const hwnd = data.value.hwnd;
        const script = `
        $hwnd = [IntPtr]${hwnd}
        $signature = '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);'
        $type = Add-Type -MemberDefinition $signature -Name "Win32SetForegroundWindow" -Namespace "Win32" -PassThru
        $type::SetForegroundWindow($hwnd)
        `;
        await runPowerShellScript(script);
        socket.emit("sys_control_result", { type: "win_focus", success: true });

      } else if (data.type === "win_close") {
        const hwnd = data.value.hwnd;
        const script = `
        $hwnd = [IntPtr]${hwnd}
        $signature = '[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);'
        $type = Add-Type -MemberDefinition $signature -Name "Win32SendMessage" -Namespace "Win32" -PassThru
        $type::SendMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
        `;
        await runPowerShellScript(script);
        socket.emit("sys_control_result", { type: "win_close", success: true });

      } else if (data.type === "yt_search") {
        const ytRes = await handleYouTubeAction({ name: "youtube_search_play", args: { query: data.value.query, auto_play: data.value.autoPlay } }, io);
        socket.emit("sys_control_result", { type: "yt_search", success: true, message: ytRes.response.result });

      } else if (data.type === "yt_control") {
        const ytRes = await handleYouTubeAction({ name: "youtube_control", args: { action: data.value.action } }, io);
        socket.emit("sys_control_result", { type: "yt_control", success: true, action: data.value.action, message: ytRes.response.result });
      } else if (data.type === "self_heal") {
        const logCallback = (msg: string) => {
          socket.emit("self_heal_log", { message: msg });
        };
        const summary = await runSelfHealing(logCallback);
        socket.emit("sys_control_result", { type: "self_heal", success: summary.success, value: summary.report });
      }
    } catch (err: any) { socket.emit("sys_control_result", { type:data.type, success:false, error:err.message }); }
  });

  socket.on("disconnect", () => { socketClipboard.delete(socket.id); });
});

const isPortAvailable = (port: number): Promise<boolean> => {
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

const healPortConflict = async (port: number) => {
  console.log(`[SELF-HEALING] Checking port ${port} status...`);
  try {
    const platform = os.platform();
    if (platform === "win32") {
      try {
        const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf-8" });
        const lines = output.split("\n").map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length < 3) continue;
          const localAddr = parts[1];
          const pid = parts[parts.length - 1];
          if (localAddr.endsWith(`:${port}`) && pid && pid !== "0" && parseInt(pid) !== process.pid) {
            console.log(`[SELF-HEALING] Terminating conflicting process with PID: ${pid}`);
            try {
              execSync(`taskkill /F /PID ${pid}`);
            } catch {}
          }
        }
      } catch {
        // no process found
      }
    } else {
      try {
        const output = execSync(`lsof -t -i:${port}`, { encoding: "utf-8" }).trim();
        const pids = output.split("\n").map(l => l.trim()).filter(Boolean);
        for (const pid of pids) {
          if (pid && parseInt(pid) !== process.pid) {
            console.log(`[SELF-HEALING] Terminating conflicting process with PID: ${pid}`);
            execSync(`kill -9 ${pid}`);
          }
        }
      } catch {
        // no process found
      }
    }
    
    // Poll to wait for the port to be fully released by the OS/zombies
    let available = false;
    for (let i = 0; i < 25; i++) {
      available = await isPortAvailable(port);
      if (available) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    if (!available) {
      console.log(`[SELF-HEALING WARNING] Port ${port} is still reported as busy.`);
    } else {
      console.log(`[SELF-HEALING] Port ${port} is free and ready.`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err: any) {
    console.log(`[SELF-HEALING ERROR] Failed to resolve conflict: ${err.message}`);
  }
};

const startServer = async () => {
  const port = parseInt(process.env.PORT || "6753", 10);
  await healPortConflict(port);

  const printBanner = () => {
    console.clear();
    const banner = `
\x1b[36m
  ██████╗  ██████╗ 
 ██╔═══██╗██╔════╝ 
 ██║   ██║██║  ███╗
 ██║   ██║██║   ██║
 ╚██████╔╝╚██████╔╝
  ╚═════╝  ╚═════╝ 
\x1b[0m\x1b[1m\x1b[97m  A S S I S T A N T\x1b[0m
\x1b[2m  ─────────────────────────────────────\x1b[0m
\x1b[36m [ NEURAL CORE ONLINE ]\x1b[0m
\x1b[35m [ UI PORT ] \x1b[0m http://localhost:${port}
\x1b[35m [ AGENT ]   \x1b[0m Awaiting Connection...
\x1b[90m [ EXIT ]    \x1b[0m Press \x1b[31mCtrl + C\x1b[0m to stop
=======================================
\x1b[36m CREATED BY \x1b[0m Varun (\x1b[36m@og_assistant\x1b[0m)
\x1b[36m GITHUB     \x1b[0m https://github.com/Varun
=======================================
`;
    process.stdout.write(banner + "\n");
  };

  if (process.env.NODE_ENV === "production") {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // When running dist/server.js, the Vite-built UI is in the same dist/ folder
    const staticDir = path.resolve(__dirname);
    app.use(express.static(staticDir));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    });
    server.listen(port, "0.0.0.0", () => {
      printBanner();
      startClickDaemon();
    });
  } else {
    ViteExpress.bind(app, server, () => {
      server.listen(port, () => {
        printBanner();
        startClickDaemon();
        console.log(`Server running on http://localhost:${port}`);
      });
    });
  }
};

startServer(); // Triggered restart after manual port clearance 2
