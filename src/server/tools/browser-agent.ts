import { Type, type FunctionDeclaration } from "@google/genai";
import { exec } from "child_process";
import { promisify } from "util";
import { Server } from "socket.io";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import open from "open";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const CONTACTS_PATH = path.resolve(__dirname, "../../../data/contacts.json");

const execAsync = promisify(exec);

function cleanAndNormalizeUrl(url: string): string {
  if (!url) return "";
  let cleaned = url.trim();
  // Strip raw double quotes in URL to prevent shell injection or syntax issues
  cleaned = cleaned.replace(/"/g, "%22");
  // Prepend protocol if missing
  if (!/^[a-zA-Z0-9+-.]+:\/\//.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  return cleaned;
}

// Opens URL — launches directly or uses fallbacks
async function openUrl(url: string, io?: Server) {
  const normalizedUrl = cleanAndNormalizeUrl(url);
  if (!normalizedUrl) return;

  if (io) {
    io.emit("open_url", { url: normalizedUrl });
  }

  const platform = os.platform();
  if (platform === "win32") {
    try {
      await open(normalizedUrl);
    } catch {
      // Fallback
      const isWhatsApp = normalizedUrl.includes("whatsapp.com");
      const isGmail    = normalizedUrl.includes("mail.google.com");

      if (isWhatsApp || isGmail) {
        const psScript = `
$chrome = Get-Process -Name "chrome" -ErrorAction SilentlyContinue
if ($chrome) {
  Start-Process "chrome.exe" -ArgumentList "--new-tab","${normalizedUrl}"
} else {
  Start-Process "${normalizedUrl}"
}
`.trim();
        try {
          await execAsync(`powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, " ")}"`);
        } catch {
          await execAsync(`start chrome "${normalizedUrl}"`).catch(() => execAsync(`start "" "${normalizedUrl}"`));
        }
      } else {
        await execAsync(`start "" "${normalizedUrl}"`);
      }
    }
  } else if (platform === "darwin") {
    await execAsync(`open "${normalizedUrl}"`);
  } else {
    await execAsync(`xdg-open "${normalizedUrl}"`);
  }
}

// Find contact by name (fuzzy match)
function findContact(name: string): { name: string; phone?: string; email?: string } | null {
  try {
    if (!fs.existsSync(CONTACTS_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(CONTACTS_PATH, "utf-8"));
    const contacts: { name: string; phone?: string; email?: string }[] = data.contacts || [];
    const query = name.toLowerCase().trim();
    return contacts.find((c) => c.name.toLowerCase().includes(query) || query.includes(c.name.toLowerCase())) || null;
  } catch { return null; }
}

export const browserToolDeclarations: FunctionDeclaration[] = [
  {
    name: "open_website",
    description: "Opens a specific website URL in the user's default web browser.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: "The full URL to open." },
      },
      required: ["url"],
    },
  },
  {
    name: "search_youtube",
    description: "Searches YouTube for a specific query or song and plays it in the browser.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "The search query, e.g., 'Blinding Lights The Weeknd'" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_google",
    description: "Searches Google for a specific query to find information.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "The search query to look up on Google." },
      },
      required: ["query"],
    },
  },
  {
    name: "send_whatsapp",
    description: "Opens WhatsApp Web and composes a message to a contact. Use this when user says 'send WhatsApp to [name/number]' or 'WhatsApp message bhejo'. If phone number is given use it directly, otherwise open WhatsApp Web for the user to select contact.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        phone: {
          type: Type.STRING,
          description: "Phone number with country code, e.g., '+919876543210'. Leave empty if only contact name is given.",
        },
        message: {
          type: Type.STRING,
          description: "The message text to send.",
        },
        contact_name: {
          type: Type.STRING,
          description: "Contact name if phone number is not known.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "send_email",
    description: "Opens the default email client or Gmail to compose and send an email. Use when user says 'email bhejo', 'mail karo', 'send email to [person]'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        to: {
          type: Type.STRING,
          description: "Recipient email address, e.g., 'someone@gmail.com'",
        },
        subject: {
          type: Type.STRING,
          description: "Email subject line.",
        },
        body: {
          type: Type.STRING,
          description: "Email body/message content.",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
];

