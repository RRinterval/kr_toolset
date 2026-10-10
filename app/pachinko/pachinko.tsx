"use client";

import { useEffect, useRef, useState } from "react";

// Board geometry (canvas pixels).
const W = 460;
const H = 760;
const LEFT = 20;
const RIGHT = 445;
const LANE_X = 420; // wall between the peg field and the launch lane
const LANE_TOP = 260;
const FLOOR = 700;
const R = (RIGHT - LEFT) / 2; // radius of the top arc
const CX = LEFT + R;
const CY = LEFT + R;
const SLOT_COUNT = 16;
const SLOT_W = (LANE_X - LEFT) / SLOT_COUNT;
const SLOT_TOP = 600;
const SETTLE_Y = 660;

const BALL_R = 5.5;
const PEG_R = 2.5;
const LAUNCH_X = (LANE_X + RIGHT) / 2;
const LAUNCH_Y = FLOOR - BALL_R - 6;

// Physics, in pixels per frame.
const GRAVITY = 0.3;
const SUBSTEPS = 6;
const MAX_SPEED = 28;
const MIN_POWER = 18;
const MAX_POWER = 26;
const POWER_JITTER = 0.04;
const CHARGE_MS = 1200;
const STRIKE_MS = 350;
const STUCK_FRAMES = 60 * 15;

const BALLS_PER_ROUND = 16;
// Pigeons won by how many slots hold at least one ball (index = filled slots - 1).
const SCORE_BY_FILLED = [100, 70, 50, 30, 10, 5, 3, 3, 3, 3, 5, 10, 30, 50, 70, 100];
const VALUE_COLORS: Record<number, string> = {
  100: "#dc2626",
  70: "#ea580c",
  50: "#d97706",
  30: "#16a34a",
  10: "#2563eb",
  5: "#7c3aed",
  0: "#a8a29e",
};
const STORAGE_KEY = "kr_toolset.pachinko.pigeons";

type Ball = { x: number; y: number; vx: number; vy: number; inField: boolean; age: number };
type Segment = { ax: number; ay: number; bx: number; by: number };
type Phase = "playing" | "done";

type Game = {
  balls: Ball[];
  slots: number[];
  remaining: number;
  phase: Phase;
  charging: boolean;
  chargeStart: number;
  strikeAt: number;
};

const WALLS: Segment[] = [
  { ax: LEFT, ay: CY, bx: LEFT, by: FLOOR },
  { ax: RIGHT, ay: CY, bx: RIGHT, by: H },
  { ax: LANE_X, ay: LANE_TOP, bx: LANE_X, by: FLOOR },
  { ax: LEFT, ay: FLOOR, bx: LANE_X, by: FLOOR },
  // Short kickers that push wall-hugging balls back into the pegs.
  ...[300, 410, 520].flatMap((y) => [
    { ax: LEFT, ay: y, bx: LEFT + 9, by: y + 9 },
    { ax: LANE_X, ay: y, bx: LANE_X - 9, by: y + 9 },
  ]),
  ...Array.from({ length: SLOT_COUNT - 1 }, (_, k) => ({
    ax: LEFT + (k + 1) * SLOT_W,
    ay: SLOT_TOP,
    bx: LEFT + (k + 1) * SLOT_W,
    by: FLOOR,
  })),
];

// One-way flap over the launch lane: only blocks balls already in the field.
const GATE: Segment = { ax: LANE_X, ay: LANE_TOP, bx: RIGHT, by: LANE_TOP - 25 };

const PEGS = buildPegs();

function buildPegs() {
  const pegs: { x: number; y: number }[] = [];
  const margin = BALL_R * 2 + PEG_R + 3; // leave room for a ball to pass a wall
  // Pins just inside the top rail scatter balls riding along it.
  for (const deg of [-95, -115, -135, -155, -170]) {
    const a = (deg * Math.PI) / 180;
    pegs.push({ x: CX + Math.cos(a) * (R - 11), y: CY + Math.sin(a) * (R - 11) });
  }
  let row = 0;
  for (let y = 150; y <= 575; y += 22, row++) {
    for (let x = LEFT + SLOT_W * (row % 2 ? 1 : 1.5); x < LANE_X; x += SLOT_W) {
      if (x < LEFT + margin || x > LANE_X - margin) continue;
      if (y < CY && Math.hypot(x - CX, y - CY) > R - 20) continue;
      pegs.push({ x, y });
    }
  }
  return pegs;
}

