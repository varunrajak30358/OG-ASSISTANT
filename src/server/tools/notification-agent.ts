/**
 * Notification Agent — Email alerts, Telegram bot, WhatsApp notifications,
 * push notifications, error alerts, Windows toast notifications
 */
import { Type, type FunctionDeclaration } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import { exec } from "child_process";
import { promisify } from "util";
import { Server } from "socket.io";
import { logActivity } from "../utils/activity-log.js";

const execAsync = promisify(exec);

// ── Helper: write a temp .ps1 file and run it ─────────────────────────────────
async function runPowerShellScript(script: string): Promise<string> {
  const { execFile } = await import("child_process");
  const { promisify: prom } = await import("util");
  const execFileAsync = prom(execFile);
  const tmpFile = path.join(os.tmpdir(), `og_notif_${Date.now()}.ps1`);
  try {
    fs.writeFileSync(tmpFile, script, "utf-8");
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tmpFile,
    ]);
    return (stdout || "").trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ── Telegram API helper ───────────────────────────────────────────────────────
function sendTelegramMessage(botToken: string, chatId: string, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" });
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${botToken}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.ok ? "Message sent successfully" : `Telegram error: ${parsed.description}`);
        } catch { resolve(data); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export const notificationToolDeclarations: FunctionDeclaration[] = [
  {
    name: "send_notification",
    description:
      "Sends a notification via various channels: Windows toast, Telegram, or email. Use when user says 'notification bhejo', 'alert do', 'Telegram pe bhejo', 'push notification', 'error alert'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        channel: {
          type: Type.STRING,
          description: "Notification channel.",
          enum: ["toast", "telegram", "email", "all"],
        },
        title: {
          type: Type.STRING,
          description: "Notification title.",
        },
        message: {
          type: Type.STRING,
          description: "Notification message body.",
        },
        urgency: {
          type: Type.STRING,
          description: "Urgency level: 'low', 'normal', 'high', 'critical'.",
          enum: ["low", "normal", "high", "critical"],
        },
        telegram_token: {
          type: Type.STRING,
          description: "Telegram bot token (from @BotFather). Uses TELEGRAM_BOT_TOKEN env var if not provided.",
        },
        telegram_chat_id: {
          type: Type.STRING,
          description: "Telegram chat ID. Uses TELEGRAM_CHAT_ID env var if not provided.",
        },
      },
      required: ["channel", "title", "message"],
    },
  },
  {
    name: "setup_telegram_bot",
    description:
      "Saves Telegram bot credentials for future notifications. Use when user says 'Telegram bot setup karo', 'bot token save karo'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        bot_token: {
          type: Type.STRING,
          description: "Telegram bot token from @BotFather.",
        },
        chat_id: {
          type: Type.STRING,
          description: "Your Telegram chat ID (get from @userinfobot).",
        },
      },
      required: ["bot_token", "chat_id"],
    },
  },
  {
    name: "send_error_alert",
    description:
      "Sends an error/critical alert notification. Use when a task fails or an error occurs that needs immediate attention.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        error_type: {
          type: Type.STRING,
          description: "Type of error: 'task_failed', 'system_error', 'security_alert', 'custom'.",
          enum: ["task_failed", "system_error", "security_alert", "custom"],
        },
        error_message: {
          type: Type.STRING,
          description: "The error message or description.",
        },
        context: {
          type: Type.STRING,
          description: "Additional context about what was happening when the error occurred.",
        },
      },
      required: ["error_type", "error_message"],
    },
  },
];

