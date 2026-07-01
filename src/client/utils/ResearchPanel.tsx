/**
 * ResearchPanel — In-app full-detail search overlay.
 * Slides over the center column when OG performs a search.
 * No tab switching — everything shown right here.
 */
import { useEffect, useRef, useState } from "react";
import {
  X, Search, ExternalLink, BookOpen, Globe, Lightbulb,
  Tag, ChevronDown, ChevronUp, Loader, Clock, TrendingUp,
  FileText, Link2, RefreshCw,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
export type SearchResultItem = {
  title: string;
  snippet: string;
  url: string;
  domain: string;
  favicon?: string;
};

export type ResearchData = {
  query: string;
  timestamp: string;
  overview: string;
  results: SearchResultItem[];
  keyPoints: string[];
  relatedTopics: string[];
  researchType?: string;
  totalSources: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url.slice(0, 30);
  }
}

function getFaviconUrl(url: string): string {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`;
  } catch {
    return "";
  }
}

// Color for domain tag
function domainColor(domain: string): string {
  const hash = domain.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const colors = [
    "rgba(140,60,255,0.25)", "rgba(60,120,255,0.25)",
    "rgba(40,180,160,0.25)", "rgba(180,100,60,0.25)",
    "rgba(60,160,80,0.25)",  "rgba(200,80,120,0.25)",
  ];
  return colors[hash % colors.length];
}

// ── Loading skeleton bar ───────────────────────────────────────────────────────
function SkeletonBar({ w = "100%", h = 10 }: { w?: string; h?: number }) {
  return (
    <div
      className="rounded-full"
      style={{
        width: w, height: h,
        background: "rgba(255,255,255,0.06)",
        animation: "skeletonPulse 1.4s ease-in-out infinite",
      }}
    />
  );
}

// ── Source card ────────────────────────────────────────────────────────────────
function SourceCard({
  item, index, expanded, onToggle,
}: {
  item: SearchResultItem;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const domain = item.domain || getDomain(item.url);
  const favicon = getFaviconUrl(item.url);

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all duration-300"
      style={{
        background: "rgba(255,255,255,0.025)",
        border: `1px solid ${expanded ? "rgba(140,60,255,0.35)" : "rgba(255,255,255,0.07)"}`,
        boxShadow: expanded ? "0 0 20px rgba(140,60,255,0.08)" : "none",
      }}
    >
      {/* Card header */}
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-3 text-left transition-all hover:bg-white/2"
      >
        {/* Index badge */}
        <div
          className="flex-none flex items-center justify-center rounded-lg text-[10px] font-bold mt-0.5"
          style={{
            width: 22, height: 22,
            background: "rgba(140,60,255,0.2)",
            color: "rgba(200,160,255,0.9)",
          }}
        >
          {index + 1}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <p
            className="text-[12px] font-semibold leading-snug line-clamp-2"
            style={{ color: "rgba(220,200,255,0.92)" }}
          >
            {item.title}
          </p>

          {/* Domain row */}
          <div className="flex items-center gap-1.5 mt-1">
            {favicon && (
              <img
                src={favicon}
                alt=""
                className="w-3 h-3 rounded-sm"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-md"
              style={{
                background: domainColor(domain),
                color: "rgba(200,180,255,0.7)",
              }}
            >
              {domain}
            </span>
          </div>
        </div>

        {/* Expand icon */}
        <div className="flex-none mt-1" style={{ color: "rgba(140,60,255,0.6)" }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div
          className="px-3 pb-3 flex flex-col gap-2"
          style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
        >
          {/* Snippet */}
          <p
            className="text-[11px] leading-relaxed pt-2"
            style={{ color: "rgba(200,210,255,0.72)" }}
          >
            {item.snippet}
          </p>

          {/* Open link */}
          {item.url && item.url.startsWith("http") && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 w-fit px-3 py-1.5 rounded-xl text-[10px] font-medium transition-all hover:opacity-80"
              style={{
                background: "rgba(140,60,255,0.15)",
                border: "1px solid rgba(140,60,255,0.3)",
                color: "rgba(200,160,255,0.9)",
              }}
            >
              <ExternalLink size={11} />
              Open Source
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Key point chip ─────────────────────────────────────────────────────────────
function KeyPointChip({ text, index }: { text: string; index: number }) {
  const colors = [
    { bg: "rgba(140,60,255,0.12)", border: "rgba(140,60,255,0.25)", dot: "#a855f7" },
    { bg: "rgba(60,120,255,0.12)", border: "rgba(60,120,255,0.25)", dot: "#6080ff" },
    { bg: "rgba(40,180,160,0.12)", border: "rgba(40,180,160,0.25)", dot: "#28b4a0" },
    { bg: "rgba(220,100,60,0.10)", border: "rgba(220,100,60,0.22)", dot: "#dc643c" },
    { bg: "rgba(60,160,100,0.12)", border: "rgba(60,160,100,0.25)", dot: "#3ca064" },
  ];
  const c = colors[index % colors.length];

  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded-xl"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div
        className="w-1.5 h-1.5 rounded-full flex-none mt-1.5"
        style={{ background: c.dot }}
      />
      <p className="text-[11px] leading-relaxed" style={{ color: "rgba(210,200,255,0.85)" }}>
        {text}
      </p>
    </div>
  );
}

// ── Related topic pill ─────────────────────────────────────────────────────────
function TopicPill({
  text, onClick,
}: {
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-medium transition-all hover:opacity-80"
      style={{
        background: "rgba(140,60,255,0.1)",
        border: "1px solid rgba(140,60,255,0.2)",
        color: "rgba(200,170,255,0.85)",
      }}
    >
      <Tag size={9} />
      {text}
    </button>
  );
}

// ── Tab button ─────────────────────────────────────────────────────────────────
function TabBtn({
  label, active, icon, onClick,
}: {
  label: string; active: boolean; icon: React.ReactNode; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-semibold transition-all"
      style={{
        background: active ? "rgba(140,60,255,0.2)" : "transparent",
        border: active ? "1px solid rgba(140,60,255,0.4)" : "1px solid transparent",
        color: active ? "rgba(220,180,255,0.95)" : "rgba(255,255,255,0.35)",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Main ResearchPanel Component ───────────────────────────────────────────────
type Tab = "overview" | "sources" | "keypoints" | "related";

interface ResearchPanelProps {
  data: ResearchData | null;
  loading: boolean;
  loadingQuery: string;
  visible: boolean;
  onClose: () => void;
  onSearchRelated: (query: string) => void;
}

const ResearchPanel = ({
  data,
  loading,
  loadingQuery,
  visible,
  onClose,
  onSearchRelated,
}: ResearchPanelProps) => {
  const [tab, setTab] = useState<Tab>("overview");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset tab & scroll on new data
  useEffect(() => {
    if (data) {
      setTab("overview");
      setExpandedIdx(0);
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [data]);

  if (!visible) return null;

  return (
    <>
      {/* Backdrop blur */}
      <div
        className="absolute inset-0 z-20"
        style={{ background: "rgba(4,3,12,0.75)", backdropFilter: "blur(8px)" }}
        onClick={onClose}
      />

      {/* Panel itself */}
      <div
        className="absolute inset-4 z-30 flex flex-col rounded-3xl overflow-hidden"
        style={{
          background: "rgba(8,6,22,0.97)",
          border: "1px solid rgba(140,60,255,0.25)",
          boxShadow: "0 0 60px rgba(140,60,255,0.15), 0 0 120px rgba(80,20,160,0.1)",
          animation: "researchSlideIn 0.35s cubic-bezier(0.16,1,0.3,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center gap-3 px-5 py-4 flex-none"
          style={{ borderBottom: "1px solid rgba(140,60,255,0.12)" }}
        >
          {/* Icon */}
          <div
            className="flex items-center justify-center rounded-xl flex-none"
            style={{
              width: 38, height: 38,
              background: "radial-gradient(circle, rgba(140,60,255,0.3) 0%, rgba(80,20,160,0.2) 100%)",
              border: "1px solid rgba(140,60,255,0.3)",
            }}
          >
            {loading
              ? <Loader size={16} style={{ color: "rgba(200,160,255,0.9)", animation: "spin 1s linear infinite" }} />
              : <Search size={16} style={{ color: "rgba(200,160,255,0.9)" }} />
            }
          </div>

          {/* Query + meta */}
          <div className="flex-1 min-w-0">
            <h2
              className="text-[14px] font-bold truncate"
              style={{ color: "rgba(230,210,255,0.95)" }}
            >
              {loading ? loadingQuery : (data?.query || "Search Results")}
            </h2>
            <div className="flex items-center gap-3 mt-0.5">
              {loading ? (
                <span className="text-[10px]" style={{ color: "rgba(140,60,255,0.7)" }}>
                  Searching across the web…
                </span>
              ) : data ? (
                <>
                  <span className="flex items-center gap-1 text-[9px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                    <Globe size={9} />
                    {data.totalSources} sources
                  </span>
                  <span className="flex items-center gap-1 text-[9px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                    <Clock size={9} />
                    {data.timestamp}
                  </span>
                  {data.researchType && (
                    <span
                      className="text-[9px] px-2 py-0.5 rounded-full capitalize"
                      style={{
                        background: "rgba(140,60,255,0.15)",
                        border: "1px solid rgba(140,60,255,0.25)",
                        color: "rgba(200,160,255,0.8)",
                      }}
                    >
                      {data.researchType}
                    </span>
                  )}
                </>
              ) : null}
            </div>
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="flex-none p-2 rounded-xl transition-all hover:bg-white/5"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Tabs ── */}
        {!loading && data && (
          <div
            className="flex items-center gap-1 px-5 py-2 flex-none"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
          >
            <TabBtn label="Overview" active={tab === "overview"} icon={<BookOpen size={10} />} onClick={() => setTab("overview")} />
            <TabBtn label={`Sources (${data.results.length})`} active={tab === "sources"} icon={<Link2 size={10} />} onClick={() => setTab("sources")} />
            <TabBtn label="Key Points" active={tab === "keypoints"} icon={<Lightbulb size={10} />} onClick={() => setTab("keypoints")} />
            <TabBtn label="Related" active={tab === "related"} icon={<TrendingUp size={10} />} onClick={() => setTab("related")} />
          </div>
        )}

        {/* ── Body ── */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-5 py-4"
          style={{ scrollbarWidth: "none" }}
        >
          {/* ── Loading state ── */}
          {loading && (
            <div className="flex flex-col gap-4">
              {/* Animated search indicator */}
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                style={{ background: "rgba(140,60,255,0.08)", border: "1px solid rgba(140,60,255,0.15)" }}>
                <div style={{ animation: "spin 1.2s linear infinite", color: "rgba(180,100,255,0.8)" }}>
                  <RefreshCw size={16} />
                </div>
                <div>
                  <p className="text-[12px] font-semibold" style={{ color: "rgba(220,180,255,0.9)" }}>
                    OG is researching…
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                    Searching multiple sources for "{loadingQuery}"
                  </p>
                </div>
              </div>

              {/* Skeleton cards */}
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl p-4 flex flex-col gap-3"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <SkeletonBar w="70%" h={12} />
                  <SkeletonBar w="40%" h={8} />
                  <SkeletonBar w="100%" h={9} />
                  <SkeletonBar w="90%" h={9} />
                  <SkeletonBar w="75%" h={9} />
                </div>
              ))}
            </div>
          )}

          {/* ── Overview tab ── */}
          {!loading && data && tab === "overview" && (
            <div className="flex flex-col gap-5">
              {/* Overview text */}
              <div className="rounded-2xl p-4"
                style={{ background: "rgba(140,60,255,0.07)", border: "1px solid rgba(140,60,255,0.15)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen size={12} style={{ color: "rgba(180,100,255,0.8)" }} />
                  <span className="text-[10px] font-semibold tracking-widest uppercase"
                    style={{ color: "rgba(180,100,255,0.7)" }}>
                    Summary
                  </span>
                </div>
                <p className="text-[12px] leading-relaxed" style={{ color: "rgba(210,200,255,0.88)" }}>
                  {data.overview || "OG gathered information from multiple sources. See the Sources and Key Points tabs for details."}
                </p>
              </div>

              {/* Top 3 sources preview */}
              {data.results.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold tracking-widest uppercase"
                      style={{ color: "rgba(255,255,255,0.3)" }}>
                      Top Sources
                    </span>
                    <button onClick={() => setTab("sources")}
                      className="text-[9px] transition-all hover:opacity-70"
                      style={{ color: "rgba(140,60,255,0.8)" }}>
                      View all {data.results.length} →
                    </button>
                  </div>
                  {data.results.slice(0, 3).map((r, i) => (
                    <SourceCard
                      key={i} item={r} index={i}
                      expanded={expandedIdx === i}
                      onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
                    />
                  ))}
                </div>
              )}

              {/* Top key points preview */}
              {data.keyPoints.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-semibold tracking-widest uppercase"
                    style={{ color: "rgba(255,255,255,0.3)" }}>
                    Key Points
                  </span>
                  {data.keyPoints.slice(0, 3).map((kp, i) => (
                    <KeyPointChip key={i} text={kp} index={i} />
                  ))}
                  {data.keyPoints.length > 3 && (
                    <button onClick={() => setTab("keypoints")}
                      className="text-[10px] text-left pl-1 transition-all hover:opacity-70"
                      style={{ color: "rgba(140,60,255,0.7)" }}>
                      +{data.keyPoints.length - 3} more points →
                    </button>
                  )}
                </div>
              )}

              {/* Related topics */}
              {data.relatedTopics.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-semibold tracking-widest uppercase"
                    style={{ color: "rgba(255,255,255,0.3)" }}>
                    Explore Related
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {data.relatedTopics.slice(0, 6).map((t, i) => (
                      <TopicPill key={i} text={t} onClick={() => onSearchRelated(t)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Sources tab ── */}
          {!loading && data && tab === "sources" && (
            <div className="flex flex-col gap-3">
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                {data.results.length} sources found — click any card to expand
              </p>
              {data.results.map((r, i) => (
                <SourceCard
                  key={i} item={r} index={i}
                  expanded={expandedIdx === i}
                  onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
                />
              ))}
            </div>
          )}

          {/* ── Key Points tab ── */}
          {!loading && data && tab === "keypoints" && (
            <div className="flex flex-col gap-3">
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                {data.keyPoints.length} key insights extracted
              </p>
              {data.keyPoints.length > 0
                ? data.keyPoints.map((kp, i) => <KeyPointChip key={i} text={kp} index={i} />)
                : (
                  <div className="flex items-center justify-center py-12 opacity-40">
                    <div className="text-center">
                      <Lightbulb size={28} style={{ color: "rgba(140,60,255,0.5)", margin: "0 auto 8px" }} />
                      <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
                        No key points extracted yet
                      </p>
                    </div>
                  </div>
                )
              }
            </div>
          )}

          {/* ── Related tab ── */}
          {!loading && data && tab === "related" && (
            <div className="flex flex-col gap-4">
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                Tap any topic to search it instantly
              </p>
              {data.relatedTopics.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {data.relatedTopics.map((t, i) => (
                    <TopicPill key={i} text={t} onClick={() => onSearchRelated(t)} />
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-12 opacity-40">
                  <div className="text-center">
                    <TrendingUp size={28} style={{ color: "rgba(140,60,255,0.5)", margin: "0 auto 8px" }} />
                    <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
                      No related topics
                    </p>
                  </div>
                </div>
              )}

              {/* Search again box */}
              <div className="rounded-2xl p-4 flex flex-col gap-3 mt-2"
                style={{ background: "rgba(140,60,255,0.06)", border: "1px solid rgba(140,60,255,0.15)" }}>
                <p className="text-[11px] font-semibold" style={{ color: "rgba(200,160,255,0.85)" }}>
                  Search something else
                </p>
                <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Just say it — "OG, search for [topic]"
                </p>
              </div>
            </div>
          )}

          {/* ── Empty state ── */}
          {!loading && !data && (
            <div className="flex flex-col items-center justify-center h-full gap-4 opacity-40">
              <Search size={36} style={{ color: "rgba(140,60,255,0.5)" }} />
              <div className="text-center">
                <p className="text-[13px] font-semibold" style={{ color: "rgba(200,160,255,0.7)" }}>
                  Research Panel Ready
                </p>
                <p className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Say "search for [topic]" to see results here
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer action bar ── */}
        {!loading && data && (
          <div
            className="flex items-center justify-between px-5 py-3 flex-none"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <div className="flex items-center gap-2">
              <FileText size={11} style={{ color: "rgba(140,60,255,0.6)" }} />
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                Ask OG to save a report
              </span>
            </div>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-semibold transition-all hover:opacity-80"
              style={{
                background: "rgba(140,60,255,0.15)",
                border: "1px solid rgba(140,60,255,0.3)",
                color: "rgba(200,160,255,0.9)",
              }}
            >
              <X size={11} />
              Close
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes researchSlideIn {
          from { opacity: 0; transform: scale(0.96) translateY(10px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes skeletonPulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.8; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
};

export default ResearchPanel;
export type { ResearchPanelProps };