function newGame(): Game {
  return {
    balls: [],
    slots: Array(SLOT_COUNT).fill(0),
    remaining: BALLS_PER_ROUND,
    phase: "playing",
    charging: false,
    chargeStart: 0,
    strikeAt: -Infinity,
  };
}

function filledOf(slots: number[]) {
  return slots.filter((count) => count > 0).length;
}

function scoreOf(slots: number[]) {
  const filled = filledOf(slots);
  return filled > 0 ? SCORE_BY_FILLED[filled - 1] : 0;
}

function collideCircle(b: Ball, px: number, py: number, pr: number, bounce: number) {
  const dx = b.x - px;
  const dy = b.y - py;
  const min = BALL_R + pr;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min || d2 === 0) return false;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  b.x = px + nx * min;
  b.y = py + ny * min;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + bounce) * vn * nx;
    b.vy -= (1 + bounce) * vn * ny;
  }
  return true;
}

function collideSegment(b: Ball, s: Segment, bounce: number) {
  const abx = s.bx - s.ax;
  const aby = s.by - s.ay;
  const t = Math.max(0, Math.min(1, ((b.x - s.ax) * abx + (b.y - s.ay) * aby) / (abx * abx + aby * aby)));
  return collideCircle(b, s.ax + abx * t, s.ay + aby * t, 0, bounce);
}

function collideArc(b: Ball) {
  if (b.y >= CY) return;
  const dx = b.x - CX;
  const dy = b.y - CY;
  const d = Math.hypot(dx, dy);
  const max = R - BALL_R;
  if (d <= max) return;
  const nx = dx / d;
  const ny = dy / d;
  b.x = CX + nx * max;
  b.y = CY + ny * max;
  const vn = b.vx * nx + b.vy * ny;
  if (vn > 0) {
    b.vx -= 1.2 * vn * nx;
    b.vy -= 1.2 * vn * ny;
  }
}

function stepBall(b: Ball) {
  b.vy += GRAVITY / SUBSTEPS;
  const speed = Math.hypot(b.vx, b.vy);
  if (speed > MAX_SPEED) {
    b.vx *= MAX_SPEED / speed;
    b.vy *= MAX_SPEED / speed;
  }
  b.x += b.vx / SUBSTEPS;
  b.y += b.vy / SUBSTEPS;
  if (!b.inField && b.x < LANE_X - BALL_R * 2) b.inField = true;

  collideArc(b);
  for (const wall of WALLS) collideSegment(b, wall, 0.35);
  if (b.inField) collideSegment(b, GATE, 0.35);
  for (const peg of PEGS) {
    if (Math.abs(peg.y - b.y) > BALL_R + PEG_R || Math.abs(peg.x - b.x) > BALL_R + PEG_R) continue;
    // A little noise on every peg hit keeps each drop unpredictable.
    if (collideCircle(b, peg.x, peg.y, PEG_R, 0.45)) b.vx += (Math.random() - 0.5) * 0.6;
  }
}

type Events = { changed: boolean; ended: boolean };

function update(g: Game): Events {
  const events = { changed: false, ended: false };
  for (let s = 0; s < SUBSTEPS; s++) for (const b of g.balls) stepBall(b);

  g.balls = g.balls.filter((b) => {
    b.age++;
    if (b.age > STUCK_FRAMES) {
      b.vx += (Math.random() - 0.5) * 4;
      b.vy -= 3;
      b.age = 0;
    }
    if (b.x > LANE_X && b.y > LAUNCH_Y) {
      // Too weak to clear the lane: the ball rolls back to the launcher.
      g.remaining++;
      events.changed = true;
      return false;
    }
    if (b.x < LANE_X && b.y > SETTLE_Y) {
      const slot = Math.max(0, Math.min(SLOT_COUNT - 1, Math.floor((b.x - LEFT) / SLOT_W)));
      g.slots[slot]++;
      events.changed = true;
      return false;
    }
    return true;
  });

  if (g.phase === "playing" && g.remaining === 0 && g.balls.length === 0) {
    g.phase = "done";
    events.changed = true;
    events.ended = true;
  }
  return events;
}

function chargeOf(g: Game, now: number) {
  return g.charging ? Math.min(1, (now - g.chargeStart) / CHARGE_MS) : 0;
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const grad = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, BALL_R);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.4, "#d4d4d8");
  grad.addColorStop(1, "#52525b");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
}

