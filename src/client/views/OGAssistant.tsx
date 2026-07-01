import {
  Camera, CameraOff, ImagePlus, Power, Send, X, Mic,
  ChevronRight, Volume2, ChevronDown, Check,
  Activity, Cpu, HardDrive, Clock, Zap, User, Search,
  Plus, MessageSquare, Trash2, ChevronLeft, MoreHorizontal,
  Home, Code, Eye, EyeOff, FolderOpen, Network, Database, Settings,
  Globe, Play, Terminal, Sliders, Sun, Cloud, Wifi, Battery,
  Maximize2, Sparkles, Monitor, Brain, CheckCircle,
} from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
import { Slide, toast } from "react-toastify";
import { io } from "socket.io-client";
import EmoFace from "../utils/EmoFace";
import SystemControlPanel from "../utils/SystemControlPanel";
import SuitUpOverlay from "../utils/SuitUpOverlay";
import MotionNeuron from "../utils/MotionNeuron";
import ResearchPanel, { type ResearchData } from "../utils/ResearchPanel";
import { AvatarStateEngine, type AvatarState, type AvatarEmotion } from "../utils/AvatarStateEngine";

// ── Types ──────────────────────────────────────────────────────────────────────
type TranscriptMsg = {
  id: number;
  role: string;
  text: string;
  isFinal: boolean;
  image?: string;
  timestamp?: string;
};

type ChatSession = {
  id: string;
  title: string;
  messages: TranscriptMsg[];
  createdAt: number;
  updatedAt: number;
};

// ── Storage helpers ────────────────────────────────────────────────────────────
const STORAGE_KEY = "og_chat_sessions";
const ACTIVE_KEY  = "og_active_session";

function loadSessions(): ChatSession[] {
  try {
    const newRaw = localStorage.getItem(STORAGE_KEY);
    if (newRaw) return JSON.parse(newRaw);

    const oldRaw = localStorage.getItem("natalie_chat_sessions");
    if (oldRaw) {
      localStorage.setItem(STORAGE_KEY, oldRaw);
      localStorage.removeItem("natalie_chat_sessions");

      const oldActive = localStorage.getItem("natalie_active_session");
      if (oldActive) {
        localStorage.setItem(ACTIVE_KEY, oldActive);
        localStorage.removeItem("natalie_active_session");
      }

      return JSON.parse(oldRaw);
    }
    return [];
  } catch { return []; }
}

// Save sessions helper
function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

// Derive title helper
function deriveTitle(msgs: TranscriptMsg[]): string {
  const first = msgs.find(m => m.role === "USER");
  if (!first) return "New Chat";
  return first.text.slice(0, 36) + (first.text.length > 36 ? "…" : "");
}

// Relative time formatting helper
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Get current formatted time
function nowTime() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

