import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

interface Props { onDone: () => void; }

const TOTAL_MS = 7000;

// ─── Compute bounding box once and center/scale the model ────────────────────
function IronManModel({ phase }: { phase: number }) {
  const { scene } = useGLTF("/iron_man.glb");
  const groupRef  = useRef<THREE.Group>(null!);
  const ready     = useRef(false);
  const walkStart = useRef(0);   // phase when walk begins
  const walkDone  = useRef(false);

  // Clone + patch materials once
  const cloned = useRef<THREE.Group | null>(null);
  if (!cloned.current) {
    cloned.current = scene.clone(true);
    cloned.current.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          const mat = m as THREE.MeshStandardMaterial;
          if (mat.isMeshStandardMaterial) {
            // Boost emissive from original color so suit glows visibly
            mat.emissive          = mat.color.clone().multiplyScalar(0.5);
            mat.emissiveIntensity = 1.5;
            mat.metalness         = 0.7;
            mat.roughness         = 0.3;
            mat.needsUpdate       = true;
          }
        });
      }
    });

    // Auto-center & scale to fit ~2.2 units tall
    const box    = new THREE.Box3().setFromObject(cloned.current);
    const size   = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale  = 2.2 / maxDim;
    cloned.current.scale.setScalar(scale);
    cloned.current.position.sub(center.multiplyScalar(scale));
    // Sit on y=0 floor
    const box2 = new THREE.Box3().setFromObject(cloned.current);
    cloned.current.position.y -= box2.min.y;
    ready.current = true;
  }

  useFrame((_, delta) => {
    if (!groupRef.current || !ready.current) return;

    // Phase 0–0.25: model appears from far back, walks forward
    // Phase 0.25+:  model is centered, slow heroic rotation
    const WALK_END = 0.30;

    if (phase < WALK_END) {
      // Walk in from z = -8 to z = 0
      const t = phase / WALK_END;
      const eased = 1 - Math.pow(1 - t, 2); // ease-out
      groupRef.current.position.z = THREE.MathUtils.lerp(-8, 0, eased);
      groupRef.current.position.y = 0;
      // Slight forward lean while walking
      groupRef.current.rotation.x = THREE.MathUtils.lerp(0.15, 0, t);
      groupRef.current.rotation.y = 0; // face camera
    } else {
      // Centered — slow rotation + gentle bob
      groupRef.current.position.z = THREE.MathUtils.lerp(groupRef.current.position.z, 0, delta * 4);
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, 0, delta * 3);
      groupRef.current.rotation.y += delta * 0.5;
      groupRef.current.position.y = Math.sin(Date.now() * 0.0012) * 0.06;
    }
  });

  return (
    <group ref={groupRef} position={[0, 0, -8]}>
      <primitive object={cloned.current} />
    </group>
  );
}

