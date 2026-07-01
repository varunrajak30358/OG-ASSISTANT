// ── EmoFace.tsx ──────────────────────────────────────────────────────────────
// EMO robot face component — replaces the canvas-drawn face inside AICore.
// Drop-in overlay: position it absolute over the AICore canvas center.

import { useEffect, useState } from "react";
import type { AvatarEmotion } from "./AvatarStateEngine";

// ── Emotion type (subset matching AvatarEmotion) ──────────────────────────────
type Emotion =
  | "neutral" | "happy" | "excited" | "thinking"
  | "concerned" | "angry" | "sad" | "curious"
  | "surprised" | "confused" | "sleeping";

// ── EMO color map ─────────────────────────────────────────────────────────────
const EMO_COLOR: Record<string, string> = {
  neutral:   "#00d4ff",
  happy:     "#00d4ff",
  excited:   "#ffa500",
  sad:       "#0088cc",
  angry:     "#ff3333",
  thinking:  "#00ccaa",
  concerned: "#ffaa00",
  curious:   "#ffffff",
  surprised: "#00ffcc",
  confused:  "#ffcc44",
  sleeping:  "#334466",
};

// ── Blink hook ────────────────────────────────────────────────────────────────
function useEyeBlink(emotion: Emotion) {
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (emotion === "thinking" || emotion === "sleeping") return;
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timeout = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => { setBlinking(false); schedule(); }, 150);
      }, 2500 + Math.random() * 3500);
    };
    schedule();
    return () => clearTimeout(timeout);
  }, [emotion]);
  return blinking;
}

// ── Eye style per emotion ─────────────────────────────────────────────────────
function getEyeStyle(
  emotion: Emotion,
  color: string,
  blinking: boolean
): React.CSSProperties {
  const base: React.CSSProperties = {
    background: color,
    boxShadow: `0 0 22px ${color}`,
    borderRadius: "50%",
    position: "relative",
    transition: "all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
  };
  if (blinking)               return { ...base, width: 46, height: 46, transform: "scaleY(0.08)" };
  if (emotion === "sleeping") return { ...base, width: 46, height: 8,  borderRadius: "50%", opacity: 0.5 };
  switch (emotion) {
    case "happy":
    case "excited":   return { ...base, width: 46, height: 28, borderRadius: "50% 50% 8% 8%" };
    case "sad":       return { ...base, width: 40, height: 26, borderRadius: "50% 50% 16% 16%" };
    case "thinking":  return { ...base, width: 30, height: 9,  borderRadius: "4px" };
    case "concerned": return { ...base, width: 40, height: 10, borderRadius: "50%", opacity: 0.65 };
    case "angry":     return { ...base, width: 44, height: 26, borderRadius: "6px 6px 50% 50%" };
    case "curious":   return { ...base, width: 46, height: 46, transform: "scale(1.15)" };
    case "surprised": return { ...base, width: 46, height: 46, transform: "scale(1.2)" };
    case "confused":  return { ...base, width: 40, height: 40 };
    default:          return { ...base, width: 46, height: 46 };
  }
}

// ── Mouth style per emotion ───────────────────────────────────────────────────
function getMouthStyle(
  emotion: Emotion,
  color: string,
  isSpeaking: boolean
): React.CSSProperties {
  const base: React.CSSProperties = {
    background: color,
    boxShadow: `0 0 10px ${color}`,
    transition: "all 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
  };
  if (isSpeaking) return {
    ...base, width: 30, height: 14,
    borderRadius: "0 0 14px 14px",
    animation: "emoTalk 0.15s ease-in-out infinite alternate",
  };
  switch (emotion) {
    case "happy":
    case "excited":   return { ...base, width: 38, height: 13, borderRadius: "0 0 16px 16px" };
    case "sad":       return { ...base, width: 30, height: 9,  borderRadius: "16px 16px 0 0", transform: "translateY(4px)" };
    case "angry":     return { ...base, width: 34, height: 5,  borderRadius: "3px", transform: "skewY(-4deg)" };
    case "thinking":  return { ...base, width: 12, height: 4,  borderRadius: "2px", transform: "translateX(8px)" };
    case "curious":   return { ...base, width: 16, height: 16, borderRadius: "50%" };
    case "concerned": return { ...base, width: 24, height: 7,  borderRadius: "8px 8px 0 0", transform: "translateY(3px)" };
    case "sleeping":  return { ...base, width: 28, height: 4,  borderRadius: "2px", opacity: 0.4 };
    case "surprised": return { ...base, width: 20, height: 20, borderRadius: "50%" };
    default:          return { ...base, width: 26, height: 4,  borderRadius: "2px" };
  }
}