export const handleBrowserAction = async (fc: any, io: Server) => {
  let resultStr = "";
  const args = fc.args as any;

  try {
    if (fc.name === "open_website") {
      if (!args.url || typeof args.url !== "string") {
        throw new Error("Invalid or missing 'url' parameter.");
      }
      await openUrl(args.url, io);
      resultStr = `Success: Opened ${args.url} in the browser.`;
      io.emit("system_status", `[BROWSER] Opening URL: ${args.url}`);

    } else if (fc.name === "search_youtube") {
      if (!args.query || typeof args.query !== "string") {
        throw new Error("Invalid or missing 'query' parameter.");
      }
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(args.query)}`;
      await openUrl(searchUrl, io);
      resultStr = `Success: Searched YouTube for '${args.query}'`;
      io.emit("system_status", `[BROWSER] Searching YouTube: ${args.query}`);

    } else if (fc.name === "search_google") {
      if (!args.query || typeof args.query !== "string") {
        throw new Error("Invalid or missing 'query' parameter.");
      }
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(args.query)}`;
      await openUrl(searchUrl, io);
      resultStr = `Success: Searched Google for '${args.query}'`;
      io.emit("system_status", `[BROWSER] Searching Google: ${args.query}`);

    } else if (fc.name === "send_whatsapp") {
      if (!args.message || typeof args.message !== "string") {
        throw new Error("Invalid or missing 'message' parameter.");
      }
      const message = encodeURIComponent(args.message || "");
      let phone = args.phone ? args.phone.replace(/[^0-9]/g, "") : "";

      // If no phone given, try to find contact by name
      if (!phone && args.contact_name) {
        const contact = findContact(args.contact_name);
        if (contact?.phone) {
          phone = contact.phone.replace(/[^0-9]/g, "");
          io.emit("system_status", `[WHATSAPP] Found contact: ${contact.name} → ${contact.phone}`);
        } else {
          // Contact not in list — ask user to add
          resultStr = `Contact '${args.contact_name}' not found in contacts list. Please add their number to data/contacts.json and try again.`;
          io.emit("system_status", `[WHATSAPP] Contact not found: ${args.contact_name}`);
          return { id: fc.id, name: fc.name, response: { result: resultStr } };
        }
      }

      if (phone) {
        const url = `https://web.whatsapp.com/send?phone=${phone}&text=${message}&app_absent=0`;
        await openUrl(url, io);
        resultStr = `WhatsApp message ready for ${args.contact_name || args.phone}. Click Send in browser.`;
        io.emit("system_status", `[WHATSAPP] Chat opened → ${args.contact_name || phone}`);
      } else {
        await openUrl(`https://web.whatsapp.com`, io);
        resultStr = `Opened WhatsApp Web. No phone number found — please select contact manually.`;
        io.emit("system_status", `[WHATSAPP] WhatsApp Web opened`);
      }

    } else if (fc.name === "send_email") {
      if (!args.to || typeof args.to !== "string") {
        throw new Error("Invalid or missing 'to' parameter.");
      }
      if (!args.subject || typeof args.subject !== "string") {
        throw new Error("Invalid or missing 'subject' parameter.");
      }
      if (!args.body || typeof args.body !== "string") {
        throw new Error("Invalid or missing 'body' parameter.");
      }
      let toEmail = args.to || "";

      // If email looks like a name, try contacts lookup
      if (toEmail && !toEmail.includes("@")) {
        const contact = findContact(toEmail);
        if (contact?.email) {
          toEmail = contact.email;
          io.emit("system_status", `[EMAIL] Found contact: ${contact.name} → ${contact.email}`);
        } else {
          resultStr = `Contact '${args.to}' not found in contacts list. Please add their email to data/contacts.json.`;
          io.emit("system_status", `[EMAIL] Contact not found: ${args.to}`);
          return { id: fc.id, name: fc.name, response: { result: resultStr } };
        }
      }

      const to      = encodeURIComponent(toEmail);
      const subject = encodeURIComponent(args.subject || "");
      const body    = encodeURIComponent(args.body || "");
      const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${to}&su=${subject}&body=${body}&tf=1`;
      await openUrl(gmailUrl, io);
      resultStr = `Gmail compose opened for ${toEmail}. Click Send when ready.`;
      io.emit("system_status", `[EMAIL] Gmail compose → ${toEmail}`);

    } else {
      resultStr = `Error: Function ${fc.name} not handled by Browser Agent.`;
    }
  } catch (err: any) {
    resultStr = `Error executing ${fc.name}: ${err.message}`;
    io.emit("system_status", `[BROWSER ERROR] ${err.message}`);
  }

  return {
    id: fc.id,
    name: fc.name,
    response: { result: resultStr },
  };
};