// ── History Drawer ─────────────────────────────────────────────────────────────
function HistoryDrawer({
  open, onClose, sessions, activeId,
  onSelect, onNew, onDelete,
}: {
  open: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const today     = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
  const weekAgo   = new Date(today); weekAgo.setDate(today.getDate()-7);

  const grouped: { label: string; items: ChatSession[] }[] = [];
  const todaySessions    = sessions.filter(s => s.updatedAt >= today.getTime());
  const yesterdaySessions= sessions.filter(s => s.updatedAt >= yesterday.getTime() && s.updatedAt < today.getTime());
  const weekSessions     = sessions.filter(s => s.updatedAt >= weekAgo.getTime() && s.updatedAt < yesterday.getTime());
  const olderSessions    = sessions.filter(s => s.updatedAt < weekAgo.getTime());

  if (todaySessions.length)     grouped.push({ label: "Today",          items: todaySessions });
  if (yesterdaySessions.length) grouped.push({ label: "Yesterday",      items: yesterdaySessions });
  if (weekSessions.length)      grouped.push({ label: "Previous 7 Days",items: weekSessions });
  if (olderSessions.length)     grouped.push({ label: "Older",          items: olderSessions });

  return (
    <>
      {open && (
        <div className="absolute inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
          onClick={onClose} />
      )}

      <div className="absolute top-0 left-0 h-full z-50 flex flex-col"
        style={{
          width: 272,
          background: "rgba(8,6,22,0.98)",
          borderRight: "1px solid rgba(0,200,255,0.25)",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.3s cubic-bezier(0.16,1,0.3,1)",
          boxShadow: open ? "4px 0 40px rgba(140,60,255,0.15)" : "none",
        }}>

        <div className="flex items-center justify-between px-4 py-3 flex-none"
          style={{ borderBottom: "1px solid rgba(140,60,255,0.12)" }}>
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center rounded-full"
              style={{ width:28, height:28, background:"radial-gradient(circle,rgba(140,60,255,0.9) 0%,rgba(60,20,140,0.8) 70%)", boxShadow:"0 0 10px rgba(140,60,255,0.5)" }}>
              <Zap size={12} style={{ color:"#fff" }} />
            </div>
            <span className="text-[13px] font-bold" style={{ color:"#e8d5ff" }}>Chat History</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 transition-all"
            style={{ color:"rgba(255,255,255,0.4)" }}>
            <ChevronLeft size={16} />
          </button>
        </div>

        <div className="px-3 py-2 flex-none">
          <button onClick={() => { onNew(); onClose(); }}
            className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl transition-all hover:opacity-90"
            style={{ background:"rgba(0,200,255,0.25)", border:"1px solid rgba(140,60,255,0.35)", color:"rgba(220,180,255,0.95)" }}>
            <Plus size={14} />
            <span className="text-[12px] font-semibold">New Chat</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4" style={{ scrollbarWidth:"none" }}>
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 opacity-40">
              <MessageSquare size={22} style={{ color:"rgba(140,60,255,0.5)" }} />
              <p className="text-[10px]" style={{ color:"rgba(255,255,255,0.4)" }}>No chat history yet</p>
            </div>
          ) : grouped.map(group => (
            <div key={group.label} className="mb-3">
              <p className="text-[9px] font-semibold tracking-widest uppercase px-2 py-1.5"
                style={{ color:"rgba(255,255,255,0.2)" }}>
                {group.label}
              </p>
              {group.items.map(session => (
                <div key={session.id}
                  className="flex items-center gap-1 rounded-xl px-2 py-2 mb-0.5 group transition-all"
                  style={{
                    background: session.id === activeId ? "rgba(140,60,255,0.18)" : "transparent",
                    border: `1px solid ${session.id === activeId ? "rgba(140,60,255,0.3)" : "transparent"}`,
                    cursor:"pointer",
                  }}
                  onClick={() => { onSelect(session.id); onClose(); }}>
                  <div className="flex-none" style={{ color: session.id === activeId ? "rgba(180,100,255,0.9)" : "rgba(255,255,255,0.25)" }}>
                    <MessageSquare size={13} />
                  </div>
                  <div className="flex-1 min-w-0 px-1">
                    <p className="text-[11px] font-medium truncate"
                      style={{ color: session.id === activeId ? "rgba(220,180,255,0.95)" : "rgba(200,180,255,0.7)" }}>
                      {session.title}
                    </p>
                    <p className="text-[9px]" style={{ color:"rgba(255,255,255,0.2)" }}>
                      {formatRelativeTime(session.updatedAt)}
                      {" · "}{session.messages.filter(m=>m.role!=="SYSTEM").length} msgs
                    </p>
                  </div>
                  <button
                    className="flex-none opacity-0 group-hover:opacity-100 transition-all p-1 rounded-lg hover:bg-red-500/20"
                    style={{ color:"rgba(255,80,80,0.7)" }}
                    onClick={e => { e.stopPropagation(); onDelete(session.id); }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="px-4 py-3 flex-none" style={{ borderTop:"1px solid rgba(255,255,255,0.05)" }}>
          <p className="text-[9px]" style={{ color:"rgba(255,255,255,0.2)" }}>
            {sessions.length} conversation{sessions.length !== 1 ? "s" : ""} saved locally
          </p>
        </div>
      </div>
    </>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
const OGAssistant = () => {
  const [activeNavTab, setActiveNavTab] = useState("home");
  const [isConnected, setIsConnected]   = useState(false);
  const [isSpeaking, setIsSpeaking]     = useState(false);
  const [socket, setSocket]             = useState<ReturnType<typeof io> | null>(null);

  // -- Avatar state engine --
  const avatarEngineRef = useRef<AvatarStateEngine>(new AvatarStateEngine());
  const [avatarState,   setAvatarState]   = useState<AvatarState>("IDLE");
  const [avatarEmotion, setAvatarEmotion] = useState<AvatarEmotion>("neutral");
  const [, setAvatarIntensity]            = useState(0.3);
  const [isExecuting, setIsExecuting]     = useState(false);
  const [isCompleted, setIsCompleted]     = useState(false);

  const syncAvatar = useCallback(() => {
    const eng = avatarEngineRef.current;
    setAvatarState(eng.state);
    setAvatarEmotion(eng.emotion);
    setAvatarIntensity(eng.intensity);
  }, []);

  const [transcripts, setTranscripts]   = useState<TranscriptMsg[]>(() => {
    try {
      const savedId = localStorage.getItem(ACTIVE_KEY) || localStorage.getItem("natalie_active_session");
      if (savedId) {
        const allSessions = loadSessions();
        const session = allSessions.find(s => s.id === savedId);
        if (session && session.messages.filter(m => m.role !== "SYSTEM").length > 0) {
          return session.messages;
        }
      }
    } catch {}
    return [];
  });
  const [chatInput, setChatInput]       = useState("");
  const [theme, setTheme]               = useState<"dark" | "light">(() => {
    return (localStorage.getItem("og_theme") as "dark" | "light") || "dark";
  });

  const toggleTheme = () => {
    setTheme(t => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem("og_theme", next);
      return next;
    });
  };

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("theme-light");
      root.classList.remove("theme-dark");
    } else {
      root.classList.add("theme-dark");
      root.classList.remove("theme-light");
    }
  }, [theme]);

  const [pendingImage, setPendingImage] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);
  const [cameraOn, setCameraOn]         = useState(false);
  const [visionMode, setVisionMode]     = useState<'camera' | 'screen'>('camera');
  const [hideCameraPreview, setHideCameraPreview] = useState(false);
  const [, setCameraError]              = useState<string | null>(null);
  const [suitUp, setSuitUp]             = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);
  const [time, setTime]                 = useState(new Date());
  const [uptime, setUptime]             = useState(0);

  const [cpuUsage]                      = useState(23);
  const [ramUsage]                      = useState(62);
  const [storageUsage]                  = useState(45);
  const [fluctuation]                   = useState(0.72);

  // ── Chat session state ─────────────────────────────────────────────────────
  const [sessions, setSessions]         = useState<ChatSession[]>(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return localStorage.getItem(ACTIVE_KEY) || localStorage.getItem("natalie_active_session") || "";
  });
  const [historyOpen, setHistoryOpen]   = useState(false);
  const [sysPanel, setSysPanel]         = useState(false);
  const [, setIsInputFocused]           = useState(false);
  const [leftPaneWidth, setLeftPaneWidth] = useState(320);
  const [rightPaneWidth, setRightPaneWidth] = useState(320);
  const [isResizing, setIsResizing]       = useState<'left' | 'right' | null>(null);
  const [chatHeight, setChatHeight]       = useState(220);
  const [isResizingChat, setIsResizingChat] = useState(false);

  const [consoleLogs, setConsoleLogs]   = useState<string[]>([
    "System readiness: 100%",
    "All systems operational",
    "Voice module: Active",
    "Neural uplink: Stable",
  ]);
  const [isHealing, setIsHealing]       = useState(false);

  // ── Research Panel state ───────────────────────────────────────────────────
  const [researchVisible, setResearchVisible]       = useState(false);
  const [researchData, setResearchData]             = useState<ResearchData | null>(null);
  const [researchLoading, setResearchLoading]       = useState(false);
  const [researchLoadingQuery, setResearchLoadingQuery] = useState("");

  const scrollRef      = useRef<HTMLDivElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const videoRef       = useRef<HTMLVideoElement>(null);
  const centerVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const camIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uptimeRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  const greetingText = (() => {
    const h = new Date().getHours();
    if (h >= 5  && h < 12) return "Good Morning, Varun";
    if (h >= 12 && h < 17) return "Good Afternoon, Varun";
    if (h >= 17 && h < 21) return "Good Evening, Varun";
    return "Good Night, Varun";
  })();

  const uptimeStr = (() => {
    const h = Math.floor(uptime / 3600).toString().padStart(2, "0");
    const m = Math.floor((uptime % 3600) / 60).toString().padStart(2, "0");
    const s = (uptime % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  })();

  const timeStr = time.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const ensureSession = useCallback((msgs: TranscriptMsg[]) => {
    setSessions(prev => {
      const existing = prev.find(s => s.id === activeSessionId);
      const title = deriveTitle(msgs);
      if (existing) {
        const updated = prev.map(s =>
          s.id === activeSessionId
            ? { ...s, messages: msgs, title: title || s.title, updatedAt: Date.now() }
            : s
        );
        saveSessions(updated);
        return updated;
      } else {
        if (msgs.filter(m => m.role !== "SYSTEM").length === 0) return prev;
        const newId = activeSessionId || `session_${Date.now()}`;
        if (!activeSessionId) {
          setActiveSessionId(newId);
          localStorage.setItem(ACTIVE_KEY, newId);
        }
        const newSession: ChatSession = {
          id: newId, title: title || "New Chat",
          messages: msgs, createdAt: Date.now(), updatedAt: Date.now(),
        };
        const updated = [newSession, ...prev];
        saveSessions(updated);
        return updated;
      }
    });
  }, [activeSessionId]);

  useEffect(() => {
    if (transcripts.length > 0) {
      ensureSession(transcripts);
    }
  }, [transcripts, ensureSession]);

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (transcripts.filter(m => m.role !== "SYSTEM").length === 0) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      const sessionData = sessions.find(s => s.id === activeSessionId);
      if (sessionData && socket) {
        socket.emit("sync_session", {
          id:         sessionData.id,
          title:      sessionData.title,
          messages:   transcripts,
          createdAt:  sessionData.createdAt,
          updatedAt:  Date.now(),
        });
      }
    }, 1500);
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
  }, [transcripts, activeSessionId, sessions]);

  const handleNewChat = useCallback(() => {
    const newId = `session_${Date.now()}`;
    setActiveSessionId(newId);
    localStorage.setItem(ACTIVE_KEY, newId);
    setTranscripts([]);
    setChatInput("");
    setPendingImage(null);
  }, []);

  const handleSelectSession = useCallback((id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session) {
      setActiveSessionId(id);
      localStorage.setItem(ACTIVE_KEY, id);
      setTranscripts(session.messages);
      if (socket) {
        socket.emit("sync_session", {
          id:        session.id,
          title:     session.title,
          messages:  session.messages,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        });
      }
    }
  }, [sessions]);

  const handleDeleteSession = useCallback((id: string) => {
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== id);
      saveSessions(updated);
      return updated;
    });
    if (id === activeSessionId) {
      handleNewChat();
    }
  }, [activeSessionId, handleNewChat]);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (isConnected) {
      uptimeRef.current = setInterval(() => setUptime(u => u + 1), 1000);
    } else {
      if (uptimeRef.current) { clearInterval(uptimeRef.current); uptimeRef.current = null; }
      setUptime(0);
    }
    return () => { if (uptimeRef.current) clearInterval(uptimeRef.current); };
  }, [isConnected]);

  useEffect(() => {
    avatarEngineRef.current.setChangeListener(() => {
      syncAvatar();
    });

    const s = io();
    setSocket(s);

    s.on("system_status", (msg: string) => {
      if (msg.includes("Connected"))
        toast.success(msg, { position:"top-right", autoClose:3000, theme:"dark", transition:Slide });
      else if (msg.includes("Disconnected")) {
        setIsSpeaking(false);
        avatarEngineRef.current.onDisconnect(); syncAvatar();
        toast.error(msg, { position:"top-right", autoClose:3000, theme:"dark", transition:Slide });
      }

      const lower = msg.toLowerCase();
      if (lower.includes("error") || lower.includes("failed") || lower.includes("blocked")) {
        avatarEngineRef.current.onError();
        setIsExecuting(false);
      } else if (lower.includes("success") || lower.includes("done:") || lower.includes("done ") || lower.includes("complete") || lower.includes("installed:") || lower.includes("terminated")) {
        avatarEngineRef.current.onSuccess();
        setIsExecuting(false);
      } else if (lower.includes("running") || lower.includes("installing") || lower.includes("locating") || lower.includes("analyzing") || lower.includes("searching") || lower.includes("capture screen")) {
        avatarEngineRef.current.onProcessing();
        setIsExecuting(true);
        setIsCompleted(false);
      }

      if (lower.includes("tool executing") || lower.includes("executing")) {
        setIsExecuting(true);
        setIsCompleted(false);
      }

      setTranscripts(prev => [...prev, { id: Date.now()+Math.random(), role:"SYSTEM", text:msg, isFinal:true, timestamp:nowTime() }]);
    });

    s.on("transcript_chunk", (msg: { role: string; text: string }) => {
      if (msg.role === "USER") {
        setIsCompleted(false);
        setIsExecuting(false);
      }
      if (msg.role === "AGENT") {
        setIsSpeaking(true);
        avatarEngineRef.current.onAgentChunk(msg.text); syncAvatar();
      }
      setTranscripts(prev => {
        if (!prev.length) return [{ id:Date.now()+Math.random(), role:msg.role, text:msg.text, isFinal:false, timestamp:nowTime() }];
        const last = prev[prev.length-1];
        if (last.role === msg.role && !last.isFinal) {
          const u = [...prev]; u[u.length-1] = { ...u[u.length-1], text: u[u.length-1].text + msg.text }; return u;
        }
        return [...prev, { id:Date.now()+Math.random(), role:msg.role, text:msg.text, isFinal:false, timestamp:nowTime() }];
      });
    });

    s.on("agent_speaking", (isSpeakingVal: boolean) => {
      setIsSpeaking(isSpeakingVal);
      if (!isSpeakingVal) { avatarEngineRef.current.onSpeakingEnd(); syncAvatar(); }
    });

    s.on("turn_complete", () => {
      setIsExecuting(false);
      setIsCompleted(true);
      setTimeout(() => {
        setIsSpeaking(false);
        avatarEngineRef.current.onSpeakingEnd(); syncAvatar();
      }, 2500);
      setTranscripts(prev => {
        if (!prev.length) return prev;
        const u = [...prev]; u[u.length-1] = { ...u[u.length-1], isFinal:true }; return u;
      });
    });

    s.on("search_loading", (payload: { query: string }) => {
      setResearchLoadingQuery(payload.query); setResearchLoading(true);
      setResearchData(null); setResearchVisible(true);
      avatarEngineRef.current.onThinking(); syncAvatar();
    });

    s.on("search_result", (payload: ResearchData) => {
      setResearchData(payload); setResearchLoading(false); setResearchVisible(true);
    });

    s.on("open_url", (payload: { url: string }) => {
      const newWindow = window.open(payload.url, "_blank");
      if (!newWindow || newWindow.closed || typeof newWindow.closed === "undefined") {
        toast.info(
          <div className="flex flex-col gap-1 text-left">
            <span className="font-semibold text-xs text-white">Popup Blocked</span>
            <span className="text-[10px] text-white/70">Click below to open link:</span>
            <a 
              href={payload.url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-cyan-400 hover:text-cyan-300 underline break-all font-mono text-[10px] mt-1"
            >
              {payload.url}
            </a>
          </div>,
          { position: "top-right", autoClose: 10000, theme: "dark" }
        );
      } else {
        toast.success(`Opening URL in new tab...`, { position: "top-right", autoClose: 3000, theme: "dark" });
      }
    });

    s.on("self_heal_log", (data: { message: string }) => {
      setConsoleLogs(prev => [...prev, data.message]);
    });

    s.on("sys_control_result", (data: { type: string; success: boolean; value?: any; error?: string }) => {
      if (data.type === "self_heal") {
        setIsHealing(false);
        if (data.success) {
          setConsoleLogs(prev => [...prev, `[HEAL SUCCESS] ${data.value}`]);
          toast.success("System Self-Healing Complete!", { position: "top-right", theme: "dark" });
        } else {
          setConsoleLogs(prev => [...prev, `[HEAL ERROR] ${data.error || "Healing failed."}`]);
          toast.error(`Self-Healing Error: ${data.error || "Unknown error"}`, { position: "top-right", theme: "dark" });
        }
      }
    });

    return () => {
      s.disconnect();
      setSocket(null);
      avatarEngineRef.current.setChangeListener(null);
      avatarEngineRef.current.destroy();
    };
  }, [syncAvatar]);

  useEffect(() => {
    if (isConnected && !isSpeaking) {
      avatarEngineRef.current.onListening();
      syncAvatar();
    }
  }, [isConnected, isSpeaking, syncAvatar]);

  const handleConnect = () => {
    if (!isConnected) { setSuitUp(true); }
    else {
      if (transcripts.filter(m => m.role !== "SYSTEM").length > 0) {
        const sessionData = sessions.find(s => s.id === activeSessionId);
        if (sessionData && socket) {
          socket.emit("sync_session", {
            id:        sessionData.id,
            title:     sessionData.title,
            messages:  transcripts,
            createdAt: sessionData.createdAt,
            updatedAt: Date.now(),
          });
        }
      }
      socket?.emit("OG_Disconnected", "OG Disconnected");
      setIsConnected(false); setIsSpeaking(false); stopCamera();
      avatarEngineRef.current.onDisconnect(); syncAvatar();
    }
  };

  const handleSuitUpDone = useCallback(() => {
    setSuitUp(false); socket?.emit("OG_Connected", "OG Connected");
    setIsConnected(true); setShowGreeting(true); setTimeout(() => setShowGreeting(false), 4000);
    avatarEngineRef.current.onConnect(); syncAvatar();
    setSessions(prev => {
      const loaded = prev;
      if (loaded.length > 0 && transcripts.filter(m => m.role !== "SYSTEM").length === 0) {
        const latest = loaded[0];
        if (latest) {
          setActiveSessionId(latest.id);
          localStorage.setItem(ACTIVE_KEY, latest.id);
          setTranscripts(latest.messages);
        }
      }
      return prev;
    });
  }, [syncAvatar, transcripts]);

  const startCamera = async (mode: 'camera' | 'screen' = 'camera') => {
    setCameraError(null);
    setVisionMode(mode);
    try {
      let stream: MediaStream;
      if (mode === 'screen') {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      }
      streamRef.current = stream;
      setCameraOn(true);
      toast.success(mode === 'screen' ? "Screen sharing active" : "Camera active", { position: "top-right", autoClose: 2000, theme: "dark", transition: Slide });
      
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopCamera();
        };
      }

      setTimeout(() => { camIntervalRef.current = setInterval(() => captureAndSendFrame(), 5000); }, 1500);
    } catch (err: any) {
      setCameraError(err.message || "Access denied");
      toast.error((mode === 'screen' ? "Screen sharing error: " : "Camera error: ") + (err.message || "Access denied"), { position: "top-right", autoClose: 3000, theme: "dark", transition: Slide });
    }
  };

  const stopCamera = () => {
    if (camIntervalRef.current) { clearInterval(camIntervalRef.current); camIntervalRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (centerVideoRef.current) centerVideoRef.current.srcObject = null;
    setCameraOn(false);
    setHideCameraPreview(false);
  };

  const captureAndSendFrame = () => {
    const video = videoRef.current;
    if (!video || !streamRef.current || video.readyState < 2 || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = canvas.toDataURL("image/jpeg", 0.5);
    socket?.emit("vision_frame", { frame });
  };
  
  const handleCameraToggle = () => {
    if (!isConnected) { toast.error("Connect first before using camera", { position:"top-right", autoClose:2000, theme:"dark", transition:Slide }); return; }
    if (cameraOn) {
      if (visionMode === 'camera') {
        stopCamera();
      } else {
        stopCamera();
        setTimeout(() => startCamera('camera'), 300);
      }
    } else {
      startCamera('camera');
    }
  };

  const handleScreenToggle = () => {
    if (!isConnected) { toast.error("Connect first before using screen share", { position:"top-right", autoClose:2000, theme:"dark", transition:Slide }); return; }
    if (cameraOn) {
      if (visionMode === 'screen') {
        stopCamera();
      } else {
        stopCamera();
        setTimeout(() => startCamera('screen'), 300);
      }
    } else {
      startCamera('screen');
    }
  };

  const triggerSelfHealing = () => {
    if (!isConnected) {
      toast.error("Connect first to trigger self-healing", { position: "top-right", autoClose: 2000, theme: "dark", transition: Slide });
      return;
    }
    setIsHealing(true);
    setConsoleLogs(prev => [...prev, "Starting self-healing diagnostics..."]);
    socket?.emit("sys_control", { type: "self_heal" });
  };

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(",")[1];
      setPendingImage({
        base64,
        mimeType: file.type,
        preview: URL.createObjectURL(file),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSend = () => {
    if (!chatInput.trim() && !pendingImage) return;
    setIsCompleted(false);
    setIsExecuting(false);
    const text = chatInput.trim();
    const imageBase64 = pendingImage?.base64 || undefined;
    const mimeType = pendingImage?.mimeType || undefined;
    const preview = pendingImage?.preview || undefined;

    if (socket) {
      socket.emit("chat_message", { text, image: imageBase64, mimeType });
    }

    const userMsg: TranscriptMsg = {
      id: Date.now() + Math.random(),
      role: "USER",
      text,
      image: preview,
      isFinal: true,
      timestamp: nowTime(),
    };

    setTranscripts(prev => [...prev, userMsg]);
    setChatInput("");
    setPendingImage(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSearchRelated = (query: string) => {
    if (socket) {
      socket.emit("chat_message", { text: query });
    }
    const userMsg: TranscriptMsg = {
      id: Date.now() + Math.random(),
      role: "USER",
      text: query,
      isFinal: true,
      timestamp: nowTime(),
    };
    setTranscripts(prev => [...prev, userMsg]);
    setResearchVisible(false);
  };

  useEffect(() => {
    if (cameraOn && streamRef.current) {
      if (videoRef.current) {
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.play().catch(() => {});
      }
      if (centerVideoRef.current) {
        centerVideoRef.current.srcObject = streamRef.current;
        centerVideoRef.current.play().catch(() => {});
      }
    }
  }, [cameraOn, activeNavTab, visionMode]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden select-none text-white font-sans bg-black relative"
      style={{
        backgroundImage: theme === "dark" ? "url('/bg1.jpg')" : "none",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundColor: theme === "dark" ? "#000000" : "#f1f5f9",
      }}>

      {suitUp && <SuitUpOverlay onDone={handleSuitUpDone} />}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />

      <SystemControlPanel
        isOpen={sysPanel}
        onClose={() => setSysPanel(false)}
        socket={socket}
      />

      {/* ══════════════════════════════════════════════════════════
          TOP GLOBAL HEADER
          ══════════════════════════════════════════════════════════ */}
      <header className="flex items-center justify-between px-6 py-2 border-b border-cyan-500/10 backdrop-blur-md bg-black/60 z-20 h-14 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center rounded-full bg-gradient-to-r from-purple-600 to-cyan-500 p-[1px] shadow-[0_0_12px_rgba(6,182,212,0.4)]">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-black">
              <Zap size={14} className="text-cyan-400" />
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-[14px] font-black tracking-widest leading-none">OG</span>
            <span className="text-[8px] font-bold text-cyan-400 tracking-wider">AI ASSISTANT</span>
          </div>
          {/* Waveform graphic next to logo */}
          <div className="flex items-center gap-[2px] h-4 px-2">
            {[8, 14, 18, 12, 8, 16, 12, 6].map((h, i) => (
              <div
                key={i}
                className="w-[2px] rounded-full bg-cyan-400"
                style={{
                  height: `${h}px`,
                  animation: isConnected ? `chatwave 0.5s ease-in-out ${i * 0.06}s infinite alternate` : "none",
                }}
              />
            ))}
          </div>
        </div>

        {/* Center Navigation Tabs */}
        <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-full px-2 py-1">
          {[
            { id: "home", label: "HOME", icon: Home },
            { id: "chat", label: "CHAT", icon: MessageSquare },
            { id: "code", label: "CODE", icon: Code },
            { id: "vision", label: "VISION", icon: Eye },
            { id: "automation", label: "AUTOMATION", icon: Network },
            { id: "memory", label: "MEMORY", icon: Database },
            { id: "settings", label: "SETTINGS", icon: Settings },
          ].map(tab => {
            const Icon = tab.icon;
            const isSelected = activeNavTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveNavTab(tab.id);
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-wider transition-all duration-300 ${
                  isSelected
                    ? "bg-purple-950/40 border border-purple-500/30 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.4)]"
                    : "text-white/40 hover:text-white/80 border border-transparent"
                }`}
              >
                <Icon size={11} className={isSelected ? "text-purple-400" : "text-white/40"} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right clock & widgets */}
        <div className="flex items-center gap-4 text-cyan-400/80">
          <div className="flex flex-col items-end font-mono">
            <span className="text-[12px] font-bold tracking-wider text-white leading-none">{timeStr}</span>
            <span className="text-[7.5px] uppercase tracking-widest text-cyan-400/70 mt-0.5">
              {time.toLocaleDateString("en-US", { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>

          {/* Theme Switcher Toggle */}
          <button onClick={toggleTheme} className="p-1.5 rounded-lg border border-cyan-500/10 bg-cyan-950/10 text-cyan-400 hover:bg-cyan-950/30 hover:border-cyan-400/40 transition-all shrink-0 cursor-pointer" title="Toggle Light/Dark Theme">
            {theme === "dark" ? <Sun size={12} /> : <Cloud size={12} />}
          </button>

          <button onClick={() => {
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch(() => {});
            } else {
              document.exitFullscreen().catch(() => {});
            }
          }} className="p-1.5 rounded-lg border border-cyan-500/10 bg-cyan-950/10 text-cyan-400 hover:bg-cyan-950/30 hover:border-cyan-400/40 transition-all shrink-0">
            <Maximize2 size={12} />
          </button>

          <button onClick={handleConnect} className="p-1.5 rounded-lg border border-red-500/20 bg-red-950/20 text-red-400 hover:bg-red-900/30 hover:border-red-400 transition-all shrink-0">
            <Power size={12} />
          </button>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════
          MAIN BODY LAYOUT
          ══════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* ══════════════════════════════════════════════════════════
            LEFT COLUMN — Chat, Suggested Actions & Weather
            ══════════════════════════════════════════════════════════ */}
        <aside className="flex flex-col border-r border-cyan-500/15 backdrop-blur-md bg-black/40 z-10 p-3 gap-3 overflow-y-auto scrollbar-none shrink-0"
          style={{ width: leftPaneWidth, minWidth: 220, maxWidth: 600 }}>
          <HistoryDrawer
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            sessions={sessions}
            activeId={activeSessionId}
            onSelect={handleSelectSession}
            onNew={handleNewChat}
            onDelete={handleDeleteSession}
          />

          {/* Chat Panel */}
          <div className="rounded-xl border border-cyan-500/10 bg-cyan-950/5 p-3 flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between pb-1.5 border-b border-cyan-500/10 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase font-mono">Chat</span>
                <span className="text-[7.5px] px-1.5 py-0.5 rounded-full bg-cyan-950/40 border border-cyan-500/30 text-cyan-400 font-mono">
                  {transcripts.filter(m => m.role !== "SYSTEM").length} messages
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={handleCameraToggle} className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[8px] font-bold tracking-wider transition-all uppercase ${cameraOn ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300' : 'border-cyan-500/30 bg-cyan-950/20 text-cyan-400/85 hover:bg-cyan-950/40'}`}>
                  <Camera size={9} />
                  <span>CAM</span>
                </button>
                <button onClick={handleNewChat} className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-950/20 text-cyan-400 text-[8px] font-bold tracking-wider hover:bg-cyan-950/40 transition-all uppercase">
                  <Plus size={9} />
                  <span>+ NEW</span>
                </button>
              </div>
            </div>

            {/* Chat Transcript List */}
            <div ref={scrollRef} className="overflow-y-auto px-2 py-1.5 flex flex-col gap-1.5 bg-black/20 rounded-xl border border-cyan-500/5 select-text scrollbar-none"
              style={{ minHeight: 100, maxHeight: chatHeight, height: chatHeight }}>
              {transcripts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 opacity-40 py-8">
                  <Mic size={20} className="text-cyan-400" />
                  <span className="text-sm font-mono text-cyan-300">{showGreeting ? greetingText : "System Ready. Speak or type..."}</span>
                </div>
              ) : (
                transcripts.map(m => {
                  const isUser = m.role === "USER";
                  const isSystem = m.role === "SYSTEM";
                  let roleColor = "text-cyan-400";
                  let roleName = "OG";
                  if (isSystem) {
                    roleColor = "text-cyan-300/60";
                    roleName = "SYSTEM";
                  } else if (isUser) {
                    roleColor = "text-purple-400";
                    roleName = "USER";
                  }
                  const timeStamp = m.timestamp || nowTime();
                  return (
                    <div key={m.id} className="font-mono text-xs leading-relaxed text-left">
                      <span className="text-white/40">[{timeStamp}] </span>
                      <span className={`${roleColor} font-bold`}>{roleName} : </span>
                      <span className="text-white/90 whitespace-pre-wrap">{m.text}</span>
                      {m.image && (
                        <div className="rounded-lg overflow-hidden my-1 border border-white/10 max-w-[100px] mt-1">
                          <img src={m.image} alt="uploaded" className="w-full object-cover" />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            
            {/* Vertical resize handle for chat transcript */}
            <div
              className="h-1.5 cursor-row-resize shrink-0 relative group -mx-3"
              style={{ background: "transparent" }}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingChat(true);
                const startY = e.clientY;
                const startH = chatHeight;
                const handleMouseMove = (ev: MouseEvent) => {
                  const newH = Math.max(100, Math.min(600, startH + ev.clientY - startY));
                  setChatHeight(newH);
                };
                const handleMouseUp = () => {
                  setIsResizingChat(false);
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                };
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            >
              <div className="h-0.5 w-full mx-auto rounded-full transition-all duration-200 group-hover:bg-cyan-400/60 group-hover:h-1 bg-cyan-500/20" />
            </div>

            {pendingImage && (
              <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-cyan-950/20 border border-cyan-500/20 shrink-0">
                <img src={pendingImage.preview} alt="preview" className="w-6 h-6 object-cover rounded" />
                <span className="text-[8px] flex-1 truncate text-cyan-300">Attached Image</span>
                <button onClick={() => setPendingImage(null)} className="text-white/40 hover:text-white/80"><X size={10} /></button>
              </div>
            )}

            {/* Chat Input Container */}
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-cyan-500/15 bg-white/[0.02]">
              <button onClick={() => fileInputRef.current?.click()} className="text-white/30 hover:text-cyan-400 p-0.5 transition-all">
                <ImagePlus size={12} />
              </button>
              <textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                placeholder="Type your command..."
                rows={1}
                className="flex-1 resize-none bg-transparent outline-none text-[9.5px] text-white placeholder-white/20 font-sans"
              />
              <button onClick={handleSend} className="text-cyan-400 hover:text-cyan-300 p-0.5">
                <Send size={10} className="transform rotate-[-15deg]" />
              </button>
            </div>

            {/* Waveform under chat input */}
            <div className="flex items-center justify-between px-1 text-[8px] font-mono">
              <span className="text-cyan-400/60">Listening...</span>
              <div className="flex items-center gap-[2px] h-3">
                {Array.from({ length: 14 }).map((_, i) => (
                  <div key={i} className="w-[1.5px] bg-cyan-400" style={{
                    height: isConnected ? `${3 + Math.abs(Math.sin(i * 0.9)) * 8}px` : "2px",
                    animation: isConnected ? `chatwave 0.5s ease-in-out ${i * 0.04}s infinite alternate` : "none",
                  }} />
                ))}
              </div>
            </div>
          </div>

          {/* Suggested Actions Panel */}
          <div className="rounded-xl border border-cyan-500/10 bg-cyan-950/5 p-3 flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between pb-1">
              <span className="text-[9px] font-bold tracking-widest text-cyan-300/80 font-mono uppercase">Suggested Actions</span>
              <button className="text-[7.5px] font-bold text-cyan-400 hover:text-cyan-300 border border-cyan-500/20 px-1 py-0.5 rounded leading-none uppercase">Edit</button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[8px] font-mono">
              {[
                { name: "Open Chrome", icon: Globe, action: () => socket?.emit("chat_message", { text: "open chrome" }) },
                { name: "VS Code", icon: Code, action: () => socket?.emit("chat_message", { text: "open vs code" }) },
                { name: "YouTube", icon: Play, action: () => socket?.emit("chat_message", { text: "open youtube" }) },
                { name: "Files", icon: FolderOpen, action: () => socket?.emit("chat_message", { text: "open files" }) },
                { name: "AI Vision", icon: Eye, action: handleCameraToggle },
                { name: "System Info", icon: Monitor, action: () => socket?.emit("chat_message", { text: "get system info" }) },
              ].map(action => {
                const ActionIcon = action.icon;
                return (
                  <button
                    key={action.name}
                    onClick={action.action}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-cyan-500/10 bg-cyan-950/10 text-left text-cyan-200/80 hover:text-cyan-300 hover:border-cyan-500/25 transition-all cursor-pointer"
                  >
                    <ActionIcon size={10} className="text-cyan-400 shrink-0" />
                    <span className="truncate">{action.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Weather Widget */}
          <div className="rounded-xl border border-cyan-500/10 bg-cyan-950/5 p-3 flex flex-col gap-2 shrink-0 font-mono">
            <div className="flex items-center justify-between text-cyan-300 text-[9px] font-bold tracking-widest">
              <span>BHOPAL, INDIA</span>
              <span className="text-[7.5px] opacity-40">Updated 2 min ago</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[18px] font-black text-white leading-none">35°C</span>
                <span className="text-[8px] text-cyan-400 font-sans font-semibold">Clear Sky</span>
              </div>
              <svg className="w-8 h-8 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                <circle cx="12" cy="4" r="0.5" fill="currentColor" />
                <circle cx="18" cy="6" r="0.5" fill="currentColor" />
              </svg>
            </div>
            <div className="grid grid-cols-3 gap-1 border-t border-cyan-500/5 pt-2 text-[7.5px] text-cyan-400/60 text-center">
              <div>
                <div className="opacity-50">Humidity</div>
                <div className="text-cyan-300 font-bold mt-0.5">48%</div>
              </div>
              <div>
                <div className="opacity-50">AQI</div>
                <div className="text-cyan-300 font-bold mt-0.5">82</div>
              </div>
              <div>
                <div className="opacity-50">Wind</div>
                <div className="text-cyan-300 font-bold mt-0.5">12 km/h</div>
              </div>
            </div>
          </div>
        </aside>
        
        {/* Left Resize Handle */}
        <div
          className="w-1.5 cursor-col-resize shrink-0 z-20 relative group"
          style={{ background: "transparent" }}
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizing('left');
            const startX = e.clientX;
            const startW = leftPaneWidth;
            const handleMouseMove = (ev: MouseEvent) => {
              const newW = Math.max(220, Math.min(600, startW + ev.clientX - startX));
              setLeftPaneWidth(newW);
            };
            const handleMouseUp = () => {
              setIsResizing(null);
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            };
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
        >
          <div className="w-0.5 h-full mx-auto rounded-full transition-all duration-200 group-hover:bg-cyan-400/60 group-hover:w-1 bg-cyan-500/20" />
        </div>

        {/* ══════════════════════════════════════════════════════════
            CENTER COLUMN — Interactive Robot Screen & Bottom Grid
            ══════════════════════════════════════════════════════════ */}
        <main className="flex-1 flex flex-col p-3 overflow-y-auto scrollbar-none bg-black/20 gap-3">
          
          {/* Avatar Target Screen */}
          <div className="relative h-[250px] md:h-[280px] shrink-0 flex items-center justify-center overflow-hidden rounded-xl border border-cyan-500/15 bg-black/40 shadow-[0_0_20px_rgba(0,212,255,0.05)]">
            {/* Concentric circles target */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-[200px] h-[200px] rounded-full border border-cyan-500/5 flex items-center justify-center">
                <div className="w-[160px] h-[160px] rounded-full border border-cyan-500/10 flex items-center justify-center border-dashed animate-spin" style={{ animationDuration: "12s" }}>
                  <div className="w-[130px] h-[130px] rounded-full border border-cyan-500/20" />
                </div>
              </div>
            </div>
            
            <div className="absolute inset-0 flex items-center justify-center z-10">
              {activeNavTab === "vision" && cameraOn ? (
                <div className="w-[240px] h-[180px] rounded-lg overflow-hidden border border-cyan-500/30 relative">
                  <video ref={centerVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: visionMode === "camera" ? "scaleX(-1)" : "none" }} />
                  <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-black/70 rounded px-1.5 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[7.5px] font-bold text-white uppercase">{visionMode === "camera" ? "Camera Feed" : "Screen Feed"}</span>
                  </div>
                </div>
              ) : (
                <div className="scale-90">
                  <EmoFace
                    isConnected={isConnected}
                    isSpeaking={isSpeaking}
                    emotion={avatarEmotion}
                  />
                </div>
              )}
            </div>
            
            {/* Target information label overlay */}
            <div className="absolute bottom-2 flex items-center gap-2 z-10 text-[9px] font-mono font-bold tracking-widest text-cyan-300 uppercase">
              <div className="flex gap-[1.5px] items-center">
                {[6, 12, 8, 4].map((h, i) => (
                  <div key={i} className="w-[1.5px] bg-cyan-400" style={{ height: `${h}px` }} />
                ))}
              </div>
              <span>{isConnected ? isSpeaking || avatarState === "PROCESSING" ? "OG IS THINKING" : "OG IS LISTENING" : "OG STANDBY"}</span>
              <div className="flex gap-[1.5px] items-center">
                {[4, 8, 12, 6].map((h, i) => (
                  <div key={i} className="w-[1.5px] bg-cyan-400" style={{ height: `${h}px` }} />
                ))}
              </div>
            </div>
          </div>

          {/* Pipeline Status Indicator */}
          <div className="flex items-center justify-around gap-2 w-full bg-cyan-950/5 border border-cyan-500/10 py-2 px-3 rounded-xl font-mono text-[8px] shrink-0">
            {[
              { label: "Listening", active: avatarState === "LISTENING" || avatarState === "THINKING" || avatarState === "PROCESSING" || isExecuting || isCompleted || isSpeaking, completed: avatarState === "THINKING" || avatarState === "PROCESSING" || isExecuting || isCompleted, icon: Mic },
              { label: "Analyzing", active: avatarState === "THINKING" || avatarState === "PROCESSING" || isExecuting || isCompleted, completed: avatarState === "PROCESSING" || isExecuting || isCompleted, icon: Brain },
              { label: "Processing", active: avatarState === "PROCESSING" || isExecuting || isCompleted, completed: isExecuting || isCompleted, icon: Cpu },
              { label: "Executing", active: isExecuting || isCompleted, completed: isCompleted, icon: Terminal },
              { label: "Completed", active: isCompleted, completed: isCompleted, icon: CheckCircle },
            ].map((step, idx) => {
              const StepIcon = step.icon;
              const isCurrent = step.active && !step.completed;
              return (
                <div key={idx} className="flex items-center gap-1">
                  <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center border transition-all ${
                    step.completed 
                      ? "bg-cyan-500/20 border-cyan-500 text-cyan-400" 
                      : isCurrent
                        ? "bg-purple-500/20 border-purple-500 text-purple-400 animate-pulse"
                        : "bg-white/5 border-white/10 text-white/30"
                  }`}>
                    {step.completed ? <Check size={7} /> : <StepIcon size={7} />}
                  </div>
                  <span className={`transition-colors duration-300 ${
                    step.completed 
                      ? "text-cyan-400 font-bold" 
                      : isCurrent 
                        ? "text-purple-400 font-bold" 
                        : "text-white/35"
                  }`}>
                    {step.label}
                  </span>
                  {step.completed && <span className="text-cyan-400/80 text-[6.5px]">✓</span>}
                </div>
              );
            })}
          </div>

          {/* Center Bottom Grid Cards */}
          <div className="grid grid-cols-3 gap-3 mt-1 flex-1">
            {/* Card 1: AI Thinking Checklist */}
            <div className="bg-cyan-950/5 border border-cyan-500/10 rounded-xl p-3 flex flex-col gap-2 relative overflow-hidden">
              <div className="flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-cyan-300 uppercase border-b border-cyan-500/5 pb-1.5">
                <Brain size={10} className="text-cyan-400 animate-pulse" />
                <span>AI Thinking</span>
              </div>
              
              <div className="flex flex-col gap-1.5 text-[8px] text-cyan-200/80 font-mono mt-0.5">
                {[
                  { label: "Intent Recognized", completed: avatarState !== "IDLE" && avatarState !== "LISTENING" },
                  { label: "Context Analyzed", completed: avatarState !== "IDLE" && avatarState !== "LISTENING" },
                  { label: "Searching Knowledge", completed: avatarState === "PROCESSING" || isExecuting || isCompleted, active: avatarState === "THINKING" },
                  { label: "Generating Response", completed: isCompleted, active: avatarState === "PROCESSING" || isExecuting },
                  { label: "Finalizing Output", completed: isCompleted, active: isExecuting && isSpeaking },
                ].map(item => (
                  <div key={item.label} className={`flex items-center gap-1.5 ${item.completed ? "text-cyan-400 font-semibold" : item.active ? "text-purple-400 font-semibold animate-pulse" : "text-white/30"}`}>
                    {item.completed ? (
                      <Check size={8} className="shrink-0 text-cyan-400" />
                    ) : item.active ? (
                      <div className="w-1 h-1 rounded-full bg-purple-400 shrink-0 animate-ping" />
                    ) : (
                      <div className="w-1 h-1 rounded-full bg-white/20 shrink-0" />
                    )}
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Card 2: Recent Activity logs */}
            <div className="bg-cyan-950/5 border border-cyan-500/10 rounded-xl p-3 flex flex-col gap-2 justify-between relative overflow-hidden">
              <div className="flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-cyan-300 uppercase border-b border-cyan-500/5 pb-1.5">
                <Activity size={10} className="text-cyan-400" />
                <span>Recent Activity</span>
              </div>
              <div className="flex flex-col gap-1.5 text-[7.5px] font-mono text-cyan-200/80">
                {[
                  { name: "Opened Google Chrome", time: "10:44 PM" },
                  { name: "Searched: AI Assistant", time: "10:43 PM" },
                  { name: "Opened VS Code", time: "10:40 PM" },
                  { name: "System Diagnostics", time: "10:38 PM" },
                  { name: "Voice Command Received", time: "10:37 PM" },
                ].map((t, idx) => (
                  <div key={idx} className="flex items-center justify-between border-b border-cyan-500/5 pb-0.5 last:border-b-0">
                    <span className="truncate max-w-[90px]">{t.name}</span>
                    <span className="text-cyan-400/60 font-bold shrink-0">{t.time}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setSysPanel(true)} className="w-full text-center text-[7px] text-cyan-400 hover:text-cyan-300 font-bold uppercase tracking-wider pt-1 border-t border-cyan-500/5 mt-0.5">
                View All
              </button>
            </div>

            {/* Card 3: Quick Commands buttons */}
            <div className="bg-cyan-950/5 border border-cyan-500/10 rounded-xl p-3 flex flex-col gap-2 relative overflow-hidden">
              <div className="flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-cyan-300 uppercase border-b border-cyan-500/5 pb-1.5">
                <Terminal size={10} className="text-cyan-400" />
                <span>Quick Commands</span>
              </div>
              <div className="flex flex-col gap-1 text-[8px] font-mono text-cyan-200/80">
                {[
                  { name: "Open Instagram", action: () => socket?.emit("chat_message", { text: "open instagram" }) },
                  { name: "Take Screenshot", action: () => socket?.emit("chat_message", { text: "take screenshot" }) },
                  { name: "Open Downloads", action: () => socket?.emit("chat_message", { text: "open downloads" }) },
                  { name: "Play Music", action: () => socket?.emit("chat_message", { text: "play music" }) },
                  { name: "System Cleanup", action: triggerSelfHealing },
                ].map((cmd, idx) => (
                  <button
                    key={idx}
                    onClick={cmd.action}
                    className="flex items-center justify-between w-full px-1.5 py-1 rounded border border-cyan-500/10 bg-cyan-950/10 text-left text-cyan-200/70 hover:text-cyan-300 hover:border-cyan-500/30 transition-all font-mono cursor-pointer"
                  >
                    <span className="truncate">{cmd.name}</span>
                    <ChevronRight size={8} className="text-cyan-500" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </main>

        {/* ══════════════════════════════════════════════════════════
            RIGHT COLUMN — System Monitor, Sparklines & Radar Scanner
            ══════════════════════════════════════════════════════════ */}
        <aside className="w-[320px] min-w-[320px] max-w-[320px] flex flex-col border-l border-cyan-500/15 backdrop-blur-md bg-black/40 z-10 p-3 gap-3 overflow-y-auto scrollbar-none">
          
          {/* System Monitor circular progress ring meters */}
          <div className="rounded-xl p-3 flex flex-col gap-3 bg-cyan-950/5 border border-cyan-500/15 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Cpu size={10} className="text-cyan-400" />
                <span className="text-[9px] font-bold tracking-widest text-cyan-300 font-mono uppercase">System Monitor</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[7px] uppercase font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-1 py-0.5 rounded leading-none font-mono">Live</span>
                <MoreHorizontal size={10} className="text-cyan-400 cursor-pointer" />
              </div>
            </div>

            {/* Circular rings readout row */}
            <div className="flex justify-around items-center gap-1.5 py-1">
              {[
                { label: "CPU", value: cpuUsage, detail: "2.34 GHz" },
                { label: "RAM", value: ramUsage, detail: "9.8/15.7 GB" },
                { label: "GPU", value: 41, detail: "NVIDIA RTX" },
              ].map(item => {
                const radius = 21;
                const circ = 2 * Math.PI * radius;
                const strokeDashoffset = circ - (item.value / 100) * circ;
                return (
                  <div key={item.label} className="flex flex-col items-center gap-1 font-mono text-center">
                    <div className="relative w-14 h-14 flex items-center justify-center">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle cx="28" cy="28" r={radius} stroke={theme === "dark" ? "rgba(6, 182, 212, 0.08)" : "rgba(14, 116, 144, 0.12)"} strokeWidth="3" fill="transparent" />
                        <circle cx="28" cy="28" r={radius} stroke="var(--jarvis-cyan)" strokeWidth="3" fill="transparent"
                                strokeDasharray={circ} strokeDashoffset={strokeDashoffset}
                                className="transition-all duration-500" />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
                        <span className="text-[9px] font-black text-white">{item.value}%</span>
                        <span className="text-[6px] text-cyan-400/60 uppercase mt-0.5">{item.label}</span>
                      </div>
                    </div>
                    <span className="text-[6.5px] text-white/40">{item.detail}</span>
                  </div>
                );
              })}
            </div>

            {/* Sub readings info */}
            <div className="grid grid-cols-3 gap-2 border-t border-cyan-500/5 pt-2 text-center">
              {[
                { label: "CPU TEMP", value: "56°C" },
                { label: "GPU TEMP", value: "61°C" },
                { label: "FAN SPEED", value: "2100 RPM" },
              ].map(gauge => (
                <div key={gauge.label} className="bg-cyan-950/5 border border-cyan-500/10 rounded-lg p-1.5 flex flex-col items-center justify-center font-mono">
                  <span className="text-[6px] font-bold text-cyan-400/40 uppercase leading-none">{gauge.label}</span>
                  <span className="text-[8.5px] font-black text-cyan-300 leading-none mt-1">{gauge.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* System Performance historical chart panel */}
          <div className="rounded-xl p-3 bg-cyan-950/5 border border-cyan-500/15 flex flex-col gap-2 relative overflow-hidden shrink-0">
            <div className="flex items-center justify-between text-[9px] font-mono text-cyan-300/80">
              <div className="flex items-center gap-1.5">
                <Activity size={10} className="text-cyan-400" />
                <span className="uppercase font-bold tracking-wider">System Performance</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[7px] uppercase font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-1 py-0.5 rounded leading-none font-mono">Live</span>
                <MoreHorizontal size={10} className="text-cyan-400" />
              </div>
            </div>

            <div className="flex flex-col gap-1 font-mono text-[7px]">
              <div className="flex justify-between items-center text-cyan-400/60 pb-0.5">
                <span>CPU / GPU / RAM</span>
                <span>100%</span>
              </div>
              <div className="h-10 w-full relative bg-black/15 rounded border border-cyan-500/5 overflow-hidden">
                <svg className="w-full h-full" viewBox="0 0 200 40" preserveAspectRatio="none">
                  <line x1="0" y1="20" x2="200" y2="20" stroke={theme === "dark" ? "rgba(6, 182, 212, 0.04)" : "rgba(14, 116, 144, 0.1)"} strokeWidth="0.5" strokeDasharray="2 2" />
                  <path d="M0,25 Q20,15 40,28 T80,18 T120,32 T160,12 T200,22" fill="none" stroke={theme === "dark" ? "#10b981" : "#047857"} strokeWidth="0.8" />
                  <path d="M0,18 Q20,28 40,12 T80,32 T120,18 T160,28 T200,12" fill="none" stroke={theme === "dark" ? "#a855f7" : "#7e22ce"} strokeWidth="0.8" />
                  <path d="M0,12 Q20,8 40,18 T80,12 T120,14 T160,10 T200,8" fill="none" stroke="var(--jarvis-cyan)" strokeWidth="1" />
                </svg>
                <span className="absolute bottom-0.5 right-1 text-[5.5px] text-white/20">60 sec</span>
                <span className="absolute top-0.5 left-1 text-[5.5px] text-white/20">0%</span>
              </div>
            </div>
          </div>

          {/* Network monitor panel */}
          <div className="rounded-xl p-3 bg-cyan-950/5 border border-cyan-500/15 flex flex-col gap-2 relative overflow-hidden shrink-0">
            <div className="flex items-center justify-between text-[9px] font-mono text-cyan-300/80">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="uppercase font-bold tracking-wider">Network</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[7px] uppercase font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-1 py-0.5 rounded leading-none font-mono">Live</span>
                <MoreHorizontal size={10} className="text-cyan-400" />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-[7.5px] font-mono">
              <div className="flex flex-col">
                <span className="opacity-50">Download</span>
                <span className="text-emerald-400 font-bold flex items-center gap-0.5">↓ 82.4 Mbps</span>
                <div className="h-5 w-full mt-1">
                  <svg className="w-full h-full text-emerald-400/80" viewBox="0 0 100 20" preserveAspectRatio="none">
                    <path d="M0,15 L20,10 L40,18 L60,8 L80,14 L100,5 L100,20 L0,20 Z" fill="rgba(16,185,129,0.05)" stroke="currentColor" strokeWidth="0.8" />
                  </svg>
                </div>
              </div>
              <div className="flex flex-col">
                <span className="opacity-50">Upload</span>
                <span className="text-purple-400 font-bold flex items-center gap-0.5">↑ 18.7 Mbps</span>
                <div className="h-5 w-full mt-1">
                  <svg className="w-full h-full text-purple-400/80" viewBox="0 0 100 20" preserveAspectRatio="none">
                    <path d="M0,12 L20,18 L40,8 L60,15 L80,10 L100,16 L100,20 L0,20 Z" fill="rgba(168,85,247,0.05)" stroke="currentColor" strokeWidth="0.8" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Neural Uplink widget with Radar Scan HUD */}
          <div className="rounded-xl p-3 flex flex-col gap-2.5 bg-cyan-950/5 border border-cyan-500/15 relative overflow-hidden flex-1 justify-between min-h-[170px]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
                <span className="text-[9px] font-bold tracking-widest text-cyan-300 font-mono uppercase">Neural Uplink</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[7px] uppercase font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-1 py-0.5 rounded leading-none font-mono">Stable</span>
                <MoreHorizontal size={10} className="text-cyan-400" />
              </div>
            </div>

            <div className="flex items-center gap-3 my-1">
              <div className="relative shrink-0" style={{ width: 80, height: 80 }}>
                <svg width="80" height="80" className="absolute inset-0">
                  {[35, 27, 19, 11].map((r, i) => (
                    <circle key={i} cx="40" cy="40" r={r}
                      fill="none"
                      stroke={theme === "dark" ? `rgba(6, 182, 212, ${0.08 + i * 0.05})` : `rgba(14, 116, 144, ${0.15 + i * 0.08})`}
                      strokeWidth={i === 0 ? 1.2 : 0.6}
                      strokeDasharray={i % 2 === 1 ? "3 3" : undefined}
                    />
                  ))}
                  
                  <line x1="40" y1="3" x2="40" y2="77" stroke={theme === "dark" ? "rgba(6, 182, 212, 0.08)" : "rgba(14, 116, 144, 0.15)"} strokeWidth="0.6" />
                  <line x1="3" y1="40" x2="77" y2="40" stroke={theme === "dark" ? "rgba(6, 182, 212, 0.08)" : "rgba(14, 116, 144, 0.15)"} strokeWidth="0.6" />

                  <line x1="40" y1="40" x2="40" y2="4"
                    stroke={theme === "dark" ? "rgba(6, 182, 212, 0.85)" : "var(--jarvis-cyan)"} strokeWidth="1" strokeLinecap="round"
                    style={{ transformOrigin: "40px 40px", animation: "radarSweep 4s linear infinite" }}
                  />
                  <circle cx="40" cy="40" r="2.5" fill={theme === "dark" ? "rgba(6, 182, 212, 0.95)" : "var(--jarvis-cyan)"} />

                  <circle cx="55" cy="25" r="1.5" fill={theme === "dark" ? "rgba(16, 185, 129, 0.85)" : "#047857"} style={{ animation: "blipPulse 2.1s ease-in-out infinite" }} />
                  <circle cx="25" cy="50" r="1" fill={theme === "dark" ? "rgba(6, 182, 212, 0.8)" : "rgba(14, 116, 144, 0.6)"} style={{ animation: "blipPulse 3.3s ease-in-out infinite 0.8s" }} />
                </svg>
              </div>

              <div className="flex-1 flex flex-col gap-1 text-[7.5px] font-mono text-cyan-400/80 leading-none">
                {[
                  { label: "SIGNAL STRENGTH", value: "91%" },
                  { label: "NODE", value: "OG-SYSTEM-1" },
                  { label: "FREQUENCY", value: "2.4 GHz" },
                  { label: "LATENCY", value: "12 ms" },
                  { label: "PACKET LOSS", value: "0%" },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between border-b border-cyan-500/5 pb-0.5">
                    <span className="opacity-50">{row.label}</span>
                    <span className="text-cyan-300 font-bold">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between items-center pt-1 border-t border-cyan-500/5 shrink-0">
              <span className="text-[7.5px] font-bold text-cyan-400 font-mono">SECURITY STATUS</span>
              <span className="text-[7px] font-bold font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 flex items-center gap-0.5">
                <Check size={6} strokeWidth={3} />
                SECURED
              </span>
            </div>
          </div>

        </aside>

      </div>

      {/* ══════════════════════════════════════════════════════════
          FOOTER BAR
          ══════════════════════════════════════════════════════════ */}
      <footer className="h-10 border-t border-cyan-500/10 backdrop-blur-md bg-black/60 flex items-center justify-between px-6 z-20 shrink-0 text-[10px] text-cyan-400/60 font-mono">
        <div className="flex items-center gap-2">
          <Sun size={12} className="text-amber-400 animate-spin" style={{ animationDuration: "15s" }} />
          <span className="text-cyan-300 font-bold">35°C</span>
          <span className="opacity-60">Clear</span>
        </div>

        <div className="text-[9.5px] text-purple-300/80 font-sans tracking-wide italic font-medium">
          "The best way to predict the future is to create it." - OG
        </div>

        <div className="flex items-center gap-4 text-cyan-400/70">
          <Wifi size={12} className="text-cyan-400" />
          <Volume2 size={12} className="text-cyan-400 animate-pulse" />
          <Mic size={12} className="text-cyan-400" />
          <div className="flex items-center gap-1">
            <Battery size={13} className="text-cyan-400" />
            <span className="font-bold text-[9px] text-cyan-300">69%</span>
          </div>
          <button onClick={handleConnect} className="p-1 rounded-full border border-red-500/20 bg-red-950/20 text-red-400 hover:bg-red-900/30 hover:border-red-400 transition-all shrink-0 cursor-pointer">
            <Power size={11} />
          </button>
        </div>
      </footer>

      {/* Custom Keyframes & Styles Overrides */}
      <style>{`
        @keyframes wave          { 0%{transform:scaleY(0.3)} 100%{transform:scaleY(1.0)} }
        @keyframes chatwave      { 0%{transform:scaleY(0.4)} 100%{transform:scaleY(1.0)} }
        @keyframes radarSweep    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes blipPulse     { 0%,100%{opacity:0.2;transform:scale(0.8)} 50%{opacity:1;transform:scale(1.4)} }
        ::-webkit-scrollbar { display:none; }
      `}</style>
    </div>
  );
}

export default OGAssistant;