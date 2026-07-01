import React, { useState, useEffect, useRef, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface SystemControlPanelProps { isOpen: boolean; onClose: () => void; socket: any; }
interface FileItem { name: string; type: "file" | "folder"; size?: number; modified?: string; path: string; }
interface Toast { id: number; icon: string; message: string; }
interface OGSettings { theme: "Cyan"|"Purple"|"Green"|"Orange"; fontSize: "Small"|"Medium"|"Large"; animations: boolean; autoSave: boolean; }
interface WinItem { hwnd: string; title: string; process: string; }
interface AppProcess { pid: string; name: string; cpu: string; mem: string; }

type Tab = "Files"|"Controls"|"Apps"|"YouTube"|"Windows"|"Settings";

// ── Helpers ───────────────────────────────────────────────────────────────────
const SETTINGS_KEY = "og_settings";
function loadSettings(): OGSettings {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)||"null") ?? { theme:"Cyan", fontSize:"Medium", animations:true, autoSave:true }; }
  catch { return { theme:"Cyan", fontSize:"Medium", animations:true, autoSave:true }; }
}
function saveSettings(s: OGSettings) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
function formatSize(b?: number) { if(!b) return "—"; if(b<1024) return `${b}B`; if(b<1048576) return `${(b/1024).toFixed(1)}KB`; return `${(b/1048576).toFixed(1)}MB`; }
function getFileIcon(name: string, type: "file"|"folder"): string {
  if(type==="folder") return "📁";
  const e = name.split(".").pop()?.toLowerCase()??"";
  if(["png","jpg","jpeg","gif","webp","svg"].includes(e)) return "🖼️";
  if(["mp3","wav","flac","ogg","m4a"].includes(e)) return "🎵";
  if(["mp4","mkv","avi","mov","webm"].includes(e)) return "🎬";
  if(["pdf","doc","docx","txt","md","xlsx","csv"].includes(e)) return "📄";
  if(["js","ts","jsx","tsx","py","java","cpp","html","css","json"].includes(e)) return "💻";
  return "📦";
}
const ACCENT: Record<OGSettings["theme"],string> = { Cyan:"rgba(0,200,255,", Purple:"rgba(180,0,255,", Green:"rgba(0,255,120,", Orange:"rgba(255,140,0," };

// ── Toast Hook ────────────────────────────────────────────────────────────────
function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ctr = useRef(0);
  const addToast = useCallback((icon:string, message:string) => {
    const id = ++ctr.current;
    setToasts(p=>[...p,{id,icon,message}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)), 2800);
  },[]);
  return { toasts, addToast };
}

// ── Popular Apps list ──────────────────────────────────────────────────────────
const POPULAR_APPS = [
  { name:"Chrome",     icon:"🌐", cmd:"chrome" },
  { name:"VS Code",    icon:"💻", cmd:"code" },
  { name:"Notepad",    icon:"📝", cmd:"notepad" },
  { name:"Calculator", icon:"🧮", cmd:"calc" },
  { name:"Explorer",   icon:"📁", cmd:"explorer" },
  { name:"Spotify",    icon:"🎵", cmd:"Spotify" },
  { name:"Discord",    icon:"💬", cmd:"Discord" },
  { name:"Telegram",   icon:"✈️", cmd:"Telegram" },
  { name:"WhatsApp",   icon:"📱", cmd:"WhatsApp" },
  { name:"Obs",        icon:"🔴", cmd:"obs64" },
  { name:"Photoshop",  icon:"🎨", cmd:"Photoshop" },
  { name:"Task Mgr",   icon:"📊", cmd:"taskmgr" },
  { name:"Paint",      icon:"🖌️", cmd:"mspaint" },
  { name:"Settings",   icon:"⚙️", cmd:"ms-settings:" },
  { name:"Terminal",   icon:"⬛", cmd:"wt" },
  { name:"VLC",        icon:"🎬", cmd:"vlc" },
];

// ── YouTube shortcuts ─────────────────────────────────────────────────────────
const YT_CONTROLS = [
  { icon:"⏮",  label:"Prev",      action:"prev_video" },
  { icon:"⏪",  label:"-10s",     action:"rewind_10" },
  { icon:"⏯",  label:"Play/Pause",action:"play_pause" },
  { icon:"⏩",  label:"+10s",     action:"forward_10" },
  { icon:"⏭",  label:"Next",      action:"next_video" },
  { icon:"🔇",  label:"Mute",     action:"mute" },
  { icon:"🔊",  label:"Vol+",     action:"volume_up" },
  { icon:"🔉",  label:"Vol-",     action:"volume_down" },
  { icon:"⛶",  label:"Fullscreen",action:"fullscreen" },
  { icon:"📺",  label:"Theatre",  action:"theatre_mode" },
  { icon:"⏩⏩",label:"Speed+",  action:"speed_up" },
  { icon:"⏪⏪",label:"Speed-",  action:"speed_down" },
];

interface ContextMenuState { x:number; y:number; item:FileItem; }