// ─── Glowing floor circle (flat, under the model) ────────────────────────────
function FloorCircle({ phase }: { phase: number }) {
  const outerRef = useRef<THREE.Mesh>(null!);
  const innerRef = useRef<THREE.Mesh>(null!);
  const glowRef  = useRef<THREE.Mesh>(null!);

  useFrame((_, delta) => {
    const target = phase > 0.1 ? 1 : 0;
    if (outerRef.current) {
      const s = THREE.MathUtils.lerp(outerRef.current.scale.x, target, delta * 3);
      outerRef.current.scale.setScalar(s);
      outerRef.current.rotation.z += delta * 0.4;
    }
    if (innerRef.current) {
      const s = THREE.MathUtils.lerp(innerRef.current.scale.x, target, delta * 2.5);
      innerRef.current.scale.setScalar(s);
      innerRef.current.rotation.z -= delta * 0.7;
    }
    if (glowRef.current) {
      const s = THREE.MathUtils.lerp(glowRef.current.scale.x, target, delta * 2);
      glowRef.current.scale.setScalar(s);
      // Pulse
      const mat = glowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.12 + Math.sin(Date.now() * 0.003) * 0.06;
    }
  });

  return (
    <group position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Outer dashed ring */}
      <mesh ref={outerRef} scale={0}>
        <ringGeometry args={[1.35, 1.4, 80]} />
        <meshBasicMaterial color="#00d4ff" transparent opacity={0.9} />
      </mesh>
      {/* Inner ring */}
      <mesh ref={innerRef} scale={0}>
        <ringGeometry args={[0.9, 0.93, 64]} />
        <meshBasicMaterial color="#00aaff" transparent opacity={0.6} />
      </mesh>
      {/* Glow disc */}
      <mesh ref={glowRef} scale={0}>
        <circleGeometry args={[1.4, 64]} />
        <meshBasicMaterial color="#00d4ff" transparent opacity={0.12} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ─── Tick marks on the floor circle ──────────────────────────────────────────
function CircleTicks({ phase }: { phase: number }) {
  const ref = useRef<THREE.Group>(null!);
  useFrame((_, delta) => {
    if (!ref.current) return;
    const target = phase > 0.15 ? 1 : 0;
    ref.current.children.forEach((c) => {
      c.scale.setScalar(THREE.MathUtils.lerp(c.scale.x, target, delta * 2));
    });
    ref.current.rotation.y += delta * 0.3;
  });

  const ticks = Array.from({ length: 36 }, (_, i) => {
    const angle = (i / 36) * Math.PI * 2;
    const big   = i % 9 === 0;
    const r     = 1.4;
    const len   = big ? 0.12 : 0.06;
    return { angle, r, len, big };
  });

  return (
    <group ref={ref} position={[0, 0.02, 0]}>
      {ticks.map((t, i) => (
        <mesh
          key={i}
          position={[Math.cos(t.angle) * t.r, 0, Math.sin(t.angle) * t.r]}
          scale={0}
        >
          <boxGeometry args={[t.big ? 0.025 : 0.012, 0.01, t.len]} />
          <meshBasicMaterial color={t.big ? "#00ffee" : "#0088aa"} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Vertical energy rings around the model ───────────────────────────────────
function VerticalRings({ phase }: { phase: number }) {
  const r1 = useRef<THREE.Mesh>(null!);
  const r2 = useRef<THREE.Mesh>(null!);

  useFrame((_, delta) => {
    const show = phase > 0.35;
    [r1, r2].forEach((r, i) => {
      if (!r.current) return;
      const target = show ? 1 : 0;
      const s = THREE.MathUtils.lerp(r.current.scale.x, target, delta * 3);
      r.current.scale.setScalar(s);
      r.current.rotation.y += delta * (i === 0 ? 0.8 : -0.5);
      r.current.rotation.z += delta * (i === 0 ? 0.3 : -0.2);
    });
  });

  return (
    <group position={[0, 1.1, 0]}>
      <mesh ref={r1} scale={0}>
        <torusGeometry args={[1.3, 0.012, 8, 80]} />
        <meshBasicMaterial color="#00d4ff" transparent opacity={0.7} />
      </mesh>
      <mesh ref={r2} scale={0}>
        <torusGeometry args={[1.0, 0.008, 8, 64]} />
        <meshBasicMaterial color="#0088ff" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

// ─── Assembly particles ───────────────────────────────────────────────────────
function Particles({ phase }: { phase: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const COUNT   = 80;
  const dummy   = useRef(new THREE.Object3D());
  const data    = useRef(
    Array.from({ length: COUNT }, (_, i) => ({
      theta:  (i / COUNT) * Math.PI * 2,
      phi:    Math.random() * Math.PI,
      r:      1.6 + Math.random() * 1.0,
      startR: 6 + Math.random() * 4,
      speed:  0.4 + Math.random() * 0.6,
      y:      (Math.random() - 0.5) * 3,
    }))
  );

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    data.current.forEach((p, i) => {
      const t = Math.min(phase * 2.5, 1);
      const r = THREE.MathUtils.lerp(p.startR, p.r, t);
      p.theta += delta * p.speed * (phase < 0.4 ? 1.5 : 0.4);
      dummy.current.position.set(
        Math.cos(p.theta) * r,
        p.y * (1 - t * 0.5),
        Math.sin(p.theta) * r
      );
      const s = 0.03 + Math.sin(Date.now() * 0.004 + i) * 0.015;
      dummy.current.scale.setScalar(s * Math.min(phase * 3, 1));
      dummy.current.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.current.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]}>
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#00d4ff" transparent opacity={0.8} />
    </instancedMesh>
  );
}

// ─── Background gradient plane ────────────────────────────────────────────────
function BackgroundGlow({ phase }: { phase: number }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(() => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.55 * Math.min(phase * 3, 1);
  });
  return (
    <mesh ref={ref} position={[0, 1, -4]}>
      <planeGeometry args={[14, 10]} />
      <meshBasicMaterial color="#001830" transparent opacity={0} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ─── Camera: starts far back, zooms to frame full model ──────────────────────
function CameraRig({ phase }: { phase: number }) {
  const { camera } = useThree();
  useFrame((_, delta) => {
    // Target: model is ~2.2 units tall, centered at y≈1.1
    // We want to see full body — position camera at z=5, y=1.1
    const targetZ = phase < 0.3 ? 6.5 : phase < 0.7 ? 5.0 : 4.2;
    const targetY = 1.1; // center of model height

    (camera as THREE.PerspectiveCamera).position.z = THREE.MathUtils.lerp(
      (camera as THREE.PerspectiveCamera).position.z,
      targetZ,
      delta * 1.8
    );
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, delta * 1.5);
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, 0, delta * 2);
    camera.lookAt(0, 1.1, 0);
  });
  return null;
}

// ─── 2D HUD overlay ───────────────────────────────────────────────────────────
function HUDCanvas({ phase }: { phase: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = window.innerWidth  * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width  = window.innerWidth  + "px";
    canvas.style.height = window.innerHeight + "px";
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const W = window.innerWidth, H = window.innerHeight;
    const cx = W / 2;
    ctx.clearRect(0, 0, W, H);

    const fadeOut = phase > 0.88 ? Math.max(0, 1 - (phase - 0.88) / 0.12) : 1;

    // ── Corner brackets ──
    if (phase > 0.08) {
      const bLen = Math.min((phase - 0.08) / 0.25, 1) * 52;
      const corners: [number, number, number, number][] = [
        [40, 40, 1, 1], [W - 40, 40, -1, 1],
        [40, H - 40, 1, -1], [W - 40, H - 40, -1, -1],
      ];
      ctx.save();
      ctx.globalAlpha = fadeOut;
      ctx.strokeStyle = "rgba(0,210,255,0.9)";
      ctx.lineWidth   = 2;
      ctx.shadowColor = "#00d4ff";
      ctx.shadowBlur  = 10;
      corners.forEach(([bx, by, sx, sy]) => {
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + sx * bLen, by); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by + sy * bLen); ctx.stroke();
      });
      ctx.restore();
    }

    // ── Top center title bar ──
    if (phase > 0.1) {
      const tp = Math.min((phase - 0.1) / 0.15, 1);
      ctx.save();
      ctx.globalAlpha = tp * fadeOut;
      const barW = 340 * tp;
      ctx.fillStyle   = "rgba(0,200,255,0.12)";
      ctx.fillRect(cx - barW / 2, 24, barW, 22);
      ctx.strokeStyle = "rgba(0,210,255,0.6)";
      ctx.lineWidth   = 1;
      ctx.strokeRect(cx - barW / 2, 24, barW, 22);
      ctx.font        = "11px 'Courier New', monospace";
      ctx.fillStyle   = "rgba(0,220,255,0.9)";
      ctx.shadowColor = "#00d4ff"; ctx.shadowBlur = 8;
      ctx.textAlign   = "center";
      ctx.fillText("◈  N.A.T.A.L.I.E.  ·  SUIT UP SEQUENCE  ◈", cx, 39);
      ctx.restore();
    }

    // ── Boot text (left side) ──
    const bootLines = [
      "> SUIT ASSEMBLY INITIATED",
      "> LOADING REPULSOR ARRAY...",
      "> POWER SYSTEMS: ONLINE",
      "> ARMOR INTEGRITY: 100%",
      "> THREAT ANALYSIS: CLEAR",
      "> VOICE INTERFACE: READY",
      "> AGENT ENSEMBLE COMPLETE",
      "> WELCOME BACK, VARUN",
    ];
    bootLines.forEach((line, i) => {
      const lt = 0.12 + i * 0.09;
      if (phase < lt) return;
      const lp      = Math.min((phase - lt) / 0.06, 1);
      const visLen  = Math.floor(line.length * lp);
      ctx.save();
      ctx.globalAlpha = Math.min(lp * 2, 1) * fadeOut;
      ctx.font        = "12px 'Courier New', monospace";
      ctx.fillStyle   = i === bootLines.length - 1 ? "rgba(0,255,180,0.95)" : "rgba(0,200,255,0.85)";
      ctx.shadowColor = "#00d4ff"; ctx.shadowBlur = 5;
      ctx.textAlign   = "left";
      ctx.fillText(line.slice(0, visLen), 60, 90 + i * 24);
      ctx.restore();
    });

    // ── Final title ──
    if (phase > 0.84) {
      const tp      = Math.min((phase - 0.84) / 0.08, 1);
      const fo      = phase > 0.93 ? Math.max(0, 1 - (phase - 0.93) / 0.07) : 1;
      ctx.save();
      ctx.globalAlpha = tp * fo;
      ctx.textAlign   = "center";
      ctx.font        = "bold 46px 'Courier New', monospace";
      ctx.fillStyle   = "#00d4ff";
      ctx.shadowColor = "#00d4ff"; ctx.shadowBlur = 28;
      ctx.fillText("N.A.T.A.L.I.E.", cx, H * 0.82);
      ctx.font        = "12px 'Courier New', monospace";
      ctx.fillStyle   = "rgba(0,180,220,0.8)";
      ctx.shadowBlur  = 8;
      ctx.fillText("NEURAL CORE ONLINE  ·  ALL SYSTEMS READY", cx, H * 0.82 + 28);
      ctx.restore();
    }
  }, [phase]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
}

// ─── Main overlay ─────────────────────────────────────────────────────────────
const SuitUpOverlay = ({ onDone }: Props) => {
  const [phase, setPhase] = useState(0);
  const startRef = useRef(performance.now());
  const rafRef   = useRef(0);

  useEffect(() => {
    const tick = () => {
      const ms = performance.now() - startRef.current;
      const p  = Math.min(ms / TOTAL_MS, 1);
      setPhase(p);
      if (p >= 1) { onDone(); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [onDone]);

  const overlayOpacity =
    phase < 0.04 ? phase / 0.04 :
    phase > 0.93 ? Math.max(0, 1 - (phase - 0.93) / 0.07) : 1;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      opacity: overlayOpacity,
    }}>
      {/* Rich background — deep navy with radial glow */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 80% 70% at 50% 45%, #001428 0%, #000810 50%, #000305 100%)",
      }} />
      {/* Extra center glow that brightens with phase */}
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse 50% 60% at 50% 45%, rgba(0,80,140,${0.35 * Math.min(phase * 3, 1)}) 0%, transparent 70%)`,
        transition: "background 0.1s",
      }} />

      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, 1.1, 6.5], fov: 42 }}
        gl={{ antialias: true, alpha: true }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {/* Lighting — strong front fill so suit colors are fully visible */}
        <ambientLight intensity={2.5} />
        {/* Main front key light */}
        <directionalLight position={[0, 2, 6]}   intensity={6}   color="#ffffff" />
        {/* Front fill from slightly left */}
        <directionalLight position={[-3, 3, 5]}  intensity={4}   color="#ffe8d0" />
        {/* Front fill from slightly right */}
        <directionalLight position={[3, 3, 5]}   intensity={4}   color="#d0e8ff" />
        {/* Top rim light */}
        <directionalLight position={[0, 8, 0]}   intensity={3}   color="#ffffff" />
        {/* Cyan accent from below-front */}
        <pointLight position={[0, 0.5, 3]}  intensity={4}   color="#00d4ff" distance={8} />
        {/* Gold/red accent from sides */}
        <pointLight position={[-2, 2, 2]}   intensity={2}   color="#ff6622" distance={6} />
        <pointLight position={[2, 2, 2]}    intensity={2}   color="#ffaa00" distance={6} />
        {/* Floor bounce */}
        <pointLight position={[0, -0.2, 0]} intensity={2}   color="#00aaff" distance={5} />

        <BackgroundGlow phase={phase} />
        <CameraRig phase={phase} />

        <Suspense fallback={null}>
          <IronManModel phase={phase} />
        </Suspense>

        <FloorCircle   phase={phase} />
        <CircleTicks   phase={phase} />
        <VerticalRings phase={phase} />
        <Particles     phase={phase} />
      </Canvas>

      {/* 2D HUD */}
      <HUDCanvas phase={phase} />
    </div>
  );
};

useGLTF.preload("/iron_man.glb");
export default SuitUpOverlay;
