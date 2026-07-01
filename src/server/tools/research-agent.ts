/**
 * Research Agent — web search, page fetching, paper summarization,
 * competitor analysis, technical documentation reading
 */
import { Type, type FunctionDeclaration } from "@google/genai";
import { exec } from "child_process";
import { promisify } from "util";
import * as https from "https";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Server } from "socket.io";
import { logActivity } from "../utils/activity-log.js";

const execAsync = promisify(exec);

// ── HTTP fetch with redirect following ───────────────────────────────────────
function fetchUrl(url: string, timeoutMs = 12000): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
      },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = res.headers.location.startsWith("http")
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        fetchUrl(nextUrl, timeoutMs).then(resolve).catch(reject);
        return;
      }
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (data.length > 600000) req.destroy();
      });
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timed out")); });
  });
}

// ── Strip HTML ────────────────────────────────────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, "  ")
    .trim();
}

// ── Extract domain safely ─────────────────────────────────────────────────────
function extractDomain(rawUrl: string): string {
  try {
    const u = rawUrl.startsWith("//") ? "https:" + rawUrl : rawUrl;
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    const m = rawUrl.match(/(?:https?:\/\/)?(?:www\.)?([^/\s?#]+)/);
    return m ? m[1] : rawUrl.slice(0, 30);
  }
}

// ── Structured types ──────────────────────────────────────────────────────────
export type SearchResultItem = {
  title: string;
  snippet: string;
  url: string;
  domain: string;
};

export type StructuredSearchResult = {
  query: string;
  timestamp: string;
  overview: string;
  results: SearchResultItem[];
  keyPoints: string[];
  relatedTopics: string[];
  researchType?: string;
  totalSources: number;
};

// ── Parse DuckDuckGo HTML — precise patterns matching actual DDG HTML ─────────
function parseDDGHtml(html: string, _query: string): SearchResultItem[] {
  const items: SearchResultItem[] = [];

  // DDG actual structure:
  // <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=ENCODED_URL&amp;rut=...">Title text</a>
  // <a class="result__snippet" href="//duckduckgo.com/l/?uddg=ENCODED_URL&amp;rut=..."><b>word</b> snippet text</a>

  // Step 1: Extract all result titles + their DDG redirect URLs
  const titleRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const titles: { ddgUrl: string; title: string; realUrl: string }[] = [];
  const snippets: string[] = [];

  let m: RegExpExecArray | null;

  // Parse titles
  titleRe.lastIndex = 0;
  while ((m = titleRe.exec(html)) !== null && titles.length < 10) {
    const ddgUrl = m[1].replace(/&amp;/g, "&");
    const title = stripHtml(m[2]).trim();
    if (title.length > 3) {
      // Decode the real URL from uddg= parameter
      let realUrl = ddgUrl;
      const uddgMatch = ddgUrl.match(/[?&]uddg=([^&]+)/);
      if (uddgMatch) {
        try { realUrl = decodeURIComponent(uddgMatch[1]); } catch { realUrl = uddgMatch[1]; }
      }
      if (!realUrl.startsWith("http")) realUrl = "https:" + realUrl;
      titles.push({ ddgUrl, title, realUrl });
    }
  }

  // Parse snippets
  snippetRe.lastIndex = 0;
  while ((m = snippetRe.exec(html)) !== null && snippets.length < 10) {
    const s = stripHtml(m[1]).trim();
    if (s.length > 10) snippets.push(s);
  }

  // Pair them up
  const count = Math.min(titles.length, snippets.length);
  for (let i = 0; i < count; i++) {
    items.push({
      title:   titles[i].title,
      snippet: snippets[i],
      url:     titles[i].realUrl,
      domain:  extractDomain(titles[i].realUrl),
    });
  }

  return items.slice(0, 8);
}

// ── Brave Search scraper (fallback when DDG fails) ────────────────────────────
async function searchBrave(query: string): Promise<SearchResultItem[]> {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
  const html = await fetchUrl(url, 12000);
  const items: SearchResultItem[] = [];

  // Brave uses <div class="snippet"> with <a class="heading-serpresult" ...>
  const blocks = html.split(/<div[^>]+class="[^"]*snippet[^"]*"/gi);
  for (const block of blocks.slice(1, 12)) {
    if (items.length >= 8) break;
    const linkM = block.match(/<a[^>]+href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const descM = block.match(/<p[^>]*>([\s\S]{15,300})<\/p>/i)
      || block.match(/class="[^"]*snippet-description[^"]*"[^>]*>([\s\S]{15,300})<\/(?:div|p|span)>/i);
    if (linkM) {
      items.push({
        title:   stripHtml(linkM[2]).trim() || extractDomain(linkM[1]),
        snippet: descM ? stripHtml(descM[1]).trim().slice(0, 220) : "View source for details.",
        url:     linkM[1],
        domain:  extractDomain(linkM[1]),
      });
    }
  }
  return items;
}

// ── Wikipedia summary (always reliable) ──────────────────────────────────────
async function getWikiSummary(query: string): Promise<SearchResultItem | null> {
  try {
    const term = encodeURIComponent(query.split(" ").slice(0, 4).join(" "));
    const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${term}`;
    const json = await fetchUrl(apiUrl, 8000);
    const data = JSON.parse(json);
    if (data.extract && data.title) {
      return {
        title:   data.title + " — Wikipedia",
        snippet: data.extract.slice(0, 300),
        url:     data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${term}`,
        domain:  "en.wikipedia.org",
      };
    }
  } catch {}
  return null;
}

// ── Main search function with fallbacks ───────────────────────────────────────
async function performSearch(query: string): Promise<{ text: string; structured: StructuredSearchResult }> {
  let items: SearchResultItem[] = [];

  // 1. Try DuckDuckGo HTML
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
    const html = await fetchUrl(ddgUrl, 14000);
    items = parseDDGHtml(html, query);
  } catch {}

  // 2. If DDG gave nothing, try Brave
  if (items.length === 0) {
    try {
      items = await searchBrave(query);
    } catch {}
  }

  // 3. Always try to prepend Wikipedia summary for factual queries
  const wikiItem = await getWikiSummary(query).catch(() => null);
  if (wikiItem && !items.find(r => r.domain.includes("wikipedia"))) {
    items.unshift(wikiItem);
  }

  // 4. If still nothing, create informational fallback items
  if (items.length === 0) {
    items = [
      {
        title: `Search: ${query} — Wikipedia`,
        snippet: `Search Wikipedia for comprehensive information about "${query}".`,
        url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`,
        domain: "en.wikipedia.org",
      },
      {
        title: `${query} — Google Scholar`,
        snippet: `Find academic papers, research articles and scholarly content about "${query}".`,
        url: `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`,
        domain: "scholar.google.com",
      },
      {
        title: `${query} — DuckDuckGo`,
        snippet: `Search the web for more information about "${query}".`,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        domain: "duckduckgo.com",
      },
    ];
  }

  // ── Build structured output ────────────────────────────────────────────────
  const keyPoints = items.slice(0, 6).map((r) => {
    const first = r.snippet.split(/\.\s+/)[0].trim();
    return first.length > 20 ? first : r.snippet.slice(0, 120);
  }).filter(kp => kp.length > 15);

  const allWords = items.map(r => r.title + " " + r.snippet)
    .join(" ").split(/\s+/)
    .filter(w => w.length > 4 && /^[A-Za-z]/.test(w))
    .map(w => w.replace(/[^a-zA-Z0-9]/g, "").toLowerCase());
  const wc: Record<string, number> = {};
  allWords.forEach(w => { wc[w] = (wc[w] || 0) + 1; });
  const stopWords = new Set(["their","there","these","those","about","which","would","could","should","research","article","paper","using","based","from","with","this","that","have","been","also","more","some","into","will","than","when","after","before","other","while"]);
  const relatedTopics = Object.entries(wc)
    .filter(([w]) => !stopWords.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));

  const overview = items.length > 0
    ? items.slice(0, 2).map(r => r.snippet).join(" — ")
    : `No results found for "${query}".`;

  const structured: StructuredSearchResult = {
    query,
    timestamp: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }),
    overview,
    results: items,
    keyPoints,
    relatedTopics,
    totalSources: items.length,
  };

  const textLines = items.slice(0, 6).map((r, i) =>
    `${i + 1}. **${r.title}**\n   ${r.snippet}\n   URL: ${r.url}`
  );
  const text = items.length > 0
    ? `Search results for "${query}":\n\n${textLines.join("\n\n")}`
    : `No results found for "${query}".`;

  return { text, structured };
}

// Keep the old name as alias
const duckDuckGoSearch = performSearch;


export const researchToolDeclarations: FunctionDeclaration[] = [
  {
    name: "web_search",
    description:
      "Searches the web for information using DuckDuckGo. Use when user says 'search karo', 'internet pe dhundo', 'find information about X', 'latest news about X', 'what is X'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The search query.",
        },
        num_results: {
          type: Type.NUMBER,
          description: "Number of results to return. Default 5, max 10.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_webpage",
    description:
      "Fetches and reads the content of a specific webpage URL. Use when user says 'is URL pe kya hai', 'read this page', 'fetch this link', or after a web search to get more details.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "The full URL to fetch.",
        },
        extract_type: {
          type: Type.STRING,
          description: "What to extract: 'text' (default), 'links', 'headings'",
          enum: ["text", "links", "headings"],
        },
      },
      required: ["url"],
    },
  },
  {
    name: "research_topic",
    description:
      "Performs deep research on a topic: searches multiple sources and compiles a summary. Use when user says 'research karo', 'deep dive into X', 'competitor analysis', 'market research'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: {
          type: Type.STRING,
          description: "The topic to research.",
        },
        research_type: {
          type: Type.STRING,
          description: "Type of research.",
          enum: ["general", "competitor", "technical", "market", "academic"],
        },
        save_report: {
          type: Type.BOOLEAN,
          description: "Save the research report to a file on Desktop.",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "write_report",
    description:
      "Writes a research report, README, proposal, or document to a file. Use when user says 'report likhao', 'document banao', 'proposal likhao', 'meeting summary'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: "Document title.",
        },
        content: {
          type: Type.STRING,
          description: "The full document content in markdown.",
        },
        doc_type: {
          type: Type.STRING,
          description: "Document type.",
          enum: ["report", "proposal", "readme", "email", "meeting_summary", "methodology", "ppt_outline"],
        },
        save_path: {
          type: Type.STRING,
          description: "Optional: file path to save. Defaults to Desktop.",
        },
      },
      required: ["title", "content", "doc_type"],
    },
  },
];

export const handleResearchAction = async (fc: any, io: Server): Promise<any> => {
  let resultStr = "";
  const args = fc.args as any;

  try {
    if (fc.name === "web_search") {
      io.emit("system_status", `[RESEARCH] Searching: ${args.query}`);
      // Emit loading state to frontend
      io.emit("search_loading", { query: args.query });
      logActivity("WEB_SEARCH", { query: args.query });

      const { text, structured } = await duckDuckGoSearch(args.query);

      // Emit structured result to frontend panel
      io.emit("search_result", structured);
      io.emit("system_status", `[RESEARCH] Search complete — ${structured.totalSources} sources`);

      resultStr = text;

    } else if (fc.name === "fetch_webpage") {
      io.emit("system_status", `[RESEARCH] Fetching: ${args.url.slice(0, 60)}`);
      logActivity("FETCH_WEBPAGE", { url: args.url });

      const html = await fetchUrl(args.url, 15000);
      const extractType = args.extract_type || "text";

      if (extractType === "links") {
        const links: string[] = [];
        const linkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null && links.length < 20) {
          const text = stripHtml(match[2]).trim();
          if (text) links.push(`- [${text}](${match[1]})`);
        }
        resultStr = links.length > 0 ? `Links found:\n${links.join("\n")}` : "No links found.";
      } else if (extractType === "headings") {
        const headings: string[] = [];
        const hRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
        let match;
        while ((match = hRegex.exec(html)) !== null && headings.length < 30) {
          headings.push(`${"#".repeat(parseInt(match[1]))} ${stripHtml(match[2]).trim()}`);
        }
        resultStr = headings.length > 0 ? `Headings:\n${headings.join("\n")}` : "No headings found.";
      } else {
        resultStr = stripHtml(html);
      }

      io.emit("system_status", `[RESEARCH] Page fetched`);

    } else if (fc.name === "research_topic") {
      io.emit("system_status", `[RESEARCH] Deep research: ${args.topic}`);
      io.emit("search_loading", { query: args.topic });
      logActivity("RESEARCH_TOPIC", { topic: args.topic, type: args.research_type });

      // Run 3 searches with different angles
      const queries = [
        args.topic,
        `${args.topic} overview 2024`,
        args.research_type === "competitor" ? `${args.topic} competitors alternatives` :
        args.research_type === "technical"  ? `${args.topic} technical documentation` :
        `${args.topic} latest developments`,
      ];

      const allItems: SearchResultItem[] = [];
      const allKeyPoints: string[] = [];
      const combinedText: string[] = [];

      for (const q of queries) {
        try {
          const { text, structured } = await duckDuckGoSearch(q);
          combinedText.push(text);
          allItems.push(...structured.results);
          allKeyPoints.push(...structured.keyPoints);
          io.emit("system_status", `[RESEARCH] Query done: ${q.slice(0, 40)}`);
        } catch {}
      }

      // Deduplicate by title
      const seen = new Set<string>();
      const uniqueItems = allItems.filter((r) => {
        if (seen.has(r.title)) return false;
        seen.add(r.title); return true;
      }).slice(0, 12);

      // Related topics — extract from all titles
      const allWords = uniqueItems
        .map((r) => r.title).join(" ").split(/\s+/)
        .filter((w) => w.length > 4 && /^[A-Za-z]/.test(w))
        .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""));
      const wc: Record<string, number> = {};
      allWords.forEach((w) => { wc[w] = (wc[w] || 0) + 1; });
      const relatedTopics = Object.entries(wc)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([w]) => w);

      const overview = uniqueItems.slice(0, 3).map((r) => r.snippet).join(" ");

      const structured: StructuredSearchResult = {
        query: args.topic,
        timestamp: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }),
        overview,
        results: uniqueItems,
        keyPoints: [...new Set(allKeyPoints)].slice(0, 10),
        relatedTopics,
        researchType: args.research_type || "general",
        totalSources: uniqueItems.length,
      };

      io.emit("search_result", structured);

      const combined = combinedText.join("\n\n---\n\n");
      resultStr = `Research on "${args.topic}" (${args.research_type || "general"}):\n\n${combined.slice(0, 6000)}`;

      if (args.save_report) {
        const timestamp = new Date().toISOString().slice(0, 10);
        const fileName = `research_${args.topic.replace(/\s+/g, "_").slice(0, 30)}_${timestamp}.md`;
        const savePath = path.join(os.homedir(), "Desktop", fileName);
        const reportContent = `# Research Report: ${args.topic}\n\nDate: ${new Date().toLocaleDateString()}\nType: ${args.research_type || "general"}\n\n---\n\n${combined}`;
        fs.writeFileSync(savePath, reportContent, "utf-8");
        resultStr += `\n\nReport saved to: ${savePath}`;
        io.emit("system_status", `[RESEARCH] Report saved: ${fileName}`);
      }

    } else if (fc.name === "write_report") {
      const ext = args.doc_type === "ppt_outline" ? ".md" : ".md";
      const safeName = args.title.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_").slice(0, 50);
      const timestamp = new Date().toISOString().slice(0, 10);
      const defaultPath = path.join(os.homedir(), "Desktop", `${safeName}_${timestamp}${ext}`);
      const savePath = args.save_path || defaultPath;

      const dir = path.dirname(savePath);
      if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(savePath, args.content, "utf-8");

      resultStr = `${args.doc_type} saved to: ${savePath}`;
      io.emit("system_status", `[RESEARCH] Document saved: ${path.basename(savePath)}`);
      logActivity("WRITE_REPORT", { title: args.title, type: args.doc_type, path: savePath });
    }
  } catch (err: any) {
    resultStr = `Error: ${err.message}`;
    io.emit("system_status", `[RESEARCH ERROR] ${err.message?.slice(0, 80)}`);
  }

  return { id: fc.id, name: fc.name, response: { result: resultStr } };
};