// ── Main Component ────────────────────────────────────────────────────────────
const SystemControlPanel: React.FC<SystemControlPanelProps> = ({ isOpen, onClose, socket }) => {
  const [activeTab, setActiveTab] = useState<Tab>("Files");
  const { toasts, addToast } = useToasts();

  // Files state
  const [currentPath, setCurrentPath] = useState("C:\\Users\\varun\\Desktop");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<{items:FileItem[];op:"copy"|"cut"}|null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState|null>(null);
  const [renameTarget, setRenameTarget] = useState<FileItem|null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Controls state
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);
  const [brightness, setBrightness] = useState(80);
  const [nightMode, setNightMode] = useState(false);

  // Apps state
  const [appInput, setAppInput] = useState("");
  const [appProcesses, setAppProcesses] = useState<AppProcess[]>([]);
  const [appLoading, setAppLoading] = useState(false);
  const [appFilter, setAppFilter] = useState("");

  // YouTube state
  const [ytQuery, setYtQuery] = useState("");
  const [ytSearching, setYtSearching] = useState(false);

  // Windows state
  const [windows, setWindows] = useState<WinItem[]>([]);
  const [winLoading, setWinLoading] = useState(false);

  // Touch/Remote state
  const touchRef = useRef<HTMLDivElement>(null);
  const [touchMode, setTouchMode] = useState<"move"|"click"|"scroll">("move");
  const lastTouch = useRef<{x:number;y:number}|null>(null);
  const [touchActive, setTouchActive] = useState(false);

  // Settings state
  const [settings, setSettings] = useState<OGSettings>(loadSettings);
  const [clearConfirm, setClearConfirm] = useState(false);

  const accentBase = ACCENT[settings.theme];
  const accent = (a:number) => `${accentBase}${a})`;
  const accentSolid = accent(1);

  // ── Socket listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onFs = (r:any) => {
      if (r.error) { addToast("❌", r.error); return; }
      if (r.action==="list") setFiles(r.items??[]);
      else if (r.action==="create_folder") { addToast("📁","Folder created!"); fsAction("list",{path:currentPath}); }
      else if (r.action==="delete") { addToast("🗑️","Deleted!"); setSelected(new Set()); fsAction("list",{path:currentPath}); }
      else if (r.action==="copy") addToast("📋","Copied!");
      else if (r.action==="cut") addToast("✂️","Cut!");
      else if (r.action==="paste") { addToast("📌","Pasted!"); fsAction("list",{path:currentPath}); }
      else if (r.action==="rename") { addToast("✏️","Renamed!"); setRenameTarget(null); fsAction("list",{path:currentPath}); }
      else if (r.action==="open") addToast("📂","Opened!");
    };
    const onSys = (r:any) => {
      if (r.type==="processes") { setAppProcesses(r.list??[]); setAppLoading(false); }
      else if (r.type==="windows") { setWindows(r.list??[]); setWinLoading(false); }
      else if (r.type==="app_open") { addToast("🚀", r.success ? `Launched ${r.app}` : `Failed: ${r.error}`); }
      else if (r.type==="app_close") { addToast("❌", r.success ? `Closed ${r.app}` : `Not found: ${r.app}`); refreshProcesses(); }
      else if (r.type==="win_focus") addToast("🪟", r.success ? "Window focused" : "Failed");
      else if (r.type==="win_close") { addToast("✖️","Window closed"); refreshWindows(); }
      else if (r.type==="yt_search") { addToast("▶️", r.message||"Playing!"); setYtSearching(false); }
      else if (r.type==="yt_control") addToast("🎵", r.action?.replace(/_/g," ")||"Done");
      else if (r.type==="mouse") { /* silent */ }
      else if (r.success!==undefined) addToast(r.success?"✅":"❌", r.value||r.error||r.type||"Done");
    };
    socket.on("fs_result", onFs);
    socket.on("sys_control_result", onSys);
    return () => { socket.off("fs_result",onFs); socket.off("sys_control_result",onSys); };
  }, [socket, currentPath]);

  useEffect(() => { if(isOpen&&socket) fsAction("list",{path:currentPath}); }, [isOpen,currentPath,socket]);
  useEffect(() => { const h=()=>setContextMenu(null); if(contextMenu) window.addEventListener("click",h); return ()=>window.removeEventListener("click",h); }, [contextMenu]);
  useEffect(() => { saveSettings(settings); }, [settings]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const h = (e:KeyboardEvent) => {
      if (e.key==="Escape") setContextMenu(null);
      if ((e.ctrlKey||e.metaKey)&&e.key==="c"&&selected.size>0) { handleCopy(); e.preventDefault(); }
      if ((e.ctrlKey||e.metaKey)&&e.key==="x"&&selected.size>0) { handleCut(); e.preventDefault(); }
      if ((e.ctrlKey||e.metaKey)&&e.key==="v"&&clipboard) { handlePaste(); e.preventDefault(); }
      if (e.key==="Delete"&&selected.size>0) handleDelete();
      if (e.key==="F2"&&selected.size===1) { const item=files.find(f=>selected.has(f.path)); if(item) startRename(item); }
      if (e.key==="F5") { fsAction("list",{path:currentPath}); e.preventDefault(); }
    };
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
  }, [isOpen,selected,clipboard,files,currentPath]);

  // ── Action helpers ────────────────────────────────────────────────────────
  const fsAction = useCallback((action:string,payload:any)=>{ if(socket) socket.emit("fs_action",{action,payload}); },[socket]);
  const sysCtrl  = useCallback((type:string,value:any)=>  { if(socket) socket.emit("sys_control",{type,value}); },[socket]);

  const navigate=(p:string)=>{ setCurrentPath(p); setSelected(new Set()); };
  const getBreadcrumbs=()=>{ const parts=currentPath.replace(/\\/g,"/").split("/").filter(Boolean); let b=""; return parts.map((l,i)=>{ b+=(i===0?"":"\\")+l; return {label:l,path:b.replace(/\//g,"\\")}; }); };
  const toggleSelect=(path:string,e:React.MouseEvent)=>{ const n=new Set(selected); if(e.ctrlKey||e.metaKey){ n.has(path)?n.delete(path):n.add(path); } else if(e.shiftKey){ const ps=files.map(f=>f.path); const li=[...selected].pop(); const li2=li?ps.indexOf(li):-1,ci=ps.indexOf(path),[a,b]=li2<ci?[li2,ci]:[ci,li2]; ps.slice(a,b+1).forEach(p=>n.add(p)); } else { n.clear(); n.add(path); } setSelected(n); };
  const handleCopy=()=>{ const items=files.filter(f=>selected.has(f.path)); setClipboard({items,op:"copy"}); fsAction("copy",{paths:items.map(i=>i.path)}); };
  const handleCut= ()=>{ const items=files.filter(f=>selected.has(f.path)); setClipboard({items,op:"cut"});  fsAction("cut", {paths:items.map(i=>i.path)}); };
  const handlePaste=()=>{ if(!clipboard) return; fsAction("paste",{destination:currentPath}); };
  const handleDelete=()=>{ const paths=[...selected]; if(!paths.length) return; fsAction("delete",{paths}); };
  const handleDoubleClick=(item:FileItem)=>{ if(item.type==="folder") navigate(item.path); else fsAction("open",{path:item.path}); };
  const startRename=(item:FileItem)=>{ setRenameTarget(item); setRenameValue(item.name); setContextMenu(null); };
  const submitRename=()=>{ if(!renameTarget||!renameValue.trim()){setRenameTarget(null);return;} fsAction("rename",{path:renameTarget.path,newName:renameValue.trim()}); };
  const createFolder=()=>{ if(!newFolderName.trim()){setNewFolderMode(false);return;} fsAction("create_folder",{path:currentPath,name:newFolderName.trim()}); setNewFolderMode(false); setNewFolderName(""); };

  // ── App helpers ───────────────────────────────────────────────────────────
  const refreshProcesses=()=>{ setAppLoading(true); sysCtrl("list_processes",{}); };
  const openApp=(name:string)=>{ sysCtrl("open_app",{name}); addToast("🚀",`Opening ${name}…`); };
  const closeApp=(name:string)=>{ sysCtrl("close_app",{name}); };

  // ── Windows helpers ───────────────────────────────────────────────────────
  const refreshWindows=()=>{ setWinLoading(true); sysCtrl("list_windows",{}); };
  useEffect(()=>{ if(activeTab==="Windows"&&isOpen) refreshWindows(); },[activeTab,isOpen]);
  useEffect(()=>{ if(activeTab==="Apps"&&isOpen) refreshProcesses(); },[activeTab,isOpen]);

  // ── YouTube helpers ───────────────────────────────────────────────────────
  const ytSearch=()=>{ if(!ytQuery.trim()) return; setYtSearching(true); sysCtrl("yt_search",{query:ytQuery,autoPlay:true}); };
  const ytControl=(action:string)=>sysCtrl("yt_control",{action});

  // ── Touch/Mouse helpers ───────────────────────────────────────────────────
  const onTouchStart=(e:React.TouchEvent)=>{ e.preventDefault(); const t=e.touches[0]; lastTouch.current={x:t.clientX,y:t.clientY}; setTouchActive(true); if(touchMode==="click") sysCtrl("mouse",{action:"click",button:"left"}); };
  const onTouchMove=(e:React.TouchEvent)=>{ e.preventDefault(); if(!lastTouch.current) return; const t=e.touches[0]; const dx=Math.round((t.clientX-lastTouch.current.x)*2.5); const dy=Math.round((t.clientY-lastTouch.current.y)*2.5); if(touchMode==="move"&&(Math.abs(dx)>1||Math.abs(dy)>1)) sysCtrl("mouse",{action:"move",dx,dy}); else if(touchMode==="scroll"&&(Math.abs(dy)>2)) sysCtrl("mouse",{action:"scroll",dy:-dy}); lastTouch.current={x:t.clientX,y:t.clientY}; };
  const onTouchEnd=()=>{ lastTouch.current=null; setTouchActive(false); };
  const onMouseDown=(e:React.MouseEvent)=>{ if(e.button===0) sysCtrl("mouse",{action:"down",button:"left"}); if(e.button===2) sysCtrl("mouse",{action:"click",button:"right"}); };
  const onMouseUp=()=>sysCtrl("mouse",{action:"up",button:"left"});
  const onMouseMove=(e:React.MouseEvent)=>{ if(e.buttons!==1) return; const dx=Math.round(e.movementX*2.5); const dy=Math.round(e.movementY*2.5); if(touchMode==="scroll") sysCtrl("mouse",{action:"scroll",dy:-dy}); else sysCtrl("mouse",{action:"move",dx,dy}); };
  const onDblClick=()=>sysCtrl("mouse",{action:"dblclick",button:"left"});
  const onRightClick=(e:React.MouseEvent)=>{ e.preventDefault(); sysCtrl("mouse",{action:"click",button:"right"}); };

  // ── Style helpers ─────────────────────────────────────────────────────────
  const card: React.CSSProperties = { background:accent(0.04), border:`1px solid ${accent(0.15)}`, borderRadius:16, padding:"12px 14px" };
  const sectionHdr = (label:string, dot:string) => (
    <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
      <div style={{width:8,height:8,borderRadius:"50%",background:dot,boxShadow:`0 0 6px ${dot}`}}/>
      <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:"rgba(255,255,255,0.45)",textTransform:"uppercase"}}>{label}</span>
    </div>
  );
  const tabBtnStyle = (active:boolean): React.CSSProperties => ({
    flex:1, padding:"6px 0", background:active?accent(0.12):"transparent",
    border:`1px solid ${active?accent(0.35):accent(0.08)}`, borderRadius:8,
    color:active?accentSolid:"rgba(255,255,255,0.4)", fontFamily:"inherit",
    fontSize:11, fontWeight:active?700:400, cursor:"pointer", transition:"all 0.2s",
    whiteSpace:"nowrap",
  });
  const iconBtn = (onClick:()=>void, children:React.ReactNode, title?:string, danger?:boolean): React.ReactNode => (
    <button onClick={onClick} title={title} style={{background:danger?"rgba(255,50,50,0.1)":accent(0.07), border:`1px solid ${danger?"rgba(255,50,50,0.3)":accent(0.18)}`, borderRadius:8, padding:"5px 9px", color:danger?"#ff6060":"rgba(255,255,255,0.75)", cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", gap:4}}>
      {children}
    </button>
  );

  // ── FILES TAB ─────────────────────────────────────────────────────────────
  const renderFiles = () => {
    const crumbs = getBreadcrumbs();
    return (
      <div style={{display:"flex",flexDirection:"column",gap:10,flex:1,minHeight:0}}>
        <div style={{...card,padding:"7px 12px"}}>
          <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap",fontFamily:"monospace",fontSize:11,color:"rgba(255,255,255,0.6)"}}>
            {crumbs.map((c,i)=>(
              <React.Fragment key={c.path}>
                {i>0&&<span style={{color:accent(0.4)}}>›</span>}
                <button onClick={()=>navigate(c.path)} style={{background:"none",border:"none",color:i===crumbs.length-1?accentSolid:"rgba(255,255,255,0.55)",cursor:"pointer",fontFamily:"monospace",fontSize:11,padding:"0 2px",fontWeight:i===crumbs.length-1?700:400}}>{c.label}</button>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {[{i:"📁",l:"New Folder",fn:()=>{setNewFolderMode(true);setNewFolderName("");}},{i:"✏️",l:"Rename",fn:()=>{const it=files.find(f=>selected.has(f.path));if(it)startRename(it);}},{i:"🗑️",l:"Delete",fn:handleDelete},{i:"📋",l:"Copy",fn:handleCopy},{i:"✂️",l:"Cut",fn:handleCut},{i:"📌",l:"Paste",fn:handlePaste,dis:!clipboard},{i:"🔄",l:"Refresh",fn:()=>fsAction("list",{path:currentPath})}].map(b=>(
            <button key={b.l} onClick={b.fn} disabled={!!(b as any).dis} title={b.l} style={{background:accent(0.07),border:`1px solid ${accent(0.18)}`,borderRadius:7,padding:"4px 8px",color:(b as any).dis?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.75)",cursor:(b as any).dis?"not-allowed":"pointer",fontSize:11,display:"flex",alignItems:"center",gap:3}}>
              <span>{b.i}</span><span>{b.l}</span>
            </button>
          ))}
        </div>
        {newFolderMode&&(
          <div style={{display:"flex",gap:6}}>
            <input autoFocus value={newFolderName} onChange={e=>setNewFolderName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")createFolder();if(e.key==="Escape")setNewFolderMode(false);}} placeholder="Folder name…" style={{flex:1,background:accent(0.06),border:`1px solid ${accent(0.3)}`,borderRadius:8,padding:"5px 10px",color:"#fff",fontSize:12,fontFamily:"monospace",outline:"none"}}/>
            <button onClick={createFolder} style={{background:accent(0.2),border:`1px solid ${accent(0.4)}`,borderRadius:8,padding:"5px 12px",color:accentSolid,cursor:"pointer",fontSize:11}}>Create</button>
            <button onClick={()=>setNewFolderMode(false)} style={{background:"rgba(255,0,0,0.1)",border:"1px solid rgba(255,0,0,0.3)",borderRadius:8,padding:"5px 10px",color:"#ff6060",cursor:"pointer",fontSize:11}}>✕</button>
          </div>
        )}
      </div>
    );
  };

  const renderFileList = () => (
    <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);addToast("📦","Dropped!");}}
      style={{flex:1,overflowY:"auto",border:`1px solid ${dragOver?accent(0.5):accent(0.12)}`,borderRadius:12,background:dragOver?accent(0.05):"rgba(0,0,0,0.2)",transition:"all 0.2s"}}>
      <div style={{display:"grid",gridTemplateColumns:"24px 24px 1fr 70px 90px",gap:6,padding:"5px 10px",borderBottom:`1px solid ${accent(0.1)}`,position:"sticky",top:0,background:"rgba(4,8,20,0.98)",zIndex:2}}>
        {["","","Name","Size","Modified"].map((h,i)=><span key={i} style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.3)",letterSpacing:"0.08em",textTransform:"uppercase"}}>{h}</span>)}
      </div>
      {files.length===0&&<div style={{padding:20,textAlign:"center",color:"rgba(255,255,255,0.25)",fontSize:12}}>Empty folder</div>}
      {files.map(item=>{
        const isSel=selected.has(item.path); const isRen=renameTarget?.path===item.path;
        return (
          <div key={item.path} onClick={e=>toggleSelect(item.path,e)} onDoubleClick={()=>handleDoubleClick(item)} onContextMenu={e=>{e.preventDefault();e.stopPropagation();setContextMenu({x:e.clientX,y:e.clientY,item});}}
            style={{display:"grid",gridTemplateColumns:"24px 24px 1fr 70px 90px",gap:6,padding:"4px 10px",alignItems:"center",background:isSel?accent(0.12):"transparent",borderLeft:isSel?`2px solid ${accentSolid}`:"2px solid transparent",cursor:"pointer",userSelect:"none"}}>
            <input type="checkbox" checked={isSel} onChange={()=>{}} onClick={e=>e.stopPropagation()} style={{accentColor:accentSolid,width:12,height:12,cursor:"pointer"}}/>
            <span style={{fontSize:14}}>{getFileIcon(item.name,item.type)}</span>
            {isRen
              ? <input autoFocus value={renameValue} onChange={e=>setRenameValue(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")submitRename();if(e.key==="Escape")setRenameTarget(null);}} onBlur={submitRename} onClick={e=>e.stopPropagation()} style={{background:accent(0.1),border:`1px solid ${accent(0.4)}`,borderRadius:5,padding:"2px 6px",color:"#fff",fontSize:11,fontFamily:"monospace",outline:"none",width:"100%"}}/>
              : <span style={{fontSize:11,color:"rgba(255,255,255,0.85)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</span>}
            <span style={{fontSize:10,color:"rgba(255,255,255,0.3)",textAlign:"right",fontFamily:"monospace"}}>{formatSize(item.size)}</span>
            <span style={{fontSize:9,color:"rgba(255,255,255,0.25)",textAlign:"right",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.modified??"—"}</span>
          </div>
        );
      })}
    </div>
  );

  const renderContextMenu = () => {
    if (!contextMenu) return null;
    const items=[
      {l:"Open",i:"📂",fn:()=>{handleDoubleClick(contextMenu.item);setContextMenu(null);}},
      {l:"Copy",i:"📋",fn:()=>{setSelected(new Set([contextMenu.item.path]));handleCopy();setContextMenu(null);}},
      {l:"Cut", i:"✂️",fn:()=>{setSelected(new Set([contextMenu.item.path]));handleCut();setContextMenu(null);}},
      {l:"Paste",i:"📌",fn:()=>{handlePaste();setContextMenu(null);},dis:!clipboard},
      {l:"Rename",i:"✏️",fn:()=>startRename(contextMenu.item)},
      {l:"Delete",i:"🗑️",fn:()=>{setSelected(new Set([contextMenu.item.path]));handleDelete();setContextMenu(null);}},
    ];
    return (
      <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top:contextMenu.y,left:contextMenu.x,zIndex:300,background:"rgba(8,14,30,0.97)",border:`1px solid ${accent(0.25)}`,borderRadius:10,padding:"4px 0",minWidth:150,boxShadow:`0 8px 32px rgba(0,0,0,0.6)`}}>
        {items.map(m=>(
          <button key={m.l} disabled={!!(m as any).dis} onClick={m.fn} style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"6px 14px",background:"none",border:"none",color:(m as any).dis?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.8)",cursor:(m as any).dis?"not-allowed":"pointer",fontSize:12}}>
            <span>{m.i}</span><span>{m.l}</span>
          </button>
        ))}
      </div>
    );
  };

  // ── CONTROLS TAB ─────────────────────────────────────────────────────────
  const renderControls = () => (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={card}>
        {sectionHdr("Volume", accentSolid)}
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={()=>{setMuted(m=>!m);sysCtrl("volume",muted?volume:0);}} style={{background:"none",border:"none",fontSize:20,cursor:"pointer"}}>{muted?"🔇":volume>50?"🔊":volume>0?"🔉":"🔈"}</button>
          <input type="range" min={0} max={100} value={muted?0:volume} onChange={e=>{const v=+e.target.value;setVolume(v);setMuted(v===0);sysCtrl("volume",v);}} style={{flex:1,accentColor:accentSolid}}/>
          <span style={{minWidth:34,fontFamily:"monospace",fontSize:12,color:accentSolid,textAlign:"right"}}>{muted?0:volume}%</span>
        </div>
      </div>
      <div style={card}>
        {sectionHdr("Brightness","#ffd700")}
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>☀️</span>
          <input type="range" min={0} max={100} value={brightness} onChange={e=>{const v=+e.target.value;setBrightness(v);sysCtrl("brightness",v);}} style={{flex:1,accentColor:"#ffd700"}}/>
          <span style={{minWidth:34,fontFamily:"monospace",fontSize:12,color:"#ffd700",textAlign:"right"}}>{brightness}%</span>
        </div>
      </div>
      <div style={card}>
        {sectionHdr("Quick Actions","#ff6b9d")}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
          {[{i:"📷",l:"Screenshot",a:"screenshot"},{i:"🔒",l:"Lock",a:"lock_screen"},{i:"💤",l:"Sleep",a:"sleep"},{i:"🔄",l:"Restart",a:"restart"},{i:"📋",l:"Clipboard",a:"clipboard_read"},{i:"📊",l:"Task Mgr",a:"task_manager"},{i:"🖥️",l:"Desktop",a:"show_desktop"},{i:"🌙",l:"Night",a:"night_mode"}].map(a=>(
            <button key={a.a} onClick={()=>{sysCtrl("action",a.a);addToast(a.i,`${a.l} triggered`);}} style={{background:a.a==="night_mode"&&nightMode?accent(0.2):accent(0.07),border:`1px solid ${a.a==="night_mode"&&nightMode?accent(0.5):accent(0.15)}`,borderRadius:10,padding:"8px 4px 6px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
              <span style={{fontSize:20}}>{a.i}</span>
              <span style={{fontSize:9,color:"rgba(255,255,255,0.5)",textAlign:"center"}}>{a.l}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── APPS TAB ──────────────────────────────────────────────────────────────
  const renderApps = () => (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={card}>
        {sectionHdr("Launch App", accentSolid)}
        <div style={{display:"flex",gap:7,marginBottom:10}}>
          <input value={appInput} onChange={e=>setAppInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&appInput.trim()){openApp(appInput.trim());setAppInput("");}}} placeholder="App name… (e.g. chrome, notepad)" style={{flex:1,background:accent(0.06),border:`1px solid ${accent(0.25)}`,borderRadius:9,padding:"7px 12px",color:"#fff",fontSize:12,outline:"none",fontFamily:"monospace"}}/>
          <button onClick={()=>{if(appInput.trim()){openApp(appInput.trim());setAppInput("");}}} style={{background:accent(0.2),border:`1px solid ${accent(0.4)}`,borderRadius:9,padding:"7px 14px",color:accentSolid,cursor:"pointer",fontWeight:700,fontSize:12}}>▶</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
          {POPULAR_APPS.map(a=>(
            <button key={a.name} onClick={()=>openApp(a.cmd)} title={`Launch ${a.name}`} style={{background:accent(0.06),border:`1px solid ${accent(0.12)}`,borderRadius:10,padding:"8px 4px 6px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,transition:"all 0.15s"}} onMouseEnter={e=>(e.currentTarget.style.background=accent(0.16))} onMouseLeave={e=>(e.currentTarget.style.background=accent(0.06))}>
              <span style={{fontSize:18}}>{a.icon}</span>
              <span style={{fontSize:9,color:"rgba(255,255,255,0.6)",textAlign:"center",lineHeight:1.2}}>{a.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={card}>
        {sectionHdr("Running Processes","#ff6b9d")}
        <div style={{display:"flex",gap:7,marginBottom:8}}>
          <input value={appFilter} onChange={e=>setAppFilter(e.target.value)} placeholder="Filter processes…" style={{flex:1,background:accent(0.06),border:`1px solid ${accent(0.2)}`,borderRadius:8,padding:"5px 10px",color:"#fff",fontSize:11,outline:"none",fontFamily:"monospace"}}/>
          <button onClick={refreshProcesses} style={{background:accent(0.1),border:`1px solid ${accent(0.25)}`,borderRadius:8,padding:"5px 10px",color:accentSolid,cursor:"pointer",fontSize:11}}>🔄</button>
        </div>
        <div style={{maxHeight:200,overflowY:"auto"}}>
          {appLoading?<div style={{textAlign:"center",padding:16,color:"rgba(255,255,255,0.3)",fontSize:12}}>Loading…</div>:
          appProcesses.filter(p=>!appFilter||p.name.toLowerCase().includes(appFilter.toLowerCase())).slice(0,40).map(p=>(
            <div key={p.pid} style={{display:"grid",gridTemplateColumns:"1fr 50px 60px 32px",gap:6,padding:"4px 6px",borderBottom:`1px solid ${accent(0.07)}`,alignItems:"center"}}>
              <span style={{fontSize:11,color:"rgba(255,255,255,0.8)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:"monospace"}}>{p.name}</span>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.4)",textAlign:"right",fontFamily:"monospace"}}>{p.cpu}%</span>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.35)",textAlign:"right",fontFamily:"monospace"}}>{p.mem}MB</span>
              <button onClick={()=>closeApp(p.name)} title={`Kill ${p.name}`} style={{background:"rgba(255,50,50,0.1)",border:"1px solid rgba(255,50,50,0.25)",borderRadius:5,padding:"2px 5px",color:"#ff6060",cursor:"pointer",fontSize:11}}>✕</button>
            </div>
          ))}
          {!appLoading&&appProcesses.length===0&&<div style={{textAlign:"center",padding:12,color:"rgba(255,255,255,0.25)",fontSize:11}}>Click 🔄 to load processes</div>}
        </div>
      </div>
    </div>
  );

  // ── YOUTUBE TAB ───────────────────────────────────────────────────────────
  const renderYouTube = () => (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={card}>
        {sectionHdr("Search & Play","#ff0000")}
        <div style={{display:"flex",gap:7,marginBottom:6}}>
          <input value={ytQuery} onChange={e=>setYtQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")ytSearch();}} placeholder="Song / video name…" style={{flex:1,background:"rgba(255,0,0,0.06)",border:"1px solid rgba(255,0,0,0.2)",borderRadius:9,padding:"8px 12px",color:"#fff",fontSize:12,outline:"none"}}/>
          <button onClick={ytSearch} disabled={ytSearching} style={{background:"rgba(255,0,0,0.25)",border:"1px solid rgba(255,0,0,0.45)",borderRadius:9,padding:"8px 16px",color:"#fff",cursor:ytSearching?"not-allowed":"pointer",fontWeight:700,fontSize:13}}>
            {ytSearching?"⏳":"▶"}
          </button>
        </div>
        <p style={{fontSize:10,color:"rgba(255,255,255,0.3)",margin:0}}>Opens YouTube and auto-plays the first result</p>
      </div>
      <div style={card}>
        {sectionHdr("Playback Controls","#ff6b6b")}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
          {YT_CONTROLS.map(c=>(
            <button key={c.action} onClick={()=>{ytControl(c.action);addToast("🎵",c.label);}} title={c.label} style={{background:"rgba(255,50,50,0.08)",border:"1px solid rgba(255,50,50,0.2)",borderRadius:10,padding:"8px 4px 6px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,transition:"all 0.15s"}} onMouseEnter={e=>(e.currentTarget.style.background="rgba(255,50,50,0.2)")} onMouseLeave={e=>(e.currentTarget.style.background="rgba(255,50,50,0.08)")}>
              <span style={{fontSize:18}}>{c.icon}</span>
              <span style={{fontSize:9,color:"rgba(255,255,255,0.55)",textAlign:"center",lineHeight:1.2}}>{c.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={card}>
        {sectionHdr("Seek to %","#ffaa00")}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
          {[0,10,20,30,40,50,60,70,80,90].map(p=>(
            <button key={p} onClick={()=>{ytControl(`seek_${p}`);addToast("⏩",`Seeked to ${p}%`);}} style={{background:"rgba(255,170,0,0.08)",border:"1px solid rgba(255,170,0,0.18)",borderRadius:8,padding:"6px 0",cursor:"pointer",color:"rgba(255,170,0,0.9)",fontFamily:"monospace",fontSize:12,fontWeight:700}}>{p}%</button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── WINDOWS TAB ───────────────────────────────────────────────────────────
  const renderWindows = () => (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={card}>
        {sectionHdr("Open Windows","#a0f0ff")}
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
          <button onClick={refreshWindows} style={{background:accent(0.1),border:`1px solid ${accent(0.25)}`,borderRadius:8,padding:"5px 12px",color:accentSolid,cursor:"pointer",fontSize:11}}>🔄 Refresh</button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:220,overflowY:"auto"}}>
          {winLoading&&<div style={{textAlign:"center",padding:16,color:"rgba(255,255,255,0.3)",fontSize:12}}>Loading windows…</div>}
          {!winLoading&&windows.length===0&&<div style={{textAlign:"center",padding:16,color:"rgba(255,255,255,0.25)",fontSize:11}}>No windows found. Click Refresh.</div>}
          {windows.map((w,i)=>(
            <div key={w.hwnd||i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",background:accent(0.04),border:`1px solid ${accent(0.1)}`,borderRadius:9}}>
              <span style={{fontSize:14}}>🪟</span>
              <div style={{flex:1,minWidth:0}}>
                <p style={{margin:0,fontSize:11,color:"rgba(255,255,255,0.85)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{w.title||"(Untitled)"}</p>
                <p style={{margin:0,fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:"monospace"}}>{w.process}</p>
              </div>
              <button onClick={()=>{sysCtrl("win_focus",{hwnd:w.hwnd});addToast("🪟","Focused");}} title="Focus" style={{background:accent(0.1),border:`1px solid ${accent(0.25)}`,borderRadius:6,padding:"3px 8px",color:accentSolid,cursor:"pointer",fontSize:11}}>Focus</button>
              <button onClick={()=>{sysCtrl("win_close",{hwnd:w.hwnd});}} title="Close" style={{background:"rgba(255,50,50,0.1)",border:"1px solid rgba(255,50,50,0.25)",borderRadius:6,padding:"3px 7px",color:"#ff6060",cursor:"pointer",fontSize:11}}>✕</button>
            </div>
          ))}
        </div>
      </div>
      {/* Touch / Remote Control pad */}
      <div style={card}>
        {sectionHdr("Remote Touch Pad","#00ffcc")}
        <div style={{display:"flex",gap:6,marginBottom:8}}>
          {(["move","click","scroll"] as const).map(m=>(
            <button key={m} onClick={()=>setTouchMode(m)} style={{flex:1,padding:"5px 0",background:touchMode===m?"rgba(0,255,200,0.18)":accent(0.06),border:`1px solid ${touchMode===m?"rgba(0,255,200,0.45)":accent(0.12)}`,borderRadius:8,color:touchMode===m?"rgba(0,255,200,1)":"rgba(255,255,255,0.45)",cursor:"pointer",fontSize:11,fontWeight:touchMode===m?700:400,textTransform:"capitalize"}}>{m}</button>
          ))}
        </div>
        <div
          ref={touchRef}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          onMouseDown={onMouseDown} onMouseUp={onMouseUp} onMouseMove={onMouseMove}
          onDoubleClick={onDblClick} onContextMenu={onRightClick}
          style={{width:"100%",height:160,background:touchActive?"rgba(0,255,200,0.08)":"rgba(0,0,0,0.3)",border:`2px solid ${touchActive?"rgba(0,255,200,0.5)":accent(0.18)}`,borderRadius:12,cursor:touchMode==="move"?"crosshair":touchMode==="scroll"?"ns-resize":"pointer",userSelect:"none",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s",position:"relative",touchAction:"none"}}>
          <div style={{textAlign:"center",pointerEvents:"none"}}>
            <div style={{fontSize:28,marginBottom:4}}>{touchMode==="move"?"🖱️":touchMode==="scroll"?"📜":"👆"}</div>
            <p style={{margin:0,fontSize:11,color:"rgba(255,255,255,0.35)"}}>{touchMode==="move"?"Drag to move cursor":touchMode==="scroll"?"Drag to scroll":"Tap to click"}</p>
            <p style={{margin:"4px 0 0",fontSize:10,color:"rgba(255,255,255,0.2)"}}>Double-tap = double click · Right-tap = right click</p>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginTop:8}}>
          {[{l:"Left Click",fn:()=>sysCtrl("mouse",{action:"click",button:"left"})},{l:"Right Click",fn:()=>sysCtrl("mouse",{action:"click",button:"right"})},{l:"Middle Click",fn:()=>sysCtrl("mouse",{action:"click",button:"middle"})}].map(b=>(
            <button key={b.l} onClick={b.fn} style={{background:accent(0.08),border:`1px solid ${accent(0.2)}`,borderRadius:8,padding:"7px 0",color:"rgba(255,255,255,0.7)",cursor:"pointer",fontSize:11}}>{b.l}</button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── SETTINGS TAB ─────────────────────────────────────────────────────────
  const renderSettings = () => {
    const themes: OGSettings["theme"][] = ["Cyan","Purple","Green","Orange"];
    const themeColors: Record<OGSettings["theme"],string> = {Cyan:"#00c8ff",Purple:"#b400ff",Green:"#00ff78",Orange:"#ff8c00"};
    const fontSizes: OGSettings["fontSize"][] = ["Small","Medium","Large"];
    const toggleStyle = (on:boolean): React.CSSProperties => ({width:40,height:22,borderRadius:11,background:on?accentSolid:"rgba(255,255,255,0.12)",border:`1px solid ${on?accent(0.6):"rgba(255,255,255,0.2)"}`,cursor:"pointer",position:"relative",transition:"background 0.25s",flexShrink:0});
    const thumbStyle = (on:boolean): React.CSSProperties => ({position:"absolute",top:2,left:on?18:2,width:16,height:16,borderRadius:"50%",background:on?"#fff":"rgba(255,255,255,0.5)",transition:"left 0.25s"});
    return (
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={card}>
          {sectionHdr("Theme",accentSolid)}
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {themes.map(t=>(
              <button key={t} onClick={()=>setSettings(s=>({...s,theme:t}))} title={t} style={{width:34,height:34,borderRadius:"50%",background:themeColors[t],border:settings.theme===t?"3px solid #fff":"2px solid rgba(255,255,255,0.2)",cursor:"pointer",boxShadow:settings.theme===t?`0 0 12px ${themeColors[t]}`:"none",position:"relative",transition:"all 0.2s"}}>
                {settings.theme===t&&<span style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#000",fontWeight:900,fontSize:14}}>✓</span>}
              </button>
            ))}
            <span style={{fontSize:12,color:"rgba(255,255,255,0.45)",marginLeft:4}}>{settings.theme}</span>
          </div>
        </div>
        <div style={card}>
          {sectionHdr("Font Size","#ffd700")}
          <div style={{display:"flex",gap:8}}>
            {fontSizes.map(sz=>(
              <button key={sz} onClick={()=>setSettings(s=>({...s,fontSize:sz}))} style={{flex:1,padding:"6px 0",background:settings.fontSize===sz?accent(0.15):accent(0.05),border:`1px solid ${settings.fontSize===sz?accent(0.45):accent(0.12)}`,borderRadius:8,color:settings.fontSize===sz?accentSolid:"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:sz==="Small"?11:sz==="Medium"?13:15,fontWeight:settings.fontSize===sz?700:400}}>{sz}</button>
            ))}
          </div>
        </div>
        <div style={card}>
          {sectionHdr("Preferences","#ff6b9d")}
          {([{label:"Animations",key:"animations" as const,icon:"✨"},{label:"Auto-Save",key:"autoSave" as const,icon:"💾"}]).map(p=>(
            <div key={p.key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:16}}>{p.icon}</span><span style={{fontSize:13,color:"rgba(255,255,255,0.75)"}}>{p.label}</span></div>
              <button onClick={()=>setSettings(s=>({...s,[p.key]:!s[p.key]}))} style={toggleStyle(settings[p.key])}><div style={thumbStyle(settings[p.key])}/></button>
            </div>
          ))}
        </div>
        <div style={card}>
          {sectionHdr("Data","#ff9f40")}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <button onClick={()=>{const b=new Blob([(localStorage.getItem("og_chat_sessions")||localStorage.getItem("natalie_chat_sessions")||"[]")],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="og-chat-export.json";a.click();addToast("📤","Exported!");}} style={{padding:"8px 14px",background:accent(0.08),border:`1px solid ${accent(0.22)}`,borderRadius:9,color:accentSolid,cursor:"pointer",fontSize:12,fontWeight:600}}>📤 Export Chat</button>
            {clearConfirm
              ? <div style={{display:"flex",gap:8}}><span style={{fontSize:11,color:"rgba(255,100,100,0.9)",flex:1,alignSelf:"center"}}>Clear all history?</span><button onClick={()=>{localStorage.removeItem("og_chat_sessions");localStorage.removeItem("natalie_chat_sessions");setClearConfirm(false);addToast("🗑️","Cleared!");}} style={{padding:"5px 12px",background:"rgba(220,30,30,0.25)",border:"1px solid rgba(220,30,30,0.5)",borderRadius:8,color:"#ff6060",cursor:"pointer",fontSize:11,fontWeight:700}}>Yes</button><button onClick={()=>setClearConfirm(false)} style={{padding:"5px 10px",background:accent(0.08),border:`1px solid ${accent(0.2)}`,borderRadius:8,color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:11}}>No</button></div>
              : <button onClick={()=>setClearConfirm(true)} style={{padding:"8px 14px",background:"rgba(220,30,30,0.12)",border:"1px solid rgba(220,30,30,0.3)",borderRadius:9,color:"#ff6060",cursor:"pointer",fontSize:12,fontWeight:600}}>🗑️ Clear Chat History</button>}
          </div>
        </div>
        <div style={{textAlign:"center",padding:"4px 0 8px"}}><span style={{fontSize:10,color:"rgba(255,255,255,0.2)",fontFamily:"monospace"}}>OG Assistant v1.0.0</span></div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: "fixed",
      top: 0,
      right: 0,
      bottom: 0,
      width: 400,
      background: "rgba(8, 6, 22, 0.97)",
      borderLeft: `1px solid ${accent(0.25)}`,
      boxShadow: `-8px 0 40px rgba(0,0,0,0.6)`,
      backdropFilter: "blur(12px)",
      zIndex: 100,
      display: "flex",
      flexDirection: "column",
      color: "#fff",
      fontFamily: "'Inter', sans-serif",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🛠️</span>
          <span style={{ fontWeight: 700, fontSize: 13, color: "rgba(220,180,255,0.95)" }}>System Control Panel</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 14 }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)", overflowX: "auto", scrollbarWidth: "none" }}>
        {(["Files", "Controls", "Apps", "YouTube", "Windows", "Settings"] as Tab[]).map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={tabBtnStyle(activeTab === t)}>{t}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, padding: "14px" }}>
        {activeTab === "Files" && (
          <>
            {renderFiles()}
            {renderFileList()}
          </>
        )}
        {activeTab === "Controls" && renderControls()}
        {activeTab === "Apps" && renderApps()}
        {activeTab === "YouTube" && renderYouTube()}
        {activeTab === "Windows" && renderWindows()}
        {activeTab === "Settings" && renderSettings()}
      </div>

      {/* Context Menu */}
      {renderContextMenu()}

      {/* Toasts */}
      <div style={{ position: "fixed", bottom: 20, right: 420, zIndex: 1000, display: "flex", flexDirection: "column", gap: 8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(10,15,30,0.95)", border: `1px solid ${accent(0.25)}`, borderRadius: 8, padding: "8px 12px", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
            <span>{t.icon}</span>
            <span style={{ fontSize: 11, color: "#fff" }}>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SystemControlPanel;