// ── Eyebrow overlay ───────────────────────────────────────────────────────────
function BrowOverlay({
  emotion, color, side,
}: {
  emotion: Emotion; color: string; side: "left" | "right";
}) {
  const isLeft = side === "left";
  const browStyle = (transform: string): React.CSSProperties => ({
    position: "absolute", width: 36, height: 5,
    background: color, borderRadius: 3,
    boxShadow: `0 0 8px ${color}`,
    transition: "all 0.3s ease", transform,
  });

  if (emotion === "angry")
    return (
      <div style={{ position: "absolute", top: -8, left: 0, right: 0, height: 8, pointerEvents: "none" }}>
        <div style={{
          ...browStyle(isLeft ? "rotate(-18deg)" : "rotate(18deg)"),
          position: "absolute",
          left: isLeft ? 2 : "auto", right: isLeft ? "auto" : 2, top: 0,
        }} />
      </div>
    );

  if (emotion === "sad" || emotion === "concerned")
    return (
      <div style={{ position: "absolute", top: -8, left: 0, right: 0, height: 8, pointerEvents: "none" }}>
        <div style={{
          ...browStyle(isLeft ? "rotate(14deg)" : "rotate(-14deg)"),
          position: "absolute",
          left: isLeft ? 2 : "auto", right: isLeft ? "auto" : 2, top: 0, opacity: 0.7,
        }} />
      </div>
    );

  if (emotion === "curious" || emotion === "excited" || emotion === "surprised")
    return (
      <div style={{ position: "absolute", top: -10, left: 0, right: 0, height: 10, pointerEvents: "none" }}>
        <div style={{
          ...browStyle(isLeft ? "rotate(-10deg) translateY(-3px)" : "rotate(10deg) translateY(-3px)"),
          position: "absolute",
          left: isLeft ? 2 : "auto", right: isLeft ? "auto" : 2, top: 0, opacity: 0.85,
        }} />
      </div>
    );

  return null;
}

// ── EmoFace Props ─────────────────────────────────────────────────────────────
export interface EmoFaceProps {
  isConnected: boolean;
  isSpeaking:  boolean;
  emotion:     AvatarEmotion;
}