export const handleNotificationAction = async (fc: any, io: Server): Promise<any> => {
  let resultStr = "";
  const args = fc.args as any;
  const platform = os.platform();

  try {
    if (fc.name === "send_notification") {
      const channel = args.channel;
      const title = args.title || "N.A.T.A.L.I.E.";
      const message = args.message;
      const urgency = args.urgency || "normal";
      const results: string[] = [];

      // Windows Toast
      if (channel === "toast" || channel === "all") {
        if (platform === "win32") {
          const safeTitle = title.replace(/"/g, "'");
          const safeMsg = message.replace(/"/g, "'").replace(/\n/g, " ");
          const iconType = urgency === "critical" ? "Error" : urgency === "high" ? "Warning" : "Info";
          const script = `
Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::${iconType}
$notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::${iconType}
$notify.BalloonTipTitle = "${safeTitle}"
$notify.BalloonTipText = "${safeMsg}"
$notify.Visible = $true
$notify.ShowBalloonTip(8000)
Start-Sleep -Seconds 9
$notify.Dispose()
`;
          runPowerShellScript(script).catch(() => {});
          results.push("Toast notification sent");
          io.emit("system_status", `[NOTIFY] Toast: ${title}`);
        }
      }

      // Telegram
      if (channel === "telegram" || channel === "all") {
        const botToken = args.telegram_token || process.env.TELEGRAM_BOT_TOKEN;
        const chatId = args.telegram_chat_id || process.env.TELEGRAM_CHAT_ID;

        if (botToken && chatId) {
          const urgencyEmoji = urgency === "critical" ? "🚨" : urgency === "high" ? "⚠️" : urgency === "low" ? "ℹ️" : "🔔";
          const telegramMsg = `${urgencyEmoji} *${title}*\n\n${message}`;
          try {
            const telegramResult = await sendTelegramMessage(botToken, chatId, telegramMsg);
            results.push(`Telegram: ${telegramResult}`);
            io.emit("system_status", `[NOTIFY] Telegram: ${title}`);
          } catch (err: any) {
            results.push(`Telegram failed: ${err.message}`);
          }
        } else {
          results.push("Telegram: No bot token/chat ID configured. Use 'setup_telegram_bot' first or set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars.");
        }
      }

      // Email (via Gmail compose)
      if (channel === "email" || channel === "all") {
        const emailAddr = process.env.NOTIFICATION_EMAIL;
        if (emailAddr) {
          const subject = encodeURIComponent(`[N.A.T.A.L.I.E.] ${title}`);
          const body = encodeURIComponent(message);
          const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${emailAddr}&su=${subject}&body=${body}&tf=1`;
          const { exec: execRaw } = await import("child_process");
          if (platform === "win32") execRaw(`start "" "${gmailUrl}"`);
          results.push(`Email: Gmail compose opened for ${emailAddr}`);
          io.emit("system_status", `[NOTIFY] Email: ${title}`);
        } else {
          results.push("Email: Set NOTIFICATION_EMAIL env var to enable email notifications.");
        }
      }

      resultStr = results.length > 0 ? results.join("\n") : "No notification channels configured.";
      logActivity("SEND_NOTIFICATION", { channel, title, urgency });

    } else if (fc.name === "setup_telegram_bot") {
      // Save to .env file
      const envPath = path.resolve(process.cwd(), ".env");
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";

      if (envContent.match(/^TELEGRAM_BOT_TOKEN=.*/m)) {
        envContent = envContent.replace(/^TELEGRAM_BOT_TOKEN=.*/m, `TELEGRAM_BOT_TOKEN=${args.bot_token}`);
      } else {
        envContent += `\nTELEGRAM_BOT_TOKEN=${args.bot_token}`;
      }

      if (envContent.match(/^TELEGRAM_CHAT_ID=.*/m)) {
        envContent = envContent.replace(/^TELEGRAM_CHAT_ID=.*/m, `TELEGRAM_CHAT_ID=${args.chat_id}`);
      } else {
        envContent += `\nTELEGRAM_CHAT_ID=${args.chat_id}`;
      }

      fs.writeFileSync(envPath, envContent, "utf-8");
      process.env.TELEGRAM_BOT_TOKEN = args.bot_token;
      process.env.TELEGRAM_CHAT_ID = args.chat_id;

      // Test the connection
      try {
        const testResult = await sendTelegramMessage(args.bot_token, args.chat_id, "🤖 N.A.T.A.L.I.E. Telegram bot connected successfully!");
        resultStr = `Telegram bot configured and tested!\nBot token: ${args.bot_token.slice(0, 10)}...\nChat ID: ${args.chat_id}\nTest: ${testResult}`;
      } catch (err: any) {
        resultStr = `Telegram credentials saved but test failed: ${err.message}\nCheck your bot token and chat ID.`;
      }
      io.emit("system_status", `[NOTIFY] Telegram bot configured`);
      logActivity("SETUP_TELEGRAM", { chatId: args.chat_id });

    } else if (fc.name === "send_error_alert") {
      const errorType = args.error_type;
      const errorMsg = args.error_message;
      const context = args.context || "";

      const title = errorType === "security_alert" ? "🚨 Security Alert" :
                    errorType === "task_failed" ? "❌ Task Failed" :
                    errorType === "system_error" ? "⚠️ System Error" : "🔴 Error Alert";

      const fullMessage = `${errorMsg}${context ? `\n\nContext: ${context}` : ""}`;

      // Always send toast for errors
      if (platform === "win32") {
        const safeTitle = title.replace(/[🚨❌⚠️🔴]/g, "").trim();
        const safeMsg = fullMessage.replace(/"/g, "'").replace(/\n/g, " ").slice(0, 200);
        const script = `
Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Error
$notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Error
$notify.BalloonTipTitle = "${safeTitle}"
$notify.BalloonTipText = "${safeMsg}"
$notify.Visible = $true
$notify.ShowBalloonTip(10000)
Start-Sleep -Seconds 11
$notify.Dispose()
`;
        runPowerShellScript(script).catch(() => {});
      }

      // Also try Telegram if configured
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      let telegramResult = "";
      if (botToken && chatId) {
        try {
          const emoji = errorType === "security_alert" ? "🚨" : errorType === "task_failed" ? "❌" : "⚠️";
          await sendTelegramMessage(botToken, chatId, `${emoji} *${title}*\n\n${fullMessage}`);
          telegramResult = " + Telegram alert sent";
        } catch {}
      }

      resultStr = `Error alert sent: ${title}${telegramResult}\nMessage: ${errorMsg}`;
      io.emit("system_status", `[NOTIFY] Error alert: ${errorType}`);
      io.emit("transcript_chunk", { role: "AGENT", text: `🚨 Alert: ${errorMsg.slice(0, 100)}` });
      io.emit("turn_complete");
      logActivity("ERROR_ALERT", { errorType, errorMsg: errorMsg.slice(0, 100) });
    }
  } catch (err: any) {
    resultStr = `Error: ${err.message}`;
    io.emit("system_status", `[NOTIFY ERROR] ${err.message?.slice(0, 80)}`);
  }

  return { id: fc.id, name: fc.name, response: { result: resultStr } };
};
