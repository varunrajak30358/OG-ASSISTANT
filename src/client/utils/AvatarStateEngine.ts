// ── AvatarStateEngine.ts ────────────────────────────────────────────────────
// Centralized state machine for the AI Avatar.
// Handles all transitions between avatar states and emotions.
// Emotion detection is keyword-based, lightweight, runs in-browser.

export type AvatarState =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "PROCESSING"
  | "SPEAKING"
  | "SLEEPING";

export type AvatarEmotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "excited"
  | "surprised"
  | "confused"
  | "thinking"
  | "sleeping"
  | "concerned"
  | "curious";

export interface AvatarStateSnapshot {
  state: AvatarState;
  emotion: AvatarEmotion;
  intensity: number;       // 0–1, how strong the current emotion is
  mouthOpen: number;       // 0–1, driven externally by speech synthesis timing
  eyeLookX: number;        // -1 to 1
  eyeLookY: number;        // -1 to 1
  blinkProgress: number;   // 0 = open, 1 = fully closed
  browRaise: number;       // -1 (furrowed) to 1 (raised)
  cheekPuff: number;       // 0–1
}

// ── Keyword maps for lightweight emotion detection ──────────────────────────
const EMOTION_KEYWORDS: Record<AvatarEmotion, string[]> = {
  happy: [
    "happy","glad","great","wonderful","amazing","love","awesome","fantastic",
    "excellent","perfect","beautiful","joy","excited","fun","good","nice",
    "pleased","delighted","thrilled","celebrate","😊","😄","🎉","yay","haha",
  ],
  sad: [
    "sad","sorry","unfortunate","regret","miss","lost","died","death","pain",
    "hurt","cry","tears","depressed","unhappy","disappoint","failed","😢","😭",
  ],
  angry: [
    "angry","mad","furious","hate","terrible","awful","disgusting","annoying",
    "frustrated","irritated","outraged","unacceptable","😠","😤","rage",
  ],
  excited: [
    "wow","incredible","insane","unbelievable","exciting","epic","legendary",
    "mind-blowing","breaking","news","just announced","brand new","🤩","🔥",
  ],
  surprised: [
    "surprise","unexpected","unbelievable","shocking","oh no","wait what",
    "really?","seriously?","what?","😲","😱","omg","oh my",
  ],
  confused: [
    "confused","unclear","not sure","uncertain","maybe","perhaps","hmm",
    "i think","could be","possibly","complicated","complex","🤔","idk",
  ],
  thinking: [
    "let me think","analyzing","processing","considering","calculating",
    "searching","looking up","one moment","let me check","researching",
  ],
  concerned: [
    "concerned","worried","nervous","danger","careful","risk","warning","alert","error","failed","issue","problem","fail"
  ],
  curious: [
    "curious","wonder","interested","question","ask","explore","discover","what if","how come","why"
  ],
  sleeping: [],   // programmatic only — no keywords
  neutral: [],    // fallback
};

// Score text against emotion keywords; returns best match
export function detectEmotion(text: string): { emotion: AvatarEmotion; intensity: number } {
  const lower = text.toLowerCase();
  let bestEmotion: AvatarEmotion = "neutral";
  let bestScore = 0;

  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS) as [AvatarEmotion, string[]][]) {
    if (keywords.length === 0) continue;
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestEmotion = emotion;
    }
  }

  const intensity = bestScore > 0 ? Math.min(1, 0.4 + bestScore * 0.2) : 0.3;
  return { emotion: bestEmotion, intensity };
}

// ── Avatar State Machine ─────────────────────────────────────────────────────
export class AvatarStateEngine {
  private _state: AvatarState = "IDLE";
  private _emotion: AvatarEmotion = "neutral";
  private _intensity: number = 0.3;
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private _resetEmotionTimeout: ReturnType<typeof setTimeout> | null = null;
  private _onChange: (() => void) | null = null;
  private readonly IDLE_TIMEOUT_MS = 30_000;   // 30 s → IDLE
  private readonly SLEEP_TIMEOUT_MS = 120_000;  // 2 min → SLEEP

  get state()   { return this._state;   }
  get emotion() { return this._emotion; }
  get intensity(){ return this._intensity; }

  setChangeListener(cb: (() => void) | null) {
    this._onChange = cb;
  }