function draw(ctx: CanvasRenderingContext2D, g: Game, now: number) {
  ctx.clearRect(0, 0, W, H);

  // Cabinet and playfield.
  ctx.fillStyle = "#7c2d12";
  ctx.fillRect(0, 0, W, H);
  ctx.beginPath();
  ctx.moveTo(LEFT, H);
  ctx.lineTo(LEFT, CY);
  ctx.arc(CX, CY, R, Math.PI, 0);
  ctx.lineTo(RIGHT, H);
  ctx.closePath();
  const field = ctx.createLinearGradient(0, 0, 0, H);
  field.addColorStop(0, "#e0f2fe");
  field.addColorStop(1, "#fef3c7");
  ctx.fillStyle = field;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#451a03";
  ctx.stroke();

  // Launch lane.
  ctx.fillStyle = "rgba(120, 53, 15, 0.12)";
  ctx.fillRect(LANE_X, LANE_TOP, RIGHT - LANE_X, H - LANE_TOP);

  ctx.fillStyle = "#0c4a6e";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("打鴿台", CX - 10, 95);

  // Slot highlights and labels.
  for (let i = 0; i < SLOT_COUNT; i++) {
    const x = LEFT + i * SLOT_W;
    if (g.slots[i] > 0) {
      ctx.fillStyle = "rgba(250, 204, 21, 0.55)";
      ctx.fillRect(x, SLOT_TOP, SLOT_W, FLOOR - SLOT_TOP);
    }
    ctx.fillStyle = g.slots[i] > 0 ? "#fde68a" : "#d6d3d1";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(String(i + 1), x + SLOT_W / 2, FLOOR + 22);
  }

  // Walls, dividers and the lane flap.
  ctx.strokeStyle = "#451a03";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const s of [...WALLS, GATE]) {
    ctx.beginPath();
    ctx.moveTo(s.ax, s.ay);
    ctx.lineTo(s.bx, s.by === FLOOR && s.ax === LANE_X ? H : s.by);
    ctx.stroke();
  }

  ctx.fillStyle = "#57534e";
  for (const p of PEGS) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, PEG_R, 0, Math.PI * 2);
    ctx.fill();
  }

  // Balls resting in the slots.
  for (let i = 0; i < SLOT_COUNT; i++) {
    const x = LEFT + i * SLOT_W + SLOT_W / 2;
    for (let j = 0; j < g.slots[i]; j++) drawBall(ctx, x, FLOOR - BALL_R - 1 - j * BALL_R * 2);
  }

  for (const b of g.balls) drawBall(ctx, b.x, b.y);

  // The ruler: pulled down while charging, thrust up right after a strike.
  const charge = chargeOf(g, now);
  const sinceStrike = now - g.strikeAt;
  const rulerTop = sinceStrike < 120 ? LAUNCH_Y + BALL_R - 10 : LAUNCH_Y + BALL_R + charge * 45;
  ctx.fillStyle = "#facc15";
  ctx.fillRect(LANE_X + 3, rulerTop, RIGHT - LANE_X - 6, H - rulerTop);
  ctx.strokeStyle = "#a16207";
  ctx.lineWidth = 1;
  for (let y = rulerTop + 6; y < H; y += 6) {
    ctx.beginPath();
    ctx.moveTo(LANE_X + 3, y);
    ctx.lineTo(LANE_X + (Math.round((y - rulerTop) / 6) % 5 === 0 ? 14 : 9), y);
    ctx.stroke();
  }
  if (g.phase === "playing" && g.remaining > 0 && sinceStrike > STRIKE_MS) {
    drawBall(ctx, LAUNCH_X, rulerTop - BALL_R);
  }
}

