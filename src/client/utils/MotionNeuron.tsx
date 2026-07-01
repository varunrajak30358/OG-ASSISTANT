import { useEffect, useRef } from "react";

/**
 * MotionNeuron — fluctuating neural sphere in the center of the UI.
 * Renders a large glowing neural-network orb with tendrils shooting outward,
 * similar to the BrainGPT style: a pulsating sphere with neural connections.
 */
const MotionNeuron = ({
  isConnected,
  isSpeaking,
}: {
  isConnected: boolean;
  isSpeaking: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const stateRef = useRef({ isConnected, isSpeaking });
  useEffect(() => {
    stateRef.current = { isConnected, isSpeaking };
  }, [isConnected, isSpeaking]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      const p = canvas.parentElement!;
      canvas.width = p.clientWidth;
      canvas.height = p.clientHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    let t = 0;
    let amp = 0;
    let energyLevel = 0;

    // Neural nodes that orbit the center sphere
    const NODE_COUNT = 28;
    type NeuralNode = {
      angle: number;
      radius: number;
      baseRadius: number;
      size: number;
      speed: number;
      pulseOffset: number;
      connectionStrength: number;
      branchAngle: number;
      branchLen: number;
    };

    const nodes: NeuralNode[] = Array.from({ length: NODE_COUNT }, (_, i) => ({
      angle: (i / NODE_COUNT) * Math.PI * 2 + Math.random() * 0.3,
      radius: 70 + Math.random() * 80,
      baseRadius: 70 + Math.random() * 80,
      size: 2 + Math.random() * 4,
      speed: (0.003 + Math.random() * 0.006) * (Math.random() > 0.5 ? 1 : -1),
      pulseOffset: Math.random() * Math.PI * 2,
      connectionStrength: 0.3 + Math.random() * 0.7,
      branchAngle: Math.random() * Math.PI * 2,
      branchLen: 15 + Math.random() * 35,
    }));

    // Secondary distant nodes (outer ring)
    const OUTER_COUNT = 14;
    const outerNodes = Array.from({ length: OUTER_COUNT }, (_, i) => ({
      angle: (i / OUTER_COUNT) * Math.PI * 2,
      radius: 150 + Math.random() * 40,
      size: 1.5 + Math.random() * 2.5,
      speed: (0.002 + Math.random() * 0.004) * (Math.random() > 0.5 ? 1 : -1),
      pulseOffset: Math.random() * Math.PI * 2,
    }));

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;
      const { isConnected: conn, isSpeaking: speak } = stateRef.current;

      // Ease energy level
      const targetEnergy = speak ? 1.0 : conn ? 0.5 : 0.12;
      energyLevel += (targetEnergy - energyLevel) * 0.04;

      // Ease amplitude for blob distortion
      const targetAmp = speak ? 1.0 : conn ? 0.45 : 0.1;
      amp += (targetAmp - amp) * 0.06;

      // Time progression
      t += speak ? 0.025 : conn ? 0.014 : 0.005;

      ctx.clearRect(0, 0, W, H);

      // ── Base sphere core ──────────────────────────────────────────────────────
      const baseR = Math.min(W, H) * 0.22;

      // Outer glow
      const outerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 2.5);
      if (speak) {
        outerGlow.addColorStop(0, `rgba(180, 60, 255, ${0.15 * energyLevel})`);
        outerGlow.addColorStop(0.4, `rgba(100, 0, 200, ${0.1 * energyLevel})`);
        outerGlow.addColorStop(1, "transparent");
      } else if (conn) {
        outerGlow.addColorStop(0, `rgba(80, 120, 255, ${0.18 * energyLevel})`);
        outerGlow.addColorStop(0.4, `rgba(40, 60, 180, ${0.1 * energyLevel})`);
        outerGlow.addColorStop(1, "transparent");
      } else {
        outerGlow.addColorStop(0, `rgba(30, 30, 80, ${0.12 * energyLevel})`);
        outerGlow.addColorStop(1, "transparent");
      }
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = outerGlow;
      ctx.fill();

      // ── Fluctuating blob layers ────────────────────────────────────────────────
      const LAYERS = speak ? 6 : conn ? 5 : 3;
      const POINTS = 200;

      for (let layer = 0; layer < LAYERS; layer++) {
        const layerT = t * (1 + layer * 0.22) + layer * 1.4;
        const layerAmp = amp * baseR * (0.18 + layer * 0.07);
        const WAVES = 4 + layer;
        const alpha = speak
          ? 0.75 - layer * 0.1
          : conn
          ? 0.5 - layer * 0.08
          : 0.18 - layer * 0.04;

        if (alpha <= 0) continue;

        ctx.beginPath();
        for (let i = 0; i <= POINTS; i++) {
          const angle = (i / POINTS) * Math.PI * 2;
          let r = baseR * (0.85 + layer * 0.05);

          // Multiple harmonics for organic fluctuation
          for (let w = 1; w <= WAVES; w++) {
            const waveDir = w % 2 === 0 ? 1 : -1;
            r +=
              Math.sin(angle * w + layerT * waveDir + w * 0.8) *
              (layerAmp / (w * 0.8));
          }

          // Extra turbulence when speaking
          if (speak) {
            r += Math.sin(angle * 7 + t * 3.5) * amp * baseR * 0.06;
            r += Math.cos(angle * 11 + t * 2.1) * amp * baseR * 0.04;
          }

          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();

        // Gradient fill — purple/blue theme like BrainGPT
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 1.6);
        if (speak) {
          g.addColorStop(0, `rgba(220, 160, 255, ${alpha})`);
          g.addColorStop(0.3, `rgba(160, 60, 255, ${alpha * 0.9})`);
          g.addColorStop(0.7, `rgba(80, 0, 180, ${alpha * 0.6})`);
          g.addColorStop(1, `rgba(40, 0, 100, 0)`);
        } else if (conn) {
          g.addColorStop(0, `rgba(180, 220, 255, ${alpha})`);
          g.addColorStop(0.3, `rgba(100, 160, 255, ${alpha * 0.85})`);
          g.addColorStop(0.7, `rgba(40, 80, 200, ${alpha * 0.55})`);
          g.addColorStop(1, `rgba(20, 40, 120, 0)`);
        } else {
          g.addColorStop(0, `rgba(80, 100, 160, ${alpha})`);
          g.addColorStop(1, `rgba(30, 40, 80, 0)`);
        }
        ctx.fillStyle = g;

        ctx.shadowColor = speak ? "#c060ff" : conn ? "#6090ff" : "#303060";
        ctx.shadowBlur = speak ? 35 : conn ? 22 : 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Stroke on outer layers
        if (layer <= 1) {
          ctx.strokeStyle = speak
            ? `rgba(220, 140, 255, ${alpha * 0.8})`
            : conn
            ? `rgba(140, 200, 255, ${alpha * 0.7})`
            : `rgba(80, 100, 180, ${alpha * 0.4})`;
          ctx.lineWidth = speak ? 1.8 : 1.2;
          ctx.shadowColor = speak ? "#cc44ff" : "#4488ff";
          ctx.shadowBlur = speak ? 18 : 10;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // ── Neural nodes with tendrils ─────────────────────────────────────────────
      const nodePositions: [number, number][] = [];

      nodes.forEach((node) => {
        node.angle += node.speed * (speak ? 2.2 : conn ? 1.3 : 0.4);

        // Fluctuate radius
        const radiusFluctuation =
          Math.sin(t * 2.5 + node.pulseOffset) * 15 * energyLevel +
          Math.cos(t * 1.3 + node.pulseOffset * 2) * 8 * energyLevel;
        node.radius = node.baseRadius + radiusFluctuation;

        const x = cx + Math.cos(node.angle) * node.radius;
        const y = cy + Math.sin(node.angle) * node.radius;
        nodePositions.push([x, y]);

        // Draw tendril from sphere surface to node
        const surfaceR = baseR * 0.9;
        const sx = cx + Math.cos(node.angle) * surfaceR;
        const sy = cy + Math.sin(node.angle) * surfaceR;

        const alpha = energyLevel * node.connectionStrength * 0.8;
        if (alpha > 0.02) {
          ctx.beginPath();
          // Curved tendril using quadratic bezier
          const midX = (sx + x) / 2 + Math.sin(t + node.pulseOffset) * 12;
          const midY = (sy + y) / 2 + Math.cos(t + node.pulseOffset) * 12;
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(midX, midY, x, y);
          ctx.strokeStyle = speak
            ? `rgba(200, 100, 255, ${alpha})`
            : conn
            ? `rgba(80, 150, 255, ${alpha})`
            : `rgba(60, 80, 150, ${alpha * 0.5})`;
          ctx.lineWidth = 0.8 + energyLevel * 0.8;
          ctx.shadowColor = speak ? "#aa44ff" : "#4477ff";
          ctx.shadowBlur = speak ? 8 : 5;
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Branch off node
          if (energyLevel > 0.2) {
            node.branchAngle += 0.02 * (speak ? 2 : 1);
            const bx = x + Math.cos(node.branchAngle) * node.branchLen * energyLevel;
            const by = y + Math.sin(node.branchAngle) * node.branchLen * energyLevel;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(bx, by);
            ctx.strokeStyle = speak
              ? `rgba(180, 80, 255, ${alpha * 0.6})`
              : `rgba(60, 120, 255, ${alpha * 0.5})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }

        // Node dot
        const nodePulse = 0.5 + 0.5 * Math.sin(t * 3 + node.pulseOffset);
        const nodeSize = node.size * (0.6 + nodePulse * 0.8) * (0.5 + energyLevel);
        ctx.beginPath();
        ctx.arc(x, y, nodeSize, 0, Math.PI * 2);
        const nodeG = ctx.createRadialGradient(x, y, 0, x, y, nodeSize * 1.5);
        if (speak) {
          nodeG.addColorStop(0, `rgba(255, 200, 255, ${0.9 * energyLevel})`);
          nodeG.addColorStop(1, `rgba(180, 60, 255, 0)`);
        } else if (conn) {
          nodeG.addColorStop(0, `rgba(200, 230, 255, ${0.85 * energyLevel})`);
          nodeG.addColorStop(1, `rgba(60, 120, 255, 0)`);
        } else {
          nodeG.addColorStop(0, `rgba(120, 140, 200, ${0.6 * energyLevel})`);
          nodeG.addColorStop(1, "transparent");
        }
        ctx.fillStyle = nodeG;
        ctx.shadowColor = speak ? "#cc44ff" : "#4488ff";
        ctx.shadowBlur = speak ? 16 : 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // ── Draw connections between nearby nodes ──────────────────────────────────
      for (let i = 0; i < nodePositions.length; i++) {
        for (let j = i + 1; j < nodePositions.length; j++) {
          const [x1, y1] = nodePositions[i];
          const [x2, y2] = nodePositions[j];
          const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
          if (dist < 90 * energyLevel + 40) {
            const alpha = (1 - dist / (90 * energyLevel + 40)) * energyLevel * 0.4;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = speak
              ? `rgba(160, 80, 255, ${alpha})`
              : conn
              ? `rgba(60, 120, 240, ${alpha})`
              : `rgba(40, 60, 120, ${alpha * 0.4})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // ── Outer distant nodes ────────────────────────────────────────────────────
      outerNodes.forEach((node) => {
        node.angle += node.speed * (speak ? 1.5 : conn ? 0.8 : 0.2);
        const x = cx + Math.cos(node.angle) * node.radius;
        const y = cy + Math.sin(node.angle) * node.radius;

        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + node.pulseOffset));
        const alpha = pulse * energyLevel * 0.5;

        if (alpha > 0.02) {
          ctx.beginPath();
          ctx.arc(x, y, node.size * (0.5 + energyLevel * 0.5), 0, Math.PI * 2);
          ctx.fillStyle = speak
            ? `rgba(180, 80, 255, ${alpha})`
            : conn
            ? `rgba(80, 140, 255, ${alpha})`
            : `rgba(60, 80, 140, ${alpha * 0.5})`;
          ctx.shadowColor = speak ? "#9933ff" : "#3366ff";
          ctx.shadowBlur = 6;
          ctx.fill();
          ctx.shadowBlur = 0;

          // Tiny tendril to nearest main node
          if (nodePositions.length > 0 && energyLevel > 0.3) {
            let nearest = 0, nearDist = Infinity;
            nodePositions.forEach(([nx, ny], ni) => {
              const d = Math.sqrt((nx - x) ** 2 + (ny - y) ** 2);
              if (d < nearDist) { nearDist = d; nearest = ni; }
            });
            if (nearDist < 120) {
              const [nx, ny] = nodePositions[nearest];
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(nx, ny);
              ctx.strokeStyle = speak
                ? `rgba(140, 60, 220, ${alpha * 0.4})`
                : `rgba(60, 100, 200, ${alpha * 0.3})`;
              ctx.lineWidth = 0.4;
              ctx.stroke();
            }
          }
        }
      });

      // ── Center bright nucleus ──────────────────────────────────────────────────
      const nucleusR = speak
        ? 10 + amp * 14 + Math.sin(t * 8) * 4
        : conn
        ? 7 + amp * 8 + Math.sin(t * 4) * 2
        : 4;

      const nG = ctx.createRadialGradient(cx, cy, 0, cx, cy, nucleusR * 2);
      if (speak) {
        nG.addColorStop(0, "rgba(255, 255, 255, 1)");
        nG.addColorStop(0.2, "rgba(240, 200, 255, 1)");
        nG.addColorStop(0.6, "rgba(180, 80, 255, 0.8)");
        nG.addColorStop(1, "rgba(100, 0, 200, 0)");
      } else if (conn) {
        nG.addColorStop(0, "rgba(220, 240, 255, 1)");
        nG.addColorStop(0.3, "rgba(160, 210, 255, 0.9)");
        nG.addColorStop(0.7, "rgba(60, 120, 255, 0.5)");
        nG.addColorStop(1, "rgba(20, 60, 180, 0)");
      } else {
        nG.addColorStop(0, "rgba(100, 120, 200, 0.7)");
        nG.addColorStop(1, "transparent");
      }
      ctx.beginPath();
      ctx.arc(cx, cy, nucleusR * 2, 0, Math.PI * 2);
      ctx.fillStyle = nG;
      ctx.shadowColor = speak ? "#cc44ff" : conn ? "#4488ff" : "#303080";
      ctx.shadowBlur = speak ? 40 : conn ? 25 : 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Hard white center
      ctx.beginPath();
      ctx.arc(cx, cy, nucleusR * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = speak ? "rgba(255,255,255,0.95)" : conn ? "rgba(200,230,255,0.9)" : "rgba(120,140,200,0.5)";
      ctx.shadowColor = speak ? "#ffffff" : "#aaccff";
      ctx.shadowBlur = speak ? 20 : 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        userSelect: "none",
      }}
    />
  );
};

export default MotionNeuron;
