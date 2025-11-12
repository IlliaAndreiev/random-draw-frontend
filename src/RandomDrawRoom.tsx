import React, { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import axios from "axios";
import confetti from "canvas-confetti";

// =============================
// Types shared with backend
// =============================

type Participant = {
  id: string;
  name: string;
};

type RoomState = {
  room_id: string;
  participants: Participant[];
  is_draw_done: boolean;
  winner_id?: string | null;
};

type DrawResponse = {
  room_id: string;
  winner: Participant;
};

// =============================
// Config
// =============================

const API_BASE = "http://127.0.0.1:8000";
const ROOM_ID = "r1";

// =============================
// SVG Roulette Wheel Component
// =============================

export type WheelItem = { id: string; label: string };

export type RouletteWheelHandle = {
  spinTo: (winnerId: string, opts?: { spins?: number; durationMs?: number }) => void;
  reset: () => void;
};

const RouletteWheel = forwardRef<
  RouletteWheelHandle,
  { items: WheelItem[]; size?: number; onDone?: (winnerId: string) => void }
>(function RouletteWheel({ items, size = 360, onDone }, ref) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wheelRef = useRef<HTMLDivElement | null>(null);

  const sliceAngle = items.length > 0 ? 360 / items.length : 0;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;

  const colors = useMemo(
    () => items.map((_, i) => `hsl(${(i * 360) / (items.length || 1)}, 75%, 70%)`),
    [items]
  );

  useImperativeHandle(ref, () => ({
    spinTo: (winnerId, opts) => {
      if (!items.length) return;
      const idx = items.findIndex((it) => it.id === winnerId);
      if (idx === -1) return;

      const spins = opts?.spins ?? 6;
      const durationMs = opts?.durationMs ?? 4800;

      const winnerAngle = idx * sliceAngle + sliceAngle / 2; // middle of slice
      const current = ((rotation % 360) + 360) % 360; // 0..359
      const targetAbs = spins * 360 + (360 - winnerAngle);
      const deltaForward = ((targetAbs - current) % 360 + 360) % 360 + spins * 360;
      const nextRotation = rotation + deltaForward;

      setSpinning(true);
      requestAnimationFrame(() => {
        if (!wheelRef.current) return;
        wheelRef.current.style.transition = `transform ${durationMs}ms cubic-bezier(0.12, 0.65, 0, 1)`;
        setSelectedId(null);
        setRotation(nextRotation);

        const onEnd = () => {
          if (!wheelRef.current) return;
          wheelRef.current.removeEventListener("transitionend", onEnd);
          const canonical = nextRotation % 360;
          wheelRef.current.style.transition = "none";
          setRotation((prev) => prev + (canonical - (prev % 360)));
          setSpinning(false);
          setSelectedId(winnerId);
          onDone?.(winnerId);
        };
        wheelRef.current.addEventListener("transitionend", onEnd);
      });
    },
    reset: () => {
      setSelectedId(null);
      if (wheelRef.current) wheelRef.current.style.transition = "none";
      setRotation(0);
      setSpinning(false);
    },
  }), [items, onDone, rotation, sliceAngle]);

  const degToRad = (deg: number) => (deg * Math.PI) / 180;
  const polarToCartesian = (cx: number, cy: number, radius: number, angleDeg: number) => {
    const rad = degToRad(angleDeg);
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };
  const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number) => {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      "M", x, y,
      "L", start.x, start.y,
      "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y,
      "Z",
    ].join(" ");
  };

  return (
    <div className="flex flex-col items-center">
    <div className="relative" style={{ width: size, height: size }}>
        {/* Pointer */}
<div
  style={{
    transform: "translateX(740%) translateY(20%)",
    width: 0, height: 0,
    borderLeft: "12px solid transparent",
    borderRight: "12px solid transparent",
    borderTop: "20px solid #fff",
  }}
/>
        {/* Wheel */}
        <div ref={wheelRef} style={{ transform: `rotate(${rotation - 90}deg)` }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle cx={cx} cy={cy} r={r} fill="#fff" stroke="#e5e7eb" strokeWidth={4} />
            {items.map((item, i) => {
              const start = i * sliceAngle;
              const end = start + sliceAngle;
              const path = describeArc(cx, cy, r, start, end);
              const mid = start + sliceAngle / 2;
              const labelPos = polarToCartesian(cx, cy, r * 0.62, mid);
              const isSelected = item.id === selectedId;
              return (
                <g key={item.id}>
                  <path d={path} fill={colors[i]} stroke="#fff" strokeWidth={1} />
                  <text x={labelPos.x} y={labelPos.y} fontSize={Math.max(10, size / 22)} fontWeight={isSelected ? 800 : 600} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${mid}, ${labelPos.x}, ${labelPos.y})`} fill="#111827">{item.label}</text>
                </g>
              );
            })}
            <circle cx={cx} cy={cy} r={size * 0.08} fill="#111827" />
          </svg>
        </div>
      </div>
{/* статус під колесом */}
    <div className="mt-4 text-base md:text-lg font-medium text-slate-800">
  {spinning
    ? "Крутимо... Крутимо..."
    : selectedId
    ? `Переможець: ${items.find(i => i.id === selectedId)?.label}!`
    : "Готово до спіну!"}
</div>
    </div>
  );
});

// =============================
// Page: RandomDrawRoom with wheel
// =============================

export default function RandomDrawRoom() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [winner, setWinner] = useState<Participant | null>(null);
  const [newName, setNewName] = useState("");
  const [loadingDraw, setLoadingDraw] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wheelRef = useRef<RouletteWheelHandle>(null);

  async function loadRoom() {
    setError(null);
    try {
      const res = await axios.get<RoomState>(`${API_BASE}/rooms/${ROOM_ID}`);
      setRoom(res.data);
      if (res.data.is_draw_done && res.data.winner_id) {
        const w = res.data.participants.find((p) => p.id === res.data.winner_id) || null;
        setWinner(w);
      } else {
        setWinner(null);
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to load room");
    }
  }

  useEffect(() => {
    loadRoom();
  }, []);

  async function handleAddParticipant(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const res = await axios.post<RoomState>(`${API_BASE}/rooms/${ROOM_ID}/participants`, { name: newName.trim() });
      setRoom(res.data);
      setNewName("");
      // Після змін складу - скинемо колесо
      wheelRef.current?.reset();
    } catch (e: any) {
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        setError("Розіграш уже завершено. Зроби reset перед додаванням нового учасника.");
      } else {
        setError(e.message ?? "Failed to add participant");
      }
    }
  }

  async function handleResetDraw() {
    try {
      await axios.post(`${API_BASE}/rooms/${ROOM_ID}/reset_draw`);
      setWinner(null);
      wheelRef.current?.reset();
      await loadRoom();
    } catch (e: any) {
      setError(e.message ?? "Failed to reset draw");
    }
  }

  async function handleDraw() {
    if (!room || room.participants.length === 0) return;
    setLoadingDraw(true);
    setError(null);

    setWinner(null);

    try {
      const res = await axios.post<DrawResponse>(`${API_BASE}/rooms/${ROOM_ID}/draw`);
      const targetWinner = res.data.winner;

      // Запускаємо колесо - коли зупиниться, onDone викличе setWinner та конфеті
      wheelRef.current?.spinTo(targetWinner.id, { spins: 6, durationMs: 4800 });

    } catch (e: any) {
      setError(e.message ?? "Failed to draw");
      setLoadingDraw(false);
    }
  }

  // коли колесо зупинилося
  function handleWheelDone(id: string) {
    const p = room?.participants.find((x) => x.id === id) || null;
    setWinner(p);
    setLoadingDraw(false);
    // святкуємо
    confetti({ particleCount: 160, spread: 70, origin: { y: 0.6 } });

    loadRoom();
  }

  async function handleDeleteParticipant(id: string) {
  if (!room) return;
  const ok = window.confirm("Видалити цього учасника?");
  if (!ok) return;

  try {
    await axios.delete(`${API_BASE}/rooms/${ROOM_ID}/participants/${id}`);
    // якщо видалили поточного winner - приберемо бейдж
    if (winner?.id === id) setWinner(null);
    // скинемо колесо та підвантажимо оновлений список
    wheelRef.current?.reset();
    await loadRoom();
  } catch (e: any) {
    if (axios.isAxiosError(e) && e.response?.status === 409) {
      setError("Розіграш уже завершено. Зроби 'Наступний раунд' перед видаленням.");
    } else {
      setError(e.message ?? "Failed to delete participant");
    }
  }
}

const snow = useMemo(() => <Snowfall />, []);

  function Snowfall() {
  const flakes = Array.from({ length: 15 });
  return (
    <>
      {flakes.map((_, i) => (
        <div
          key={i}
          className="snowflake"
          style={{
            left: `${Math.random() * 100}%`,
            animationDuration: `${4 + Math.random() * 6}s`,
            animationDelay: `${Math.random() * 5}s`,
          }}
        >
          ❄️
        </div>
      ))}
    </>
  );
}

  const items: WheelItem[] = (room?.participants ?? []).map((p) => ({ id: p.id, label: p.name }));

  return (
    <div>
      <div>
  {snow}
  <div/>
  <div>
    </div>
</div>
      <div >
        {/* Left: Wheel */}
        <div>
          <h2>Вітаємо в рулетці!</h2>
          <RouletteWheel ref={wheelRef} items={items} size={380} onDone={handleWheelDone} />
<div>
<button
onClick={room?.is_draw_done ? handleResetDraw : handleDraw}
disabled={loadingDraw || !room || !room.participants.length}
className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
>
{loadingDraw ? "Крутимо..." : room?.is_draw_done ? "Наступний раунд" : "Крутнимо?"}
</button>
</div>
        </div>

        {/* Right: Participants + Controls */}
        <div className="rounded-2xl bg-white shadow p-6 space-y-4">
          <p className="text-sm text-gray-500">ID кімнати: {ROOM_ID}</p>

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <form onSubmit={handleAddParticipant} className="flex gap-2">
<input
  className="flex-1 rounded-xl border border-slate-300 bg-white/80 px-4 py-2 text-sm
             text-slate-900 placeholder:text-slate-500 shadow-inner
             focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent
             transition-all duration-300"
  placeholder="Ім'я учасника"
  value={newName}
  onChange={(e) => setNewName(e.target.value)}
  disabled={room?.is_draw_done}
/>
            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={room?.is_draw_done}
            >
              Додати
            </button>
          </form>

          <div className="rounded-2xl bg-white/75 backdrop-blur-xl shadow p-6 space-y-4 text-slate-900">
            <h2 className="text-lg font-semibold mb-2">Учасники</h2>
{(room?.participants ?? []).map((p) => (
  <p
    key={p.id}
    className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm
               transition-colors border-gray-200 bg-white/90 text-slate-900"
  >
    <span>{p.name}</span>

    <span className="flex items-center gap-2">
      {winner?.id === p.id && (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
          Winner!
        </span>
      )}
      <button
        onClick={() => handleDeleteParticipant(p.id)}
        disabled={loadingDraw || room?.is_draw_done}
        className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-white hover:bg-slate-50 disabled:opacity-50"
        title="Видалити"
      >
        Видалити
      </button>
    </span>
  </p>
))}
          </div>
        </div>
      </div>
    </div>
  );
}