export default function Pachinko() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game>(newGame());
  const [hud, setHud] = useState({ remaining: BALLS_PER_ROUND, slots: Array<number>(SLOT_COUNT).fill(0), phase: "playing" as Phase });
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore from localStorage after hydration
      if (Number.isFinite(saved) && saved > 0) setTotal(saved);
    } catch {
      // Storage unavailable; start from zero.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(total));
    } catch {
      // Ignore storage failures.
    }
  }, [total, loaded]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let frame = 0;
    const loop = (now: number) => {
      const g = gameRef.current;
      const events = update(g);
      if (events.changed) setHud({ remaining: g.remaining, slots: [...g.slots], phase: g.phase });
      if (events.ended) {
        const score = scoreOf(g.slots);
        setLastScore(score);
        setTotal((t) => t + score);
      }
      draw(ctx, g, now);
      if (meterRef.current) meterRef.current.style.width = `${chargeOf(g, now) * 100}%`;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  function startCharge() {
    const g = gameRef.current;
    const now = performance.now();
    if (g.phase !== "playing" || g.remaining === 0 || g.charging || now - g.strikeAt < STRIKE_MS) return;
    g.charging = true;
    g.chargeStart = now;
  }

  function release() {
    const g = gameRef.current;
    if (!g.charging) return;
    const now = performance.now();
    const jitter = 1 + (Math.random() * 2 - 1) * POWER_JITTER;
    const power = (MIN_POWER + (MAX_POWER - MIN_POWER) * chargeOf(g, now)) * jitter;
    g.charging = false;
    g.strikeAt = now;
    g.remaining--;
    g.balls.push({
      x: LAUNCH_X,
      y: LAUNCH_Y,
      vx: (Math.random() - 0.5) * 0.1,
      vy: -power,
      inField: false,
      age: 0,
    });
    setHud({ remaining: g.remaining, slots: [...g.slots], phase: g.phase });
  }

  function restart() {
    gameRef.current = newGame();
    const g = gameRef.current;
    setHud({ remaining: g.remaining, slots: [...g.slots], phase: g.phase });
    setLastScore(null);
  }

  // Space bar works as the ruler too; release anywhere ends the charge.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      if (!e.repeat) startCharge();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  });

  const filled = filledOf(hud.slots);
  const launched = BALLS_PER_ROUND - hud.remaining;

  return (
    <div className="grid w-full max-w-4xl gap-8 md:grid-cols-[460px_1fr]">
      <canvas
        ref={canvasRef}
        onPointerDown={startCharge}
        className="w-full max-w-[460px] touch-none select-none rounded-2xl shadow-xl"
        style={{ aspectRatio: `${W} / ${H}` }}
      />

      <div className="flex flex-col gap-5">
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <p className="text-sm text-zinc-500">累計鴿子</p>
          <p className="text-4xl font-black tabular-nums">🕊️ {total.toLocaleString()}</p>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">本盤</h2>
            <span className="text-sm text-zinc-500">
              已打出 {launched} / {BALLS_PER_ROUND}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: BALLS_PER_ROUND }, (_, i) => (
              <span
                key={i}
                className={`h-3.5 w-3.5 rounded-full ${i < hud.remaining ? "bg-gradient-to-br from-zinc-100 to-zinc-500 ring-1 ring-zinc-400" : "bg-zinc-200"}`}
              />
            ))}
          </div>
          <p className="text-sm">
            有彈珠的格子：<span className="font-bold">{filled}</span> / {SLOT_COUNT} 格
          </p>

          {hud.phase === "playing" ? (
            <>
              <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100">
                <div ref={meterRef} className="h-full w-0 rounded-full bg-gradient-to-r from-amber-300 to-rose-500" />
              </div>
              <button
                onPointerDown={startCharge}
                disabled={hud.remaining === 0}
                className="touch-none select-none rounded-lg bg-amber-500 py-3 font-bold text-white shadow transition hover:bg-amber-600 active:scale-[0.98] disabled:bg-zinc-300"
              >
                {hud.remaining === 0 ? "等待彈珠落下…" : "按住拉尺，放開打出"}
              </button>
              <p className="text-xs text-zinc-500">也可以按住空白鍵，或直接按住彈珠台。按越久，力道越大。</p>
            </>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl bg-amber-50 p-4 text-center ring-1 ring-amber-200">
              <p className="text-sm text-amber-800">這盤結束！</p>
              <p className="text-2xl font-black text-amber-900">得到 {lastScore} 隻鴿子 🕊️</p>
              <button
                onClick={restart}
                className="rounded-lg bg-zinc-900 py-2 font-medium text-white transition hover:bg-zinc-700"
              >
                再玩一盤
              </button>
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <h2 className="mb-2 text-lg font-semibold">計分方式</h2>
          <p className="mb-3 text-sm text-zinc-500">打完 16 顆後，數一數共有幾格有彈珠：</p>
          <table className="w-full text-sm">
            <tbody>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <tr key={i} className="border-t border-zinc-100">
                  <td className="py-1.5">
                    {i + 1} 格或 {SLOT_COUNT - i} 格有彈珠
                  </td>
                  <td className="py-1.5 text-right font-bold" style={{ color: VALUE_COLORS[SCORE_BY_FILLED[i]] }}>
                    {SCORE_BY_FILLED[i]} 隻
                  </td>
                </tr>
              ))}
              <tr className="border-t border-zinc-100">
                <td className="py-1.5">7 – 10 格有彈珠</td>
                <td className="py-1.5 text-right font-bold text-zinc-400">5 隻</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