// ── EmoFace — Robot Face Component ───────────────────────────────────────────
const EmoFace = ({ isConnected, isSpeaking, emotion: rawEmotion }: EmoFaceProps) => {
  // Map AvatarEmotion → local Emotion (they overlap; cast safely)
  const emotion = rawEmotion as Emotion;

  const color      = isSpeaking ? "#ff8800" : (EMO_COLOR[emotion] ?? "#00d4ff");
  const blinking   = useEyeBlink(emotion);
  const eyeStyle   = getEyeStyle(emotion, color, blinking);
  const mouthStyle = getMouthStyle(emotion, color, isSpeaking);

  if (!isConnected) return null;

  return (
    <>
      <style>{`
        .emo-hud-frame {
          position: relative;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 24px;
        }
        .emo-hud-ring {
          position: absolute; inset: 0;
          border: 1.5px solid rgba(0,212,255,0.35);
          border-radius: 50%;
          pointer-events: none;
          box-shadow: 0 0 18px rgba(0,212,255,0.08), inset 0 0 18px rgba(0,212,255,0.04);
        }
        /* Corner bracket decorations */
        .emo-hud-corner {
          position: absolute; width: 18px; height: 18px;
          pointer-events: none;
        }
        .emo-hud-corner::before, .emo-hud-corner::after {
          content: ''; position: absolute;
          background: rgba(0,212,255,0.55);
        }
        .emo-hud-corner.tl { top: 8px; left: 8px; }
        .emo-hud-corner.tr { top: 8px; right: 8px; }
        .emo-hud-corner.bl { bottom: 8px; left: 8px; }
        .emo-hud-corner.br { bottom: 8px; right: 8px; }
        .emo-hud-corner.tl::before, .emo-hud-corner.bl::before { left: 0; width: 18px; height: 1.5px; }
        .emo-hud-corner.tr::before, .emo-hud-corner.br::before { right: 0; width: 18px; height: 1.5px; }
        .emo-hud-corner.tl::after,  .emo-hud-corner.tr::after  { top: 0; width: 1.5px; height: 18px; }
        .emo-hud-corner.bl::after,  .emo-hud-corner.br::after  { bottom: 0; width: 1.5px; height: 18px; }
        .emo-hud-corner.tl::before { top: 0; }
        .emo-hud-corner.tr::before { top: 0; }
        .emo-hud-corner.bl::before { bottom: 0; }
        .emo-hud-corner.br::before { bottom: 0; }
        .emo-hud-corner.tl::after { left: 0; }
        .emo-hud-corner.tr::after { right: 0; }
        .emo-hud-corner.bl::after { left: 0; }
        .emo-hud-corner.br::after { right: 0; }
        /* Scanning line */
        .emo-hud-scanline {
          position: absolute; left: 15%; right: 15%;
          height: 1.5px;
          background: linear-gradient(90deg, transparent, rgba(0,212,255,0.35), transparent);
          pointer-events: none;
          animation: emoScan 3.5s ease-in-out infinite;
        }
        @keyframes emoScan {
          0%, 100% { top: 18%; opacity: 0; }
          10%      { opacity: 1; }
          90%      { opacity: 1; }
          50%      { top: 78%; }
        }
        /* Status label */
        .emo-hud-label {
          margin-top: 10px;
          font-family: 'Consolas', 'Courier New', monospace;
          font-size: 9px; letter-spacing: 3px;
          text-transform: uppercase;
          color: rgba(0,212,255,0.7);
          text-shadow: 0 0 6px rgba(0,212,255,0.3);
          pointer-events: none; user-select: none;
        }
        .emo-robot-wrap {
          position: relative; width: 220px; height: 170px;
          display: flex; justify-content: center; align-items: center;
          animation: emoBob 3s ease-in-out infinite;
        }
        @keyframes emoBob {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-6px); }
        }
        .emo-ear {
          position: absolute; width: 36px; height: 76px;
          background: #222; border-radius: 12px;
          top: 50%; transform: translateY(-50%);
          z-index: 0; border: 1px solid #333;
        }
        .emo-ear.left  { left: -18px; }
        .emo-ear.right { right: -18px; }
        .emo-ear::after {
          content: ''; position: absolute;
          width: 18px; height: 18px;
          background: var(--emo-ear-color, #00d4ff); border-radius: 50%;
          left: 9px; top: 28px;
          box-shadow: 0 0 12px var(--emo-ear-color, #00d4ff);
          opacity: 0.85; transition: background 0.4s, box-shadow 0.4s;
        }
        .emo-head {
          width: 190px; height: 140px; background: #1a1a2a;
          border-radius: 38px; position: relative; z-index: 1;
          box-shadow: inset 0 0 16px rgba(0,0,0,0.8), 0 8px 24px rgba(0,0,0,0.6);
          display: flex; justify-content: center; align-items: center;
          border: 2px solid #333;
        }
        .emo-screen {
          width: 164px; height: 118px; background: #0a0a0a;
          border-radius: 28px; position: relative;
          overflow: hidden; border: 3px solid #111;
          transition: box-shadow 0.4s;
        }
        .emo-eyes {
          display: flex; justify-content: space-around; align-items: center;
          width: 100%; padding: 0 14px; box-sizing: border-box;
          position: absolute; top: 50%; transform: translateY(-60%);
        }
        .emo-eye-wrap {
          width: 46px; height: 46px;
          display: flex; justify-content: center; align-items: center;
          position: relative;
        }
        .emo-mouth-wrap {
          position: absolute; bottom: 14px; width: 100%;
          display: flex; justify-content: center; align-items: center;
          height: 24px;
        }
        @keyframes emoTalk {
          from { height: 6px;  width: 24px; border-radius: 6px; }
          to   { height: 16px; width: 32px; border-radius: 0 0 16px 16px; }
        }
      `}</style>

      <div className="emo-hud-frame">
        {/* HUD ring border */}
        <div className="emo-hud-ring" />
        {/* Corner brackets */}
        <div className="emo-hud-corner tl" />
        <div className="emo-hud-corner tr" />
        <div className="emo-hud-corner bl" />
        <div className="emo-hud-corner br" />
        {/* Scanning line */}
        <div className="emo-hud-scanline" />

        <div className="emo-robot-wrap">
          {/* Ears */}
          <div
            className="emo-ear left"
            style={{ ["--emo-ear-color" as string]: color }}
          />
          <div
            className="emo-ear right"
            style={{ ["--emo-ear-color" as string]: color }}
          />

          {/* Head */}
          <div className="emo-head">
            <div
              className="emo-screen"
              style={{ boxShadow: `inset 0 0 18px ${color}30, inset 0 0 6px ${color}15` }}
            >
              {/* Eyes */}
              <div className="emo-eyes">
                <div className="emo-eye-wrap">
                  <BrowOverlay emotion={emotion} color={color} side="left" />
                  <div style={eyeStyle} />
                </div>
                <div className="emo-eye-wrap">
                  <BrowOverlay emotion={emotion} color={color} side="right" />
                  <div style={eyeStyle} />
                </div>
              </div>

              {/* Mouth */}
              <div className="emo-mouth-wrap">
                <div style={mouthStyle} />
              </div>
            </div>
          </div>
        </div>

        {/* HUD status label */}
        <div className="emo-hud-label">
          {isConnected ? 'Avatar Online' : 'Standby'}
        </div>
      </div>
    </>
  );
};

export default EmoFace;
