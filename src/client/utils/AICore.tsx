// ── AICore.tsx ───────────────────────────────────────────────────────────────
// Fully animated AI avatar face rendered on an HTML5 Canvas at 60 FPS.
// Features: eyes, eyebrows, mouth, micro-expressions, blinking, eye movement,
// emotion-driven face shape, speech lip-sync, thinking/idle/sleep animations.
// No external dependencies — pure Canvas2D.

import { useEffect, useRef } from "react";
import type { AvatarEmotion, AvatarState } from "./AvatarStateEngine";

// ── Props ─────────────────────────────────────────────────────────────────────
export interface AICoreProps {
  isConnected: boolean;
  isSpeaking:  boolean;
  avatarState?: AvatarState;
  emotion?:     AvatarEmotion;
  intensity?:   number;
}

// ── Emotion → colour palette ──────────────────────────────────────────────────
interface Palette {
  bg0:    string;  // inner background radial centre
  bg1:    string;  // outer background
  iris:   string;  // iris fill
  glow:   string;  // shadow/glow colour
  skin:   string;  // face base
  brow:   string;  // eyebrow stroke
  lip:    string;  // lip fill
  ring0:  string;  // innermost ring neon
  ring1:  string;  // outer ring neon
}

const PALETTES: Record<AvatarEmotion, Palette> = {
  neutral: {
    bg0:"rgba(4,18,32,0.6)", bg1:"rgba(2,8,20,0.3)",
    iris:"rgba(0,200,255,1)", glow:"#00ddff",
    skin:"rgba(30,50,80,0.55)", brow:"rgba(0,220,255,0.9)",
    lip:"rgba(0,180,255,0.8)",
    ring0:"rgba(0,200,255,", ring1:"rgba(0,160,220,",
  },
  happy: {
    bg0:"rgba(20,30,10,0.6)", bg1:"rgba(10,20,5,0.3)",
    iris:"rgba(100,255,100,1)", glow:"#44ff88",
    skin:"rgba(20,60,30,0.55)", brow:"rgba(80,255,120,0.9)",
    lip:"rgba(60,220,100,0.85)",
    ring0:"rgba(80,255,120,", ring1:"rgba(40,200,80,",
  },
  sad: {
    bg0:"rgba(10,10,40,0.65)", bg1:"rgba(5,5,25,0.35)",
    iris:"rgba(100,130,255,1)", glow:"#6688ff",
    skin:"rgba(20,20,60,0.55)", brow:"rgba(120,140,255,0.8)",
    lip:"rgba(80,100,220,0.8)",
    ring0:"rgba(100,120,255,", ring1:"rgba(60,80,200,",
  },
  angry: {
    bg0:"rgba(40,6,4,0.65)", bg1:"rgba(20,3,2,0.35)",
    iris:"rgba(255,60,40,1)", glow:"#ff3322",
    skin:"rgba(70,15,10,0.6)", brow:"rgba(255,80,50,0.95)",
    lip:"rgba(255,50,30,0.85)",
    ring0:"rgba(255,60,30,", ring1:"rgba(200,30,10,",
  },
  excited: {
    bg0:"rgba(40,15,5,0.6)", bg1:"rgba(25,8,3,0.3)",
    iris:"rgba(255,180,0,1)", glow:"#ffaa00",
    skin:"rgba(60,30,10,0.55)", brow:"rgba(255,200,50,0.95)",
    lip:"rgba(255,160,20,0.85)",
    ring0:"rgba(255,180,0,", ring1:"rgba(220,120,0,",
  },
  surprised: {
    bg0:"rgba(30,5,40,0.6)", bg1:"rgba(15,3,25,0.3)",
    iris:"rgba(220,100,255,1)", glow:"#cc66ff",
    skin:"rgba(50,15,60,0.55)", brow:"rgba(200,100,255,0.9)",
    lip:"rgba(180,80,240,0.8)",
    ring0:"rgba(200,80,255,", ring1:"rgba(150,50,200,",
  },
  confused: {
    bg0:"rgba(30,20,10,0.6)", bg1:"rgba(18,12,5,0.3)",
    iris:"rgba(255,200,80,1)", glow:"#ffcc44",
    skin:"rgba(50,35,15,0.55)", brow:"rgba(240,200,80,0.9)",
    lip:"rgba(220,170,60,0.8)",
    ring0:"rgba(240,190,60,", ring1:"rgba(190,140,30,",
  },
  thinking: {
    bg0:"rgba(8,25,40,0.6)", bg1:"rgba(4,14,25,0.3)",
    iris:"rgba(0,220,240,1)", glow:"#00ccee",
    skin:"rgba(15,45,65,0.55)", brow:"rgba(0,210,240,0.85)",
    lip:"rgba(0,190,220,0.8)",
    ring0:"rgba(0,210,240,", ring1:"rgba(0,160,195,",
  },
  sleeping: {
    bg0:"rgba(5,5,15,0.7)", bg1:"rgba(2,3,10,0.5)",
    iris:"rgba(60,70,100,0.4)", glow:"#223355",
    skin:"rgba(10,15,30,0.5)", brow:"rgba(60,80,120,0.5)",
    lip:"rgba(50,65,100,0.5)",
    ring0:"rgba(50,60,90,", ring1:"rgba(30,40,70,",
  },
};