  // ── Public transition API ──────────────────────────────────────────────
  onConnect() {
    this._transition("IDLE", "neutral", 0.3);
    this._resetSleepTimer();
  }

  onDisconnect() {
    this._clearTimers();
    this._clearEmotionReset();
    this._state   = "IDLE";
    this._emotion = "neutral";
    this._intensity = 0.2;
    if (this._onChange) this._onChange();
  }

  onListening() {
    this._transition("LISTENING", this._emotion, this._intensity);
    this._resetSleepTimer();
  }

  onThinking() {
    this._transition("THINKING", "thinking", 0.6);
  }

  onAgentChunk(text: string) {
    // While streaming, enter PROCESSING briefly then switch to SPEAKING
    if (this._state !== "SPEAKING") {
      const { emotion, intensity } = detectEmotion(text);
      this._transition("SPEAKING", emotion, intensity);
    } else {
      // Keep updating emotion as more text arrives
      const { emotion, intensity } = detectEmotion(text);
      if (intensity > 0.35) {
        this._emotion   = emotion;
        this._intensity = intensity;
        if (this._onChange) this._onChange();
      }
    }
  }

  onSpeakingEnd() {
    this._transition("IDLE", this._emotion, Math.max(0.2, this._intensity * 0.7));
    this._resetSleepTimer();
  }

  onUserMessage(text: string) {
    const { emotion, intensity } = detectEmotion(text);
    if (intensity > 0.3) {
      this._emotion   = emotion;
      this._intensity = intensity;
      if (this._onChange) this._onChange();
    }
    this._resetSleepTimer();
  }

  onInteraction() {
    // Wake from sleep on any interaction
    if (this._state === "SLEEPING") {
      this._transition("IDLE", "neutral", 0.3);
    }
    this._resetSleepTimer();
  }

  // ── Manual triggers with auto-resets ──────────────────────────────────
  private _clearEmotionReset() {
    if (this._resetEmotionTimeout) {
      clearTimeout(this._resetEmotionTimeout);
      this._resetEmotionTimeout = null;
    }
  }

  private _scheduleEmotionReset(targetEmotion: AvatarEmotion, delayMs: number) {
    this._clearEmotionReset();
    this._resetEmotionTimeout = setTimeout(() => {
      if (this._state !== "SLEEPING" && this._state !== "SPEAKING") {
        this._transition(this._state, targetEmotion, 0.3);
      }
    }, delayMs);
  }

  onError() {
    this._clearEmotionReset();
    const errEmotions: AvatarEmotion[] = ["concerned", "sad", "angry"];
    const chosen = errEmotions[Math.floor(Math.random() * errEmotions.length)];
    this._transition(this._state, chosen, 0.85);
    this._scheduleEmotionReset("neutral", 4000);
  }

  onSuccess() {
    this._clearEmotionReset();
    const successEmotions: AvatarEmotion[] = ["happy", "excited", "curious"];
    const chosen = successEmotions[Math.floor(Math.random() * successEmotions.length)];
    this._transition(this._state, chosen, 0.85);
    this._scheduleEmotionReset("neutral", 4000);
  }

  onProcessing() {
    this._clearEmotionReset();
    const procEmotions: AvatarEmotion[] = ["thinking", "curious"];
    const chosen = procEmotions[Math.floor(Math.random() * procEmotions.length)];
    this._transition("PROCESSING", chosen, 0.6);
    this._scheduleEmotionReset("neutral", 8000);
  }

  // ── Private helpers ────────────────────────────────────────────────────
  private _transition(state: AvatarState, emotion: AvatarEmotion, intensity: number) {
    this._state     = state;
    this._emotion   = emotion;
    this._intensity = intensity;
    if (this._onChange) {
      this._onChange();
    }
  }

  private _clearTimers() {
    if (this._idleTimer)  { clearTimeout(this._idleTimer);  this._idleTimer  = null; }
    if (this._sleepTimer) { clearTimeout(this._sleepTimer); this._sleepTimer = null; }
  }

  private _resetSleepTimer() {
    this._clearTimers();
    this._sleepTimer = setTimeout(() => {
      if (this._state === "IDLE") {
        this._transition("SLEEPING", "sleeping", 1);
      }
    }, this.SLEEP_TIMEOUT_MS);
  }

  destroy() {
    this._clearTimers();
    this._clearEmotionReset();
  }
}
