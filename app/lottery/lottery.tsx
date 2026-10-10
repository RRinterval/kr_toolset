"use client";

import { useEffect, useState } from "react";

const MAX_NAMES = 100;
const STORAGE_KEY = "kr_toolset.lottery.names";
const SPIN_MS = 5000;
const RADIUS = 200;
const COLORS = [
  "#f43f5e",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

function parseNames(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function randomIndex(n: number) {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return Math.floor((value / 2 ** 32) * n);
}

// Angle is measured clockwise from 12 o'clock, in degrees.
function pointAt(angle: number, r: number) {
  const rad = (angle * Math.PI) / 180;
  return `${(r * Math.sin(rad)).toFixed(3)} ${(-r * Math.cos(rad)).toFixed(3)}`;
}

function segmentColor(i: number, n: number) {
  // Avoid the last slice sharing a color with the first one.
  if (n > 1 && i === n - 1 && i % COLORS.length === 0) return COLORS[1];
  return COLORS[i % COLORS.length];
}

function truncate(name: string, max: number) {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export default function Lottery() {
  const [draft, setDraft] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      if (Array.isArray(saved) && saved.length > 0) {
        const list = saved.map(String).slice(0, MAX_NAMES);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore from localStorage after hydration
        setNames(list);
        setDraft(list.join("\n"));
      }
    } catch {
      // Storage unavailable; start with an empty list.
    }
  }, []);

  const draftCount = parseNames(draft).length;

  function updateList() {
    const list = parseNames(draft);
    if (list.length > MAX_NAMES) {
      setError(`名單最多 ${MAX_NAMES} 人，目前有 ${list.length} 人`);
      return;
    }
    setError("");
    setNames(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Ignore storage failures; the list still works for this session.
    }
  }

  function spin() {
    if (spinning || names.length === 0) return;
    const n = names.length;
    const slice = 360 / n;
    const index = randomIndex(n);
    // Land somewhere inside the slice, away from its edges.
    const jitter = (Math.random() - 0.5) * slice * 0.7;
    const target = (index + 0.5) * slice + jitter;
    const current = ((rotation % 360) + 360) % 360;
    const delta = (((360 - target - current) % 360) + 360) % 360;
    setRotation(rotation + 360 * 6 + delta);
    setPending(names[index]);
    setSpinning(true);
  }

  function onSpinEnd() {
    if (!spinning) return;
    setSpinning(false);
    setWinner(pending);
  }

  const n = names.length;
  const slice = n > 0 ? 360 / n : 0;
  const fontSize = n <= 12 ? 16 : n <= 30 ? 12 : n <= 60 ? 9 : 7;
  const maxChars = n <= 12 ? 8 : n <= 30 ? 7 : 6;

  return (
    <div className="grid w-full max-w-5xl gap-8 md:grid-cols-[320px_1fr]">
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <h2 className="text-lg font-semibold">參加名單</h2>
        <p className="text-sm text-zinc-500">每行輸入一個名字，最多 {MAX_NAMES} 人。</p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={spinning}
          rows={14}
          placeholder={"王小明\n陳小華\n林大同"}
          className="resize-y rounded-lg border border-zinc-200 p-3 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 disabled:bg-zinc-50"
        />
        <div className="flex items-center justify-between text-sm">
          <span className={draftCount > MAX_NAMES ? "font-medium text-rose-600" : "text-zinc-500"}>
            {draftCount} / {MAX_NAMES}
          </span>
          <span className="text-zinc-500">轉盤上：{n} 人</span>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          onClick={updateList}
          disabled={spinning}
          className="rounded-lg bg-zinc-900 py-2 font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50"
        >
          更新名單
        </button>
      </section>

      <section className="flex flex-col items-center gap-6">
        <div className="relative w-full max-w-[460px]">
          {/* Pointer */}
          <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1">
            <div className="h-0 w-0 border-x-[14px] border-t-[28px] border-x-transparent border-t-zinc-900 drop-shadow" />
          </div>
          <svg viewBox="-210 -210 420 420" className="w-full drop-shadow-xl">
            <circle r={208} fill="#18181b" />
            <g
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: spinning
                  ? `transform ${SPIN_MS}ms cubic-bezier(0.15, 0.7, 0.1, 1)`
                  : "none",
              }}
              onTransitionEnd={onSpinEnd}
            >
              {n === 0 && <circle r={RADIUS} fill="#e4e4e7" />}
              {n === 1 && <circle r={RADIUS} fill={COLORS[0]} />}
              {n > 1 &&
                names.map((_, i) => {
                  const start = i * slice;
                  const end = start + slice;
                  const largeArc = slice > 180 ? 1 : 0;
                  return (
                    <path
                      key={i}
                      d={`M 0 0 L ${pointAt(start, RADIUS)} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${pointAt(end, RADIUS)} Z`}
                      fill={segmentColor(i, n)}
                      stroke="#fff"
                      strokeWidth={n > 60 ? 0.5 : 1.5}
                    />
                  );
                })}
              {names.map((name, i) => (
                <text
                  key={i}
                  transform={`rotate(${(i + 0.5) * slice - 90})`}
                  x={RADIUS - 14}
                  y={0}
                  dominantBaseline="central"
                  textAnchor="end"
                  fontSize={fontSize}
                  fontWeight={600}
                  fill="#fff"
                >
                  {truncate(name, maxChars)}
                </text>
              ))}
              {n === 0 && (
                <text textAnchor="middle" dominantBaseline="central" y={-80} fontSize={16} fill="#71717a">
                  請先輸入名單
                </text>
              )}
            </g>
            <circle r={34} fill="#fff" stroke="#18181b" strokeWidth={4} />
          </svg>
          <button
            onClick={spin}
            disabled={spinning || n === 0}
            className="absolute left-1/2 top-1/2 z-10 flex h-[15%] w-[15%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-rose-500 text-sm font-bold text-white shadow-lg transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {spinning ? "…" : "抽！"}
          </button>
        </div>
        <p className="text-sm text-zinc-500">
          {n === 0 ? "在左側輸入名單並按「更新名單」" : "點擊轉盤中央開始抽獎"}
        </p>
      </section>

      {winner && <WinnerCard name={winner} onClose={() => setWinner(null)} />}
    </div>
  );
}

function WinnerCard({ name, onClose }: { name: string; onClose: () => void }) {
  const date = new Date().toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-card-pop relative w-full max-w-sm overflow-hidden rounded-3xl bg-gradient-to-br from-yellow-200 via-amber-400 to-yellow-600 p-1.5 shadow-[0_0_60px_rgba(251,191,36,0.6)]"
      >
        <div className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 px-8 py-10 text-center">
          <div className="animate-shine pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/60 to-transparent" />
          <div className="pointer-events-none absolute inset-3 rounded-2xl border-2 border-dashed border-amber-700/40" />
          <p className="text-5xl">🏆</p>
          <p className="mt-3 text-sm font-semibold tracking-[0.3em] text-amber-900/80">CONGRATULATIONS</p>
          <h2 className="mt-1 text-2xl font-bold text-amber-950">恭喜中獎</h2>
          <p className="mt-6 break-all text-4xl font-black text-amber-950 drop-shadow-[0_2px_0_rgba(255,255,255,0.5)]">
            {name}
          </p>
          <div className="mx-auto mt-6 h-px w-2/3 bg-amber-800/30" />
          <p className="mt-3 text-sm text-amber-900/80">{date}</p>
          <button
            onClick={onClose}
            className="relative mt-6 rounded-full bg-amber-950 px-6 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-900"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