// ── lerp helpers ──────────────────────────────────────────────────────────────
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── Component ─────────────────────────────────────────────────────────────────
const AICore = ({
  isConnected,
  isSpeaking,
  avatarState  = "IDLE",
  emotion      = "neutral",
  intensity    = 0.3,
}: AICoreProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  // stateRef lets the animation loop read current props without re-mounting
  const stateRef = useRef({ isConnected, isSpeaking, avatarState, emotion, intensity });
  useEffect(() => {
    stateRef.current = { isConnected, isSpeaking, avatarState, emotion, intensity };
  }, [isConnected, isSpeaking, avatarState, emotion, intensity]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx    = canvas.getContext("2d")!;

    // ── resize handler ───────────────────────────────────────────────────
    const resize = () => {
      const p = canvas.parentElement!;
      canvas.width  = p.clientWidth;
      canvas.height = p.clientHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // ── Animation state ──────────────────────────────────────────────────
    let t = 0;                         // global time accumulator (seconds)

    // Smooth palette transition
    let palLerp  = 0;                  // 0–1 blend toward target
    let currentPalette: Palette = { ...PALETTES.neutral };
    let targetPalette:  Palette = { ...PALETTES.neutral };
    let lastEmotion: AvatarEmotion = "neutral";

    // Ring system (Iron-Man style concentric HUD rings, always visible)
    const ringAngles = [0, 0, 0, 0, 0, 0, 0];
    const ringSpeeds = [0.012, -0.009, 0.007, -0.011, 0.006, -0.008, 0.005];
    const RINGS = [
      { r: 36,  lw: 2.5, type: "solid",   brackets: 0  },
      { r: 52,  lw: 1.5, type: "dash",    brackets: 0  },
      { r: 70,  lw: 3.5, type: "solid",   brackets: 4  },
      { r: 90,  lw: 1.2, type: "dots",    brackets: 0  },
      { r: 110, lw: 4.5, type: "solid",   brackets: 4  },
      { r: 135, lw: 1.5, type: "dots",    brackets: 0  },
      { r: 160, lw: 5,   type: "segment", brackets: 6  },
    ] as const;

    let beatPulse = 0, lastBeat = 0, scanAngle = 0;

    // Stars
    const STARS = Array.from({ length: 160 }, () => ({
      x: Math.random(), y: Math.random(),
      r: Math.random() * 1.1 + 0.25,
      a: Math.random() * 0.55 + 0.15,
      ts: Math.random() * 1.5 + 0.5,
      to: Math.random() * Math.PI * 2,
    }));

    // ── palette lerp helper ──────────────────────────────────────────────
    function lerpPaletteField(
      a: Palette, b: Palette, k: keyof Palette, lt: number
    ): string {
      // We only lerp numeric parts of rgba strings for the ring colours
      // For named colours (hex/rgb) we just hard-switch at 50%
      if (k === "ring0" || k === "ring1") {
        return lt < 0.5 ? a[k] : b[k];
      }
      return lt < 0.5 ? a[k] : b[k];
    }

    function computePalette(lt: number, a: Palette, b: Palette): Palette {
      const result = {} as Palette;
      (Object.keys(a) as (keyof Palette)[]).forEach(k => {
        (result as any)[k] = lerpPaletteField(a, b, k, lt);
      });
      return result;
    }

    // ── Draw helpers ─────────────────────────────────────────────────────

    // Rounded rectangle (for mouth corners)
    function roundRect(
      ctx: CanvasRenderingContext2D,
      x: number, y: number, w: number, h: number, r: number
    ) {
      const rc = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
      ctx.beginPath();
      ctx.moveTo(x + rc, y);
      ctx.lineTo(x + w - rc, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + rc);
      ctx.lineTo(x + w, y + h - rc);
      ctx.quadraticCurveTo(x + w, y + h, x + w - rc, y + h);
      ctx.lineTo(x + rc, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - rc);
      ctx.lineTo(x, y + rc);
      ctx.quadraticCurveTo(x, y, x + rc, y);
      ctx.closePath();
    }

    // ── MAIN DRAW LOOP ────────────────────────────────────────────────────
    const draw = (ts: number) => {
      const W = canvas.width, H = canvas.height;
      const cx = W / 2, cy = H / 2;
      const dt = 0.016; // fixed 60 fps step
      t += dt;

      const {
        isConnected: conn,
        isSpeaking:  speak,
        avatarState: avState,
        emotion:     avEmotion,
        intensity:   avIntensity,
      } = stateRef.current;

      const isSleeping  = avState === "SLEEPING";
      const isThinking  = avState === "THINKING" || avState === "PROCESSING";
      const isListening = avState === "LISTENING";

      // ── Palette transition ──────────────────────────────────────────────
      if (avEmotion !== lastEmotion) {
        lastEmotion     = avEmotion;
        targetPalette   = PALETTES[avEmotion] ?? PALETTES.neutral;
        palLerp         = 0;
      }
      palLerp = clamp(palLerp + dt * 1.5, 0, 1);
      const pal = computePalette(palLerp, currentPalette, targetPalette);
      if (palLerp >= 1) currentPalette = { ...targetPalette };

      // ── Speed multiplier ────────────────────────────────────────────────
      const spd = isSleeping ? 0.08 : speak ? 3.2 : conn ? 1.4 : 0.35;

      // ── Beat ────────────────────────────────────────────────────────────
      const beatInterval = speak ? 350 : conn ? 900 : 2200;
      if (ts - lastBeat > beatInterval) { lastBeat = ts; beatPulse = 1; }
      beatPulse *= 0.88;
      scanAngle += isSleeping ? 0.003 : speak ? 0.055 : conn ? 0.025 : 0.008;

      // ── RENDER ───────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);

      // ── Background ───────────────────────────────────────────────────────
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(0, 0, W, H);

      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.55);
      bg.addColorStop(0,   pal.bg0);
      bg.addColorStop(0.7, pal.bg1);
      bg.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Stars
      STARS.forEach(s => {
        const tw = 0.45 + 0.55 * Math.abs(Math.sin(ts * 0.001 * s.ts + s.to));
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180,220,255,${s.a * tw * (conn ? 0.6 : 0.3)})`;
        ctx.fill();
      });

      // ── Translate to centre for all ring/face drawing ─────────────────
      ctx.save();
      ctx.translate(cx, cy);

      // ── Mechanical bezel (dark ring fill between outer ring and edge) ──
      if (conn) {
        const bezelR = 178;
        ctx.beginPath();
        ctx.arc(0, 0, bezelR + 22, 0, Math.PI * 2);
        ctx.arc(0, 0, bezelR,      0, Math.PI * 2, true);
        ctx.fillStyle = speak
          ? "rgba(30,8,4,0.92)"
          : isSleeping ? "rgba(5,5,15,0.95)"
          : "rgba(6,14,28,0.92)";
        ctx.fill();
      }

      // ── HUD RINGS ─────────────────────────────────────────────────────
      RINGS.forEach((ring, i) => {
        ringAngles[i] += ringSpeeds[i] * spd;
        const r = ring.r + beatPulse * (i < 3 ? 3 : 2);
        const nc = `${pal.ring0}`;  // e.g. "rgba(0,200,255,"

        ctx.save();
        ctx.rotate(ringAngles[i]);

        if (ring.type === "segment") {
          const segCount = 6, segSpan = (Math.PI * 2) / segCount;
          for (let s = 0; s < segCount; s++) {
            ctx.beginPath();
            ctx.arc(0, 0, r, s * segSpan + 0.12, (s + 1) * segSpan - 0.12);
            ctx.strokeStyle = `${nc}${0.82 + beatPulse * 0.15})`;
            ctx.lineWidth   = ring.lw;
            ctx.shadowColor = pal.glow; ctx.shadowBlur = 18 + beatPulse * 14;
            ctx.stroke(); ctx.shadowBlur = 0;
          }
        } else if (ring.type === "solid") {
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.strokeStyle = `${nc}${0.85 + beatPulse * 0.12})`;
          ctx.lineWidth   = ring.lw;
          ctx.shadowColor = pal.glow; ctx.shadowBlur = 20 + beatPulse * 16;
          ctx.stroke(); ctx.shadowBlur = 0;
        } else if (ring.type === "dash") {
          ctx.setLineDash([12, 8]);
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.strokeStyle = `${nc}0.55)`;
          ctx.lineWidth   = ring.lw;
          ctx.shadowColor = pal.glow; ctx.shadowBlur = 10;
          ctx.stroke(); ctx.setLineDash([]); ctx.shadowBlur = 0;
        } else if (ring.type === "dots") {
          const dotCount = i === 3 ? 36 : 48;
          for (let k = 0; k < dotCount; k++) {
            const a   = (k / dotCount) * Math.PI * 2;
            const big = k % 6 === 0;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * r, Math.sin(a) * r, big ? 3.5 : 1.8, 0, Math.PI * 2);
            ctx.fillStyle   = `${nc}${big ? 0.88 : 0.55})`;
            ctx.shadowColor = pal.glow; ctx.shadowBlur = big ? 10 : 4;
            ctx.fill(); ctx.shadowBlur = 0;
          }
        }

        // Bracket notches
        if (ring.brackets > 0) {
          for (let b = 0; b < ring.brackets; b++) {
            const a = (b / ring.brackets) * Math.PI * 2;
            ctx.save();
            ctx.rotate(a);
            ctx.translate(r, 0);
            ctx.strokeStyle = `${nc}0.95)`;
            ctx.lineWidth = 2;
            ctx.shadowColor = pal.glow; ctx.shadowBlur = 12;
            ctx.strokeRect(-7, -(ring.lw + 6) / 2, 14, ring.lw + 6);
            ctx.shadowBlur = 0;
            ctx.restore();
          }
        }

        ctx.restore();
      });

      // ── Scan sweep ─────────────────────────────────────────────────────
      if (conn && !isSleeping) {
        ctx.save();
        ctx.rotate(scanAngle);
        const sR = 155;
        const sg = ctx.createLinearGradient(0, 0, sR, 0);
        sg.addColorStop(0,   `${pal.ring0}0.85)`);
        sg.addColorStop(0.6, `${pal.ring0}0.18)`);
        sg.addColorStop(1,   "transparent");
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sR, 0);
        ctx.strokeStyle = sg; ctx.lineWidth = 2.5;
        ctx.shadowColor = pal.glow; ctx.shadowBlur = 16;
        ctx.stroke(); ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(0, 0, sR * 0.88, -0.5, 0);
        ctx.strokeStyle = `${pal.ring0}0.1)`; ctx.lineWidth = 20;
        ctx.stroke();
        ctx.restore();
      }

      // ── Beat pulse rings ────────────────────────────────────────────────
      for (let b = 0; b < 3; b++) {
        const bp = Math.max(0, beatPulse - b * 0.2);
        if (bp < 0.02) continue;
        ctx.beginPath();
        ctx.arc(0, 0, 28 + (1 - bp) * (100 + b * 20), 0, Math.PI * 2);
        ctx.strokeStyle = `${pal.ring0}${bp * (0.75 - b * 0.18)})`;
        ctx.lineWidth   = bp * (speak ? 10 - b * 2.5 : 6 - b * 1.5);
        ctx.shadowColor = pal.glow; ctx.shadowBlur = speak ? 40 - b * 8 : 22 - b * 5;
        ctx.stroke(); ctx.shadowBlur = 0;
      }

      ctx.restore(); // translate to centre

      // ── Outer tick ruler ───────────────────────────────────────────────
      if (conn) {
        ctx.strokeStyle = `${pal.ring0}0.4)`;
        ctx.lineWidth   = 1;
        for (let k = 0; k < 40; k++) {
          const a     = (k / 40) * Math.PI * 2;
          const inner = 179, outer = 179 + (k % 4 === 0 ? 9 : 5);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
          ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
          ctx.stroke();
        }
      }

      // ── HUD Label ──────────────────────────────────────────────────────
      if (conn) {
        const stateLabel =
          isSleeping  ? "◈  SLEEP MODE  ◈" :
          isThinking  ? "◈  PROCESSING  ◈" :
          speak       ? "◈  SPEAKING    ◈" :
          isListening ? "◈  LISTENING   ◈" :
                        "◈  STANDBY     ◈";

        ctx.font      = "9px 'Courier New', monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = `${pal.ring0}0.85)`;
        ctx.shadowColor = pal.glow; ctx.shadowBlur = 8;
        ctx.fillText(stateLabel, cx, cy - 198);
        ctx.shadowBlur = 0;
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    // Initial black frame
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []); // mount once — all state read from stateRef

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute", inset: 0,
        width: "100%", height: "100%",
        pointerEvents: "none", userSelect: "none",
      }}
    />
  );
};

export default AICore;
