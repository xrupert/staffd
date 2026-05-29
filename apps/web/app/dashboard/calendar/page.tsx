"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import pb from "../../../lib/pb";

const DEPT_ICONS: Record<string, string> = {
  marketing: "📣", sales: "🤝", legal: "⚖️", hr: "👥",
  finance: "💰", operations: "⚙️", ceo: "🎯", "paid-media": "📈", design: "🎨", reputation: "🛡️",
};

const DEPT_OPTIONS = [
  { value: "marketing", label: "Marketing" },
  { value: "sales", label: "Sales" },
  { value: "legal", label: "Legal" },
  { value: "hr", label: "HR" },
  { value: "finance", label: "Finance" },
  { value: "operations", label: "Operations" },
  { value: "ceo", label: "Strategy" },
  { value: "paid-media", label: "Paid Media" },
  { value: "design", label: "Design" },
  { value: "reputation", label: "Reputation" },
];

interface CalDoc {
  id: string;
  department: string;
  agent_name: string;
  prompt: string;
  created: string;
}

interface ScheduledItem {
  id: string;
  department: string;
  agent_name: string;
  task: string;
  scheduled_date: string;
  status: string;
}

interface Booking {
  id: string;
  attendee_name: string;
  attendee_email: string;
  start_time: string;   // ISO UTC
  duration: number;     // minutes
  notes: string;
  status: string;
  timezone?: string;
}

type DayData = {
  docs: CalDoc[];
  planned: ScheduledItem[];
  bookings: Booking[];
};

function toDateKey(iso: string) {
  return iso.slice(0, 10);
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export default function CalendarPage() {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [docs, setDocs]   = useState<CalDoc[]>([]);
  const [planned, setPlanned] = useState<ScheduledItem[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalDate, setModalDate] = useState("");
  const [loading, setLoading] = useState(true);

  // Plan form state
  const [planDept, setPlanDept]     = useState("marketing");
  const [planTask, setPlanTask]     = useState("");
  const [planAgent, setPlanAgent]   = useState("");
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState<string | null>(null);

  useEffect(() => {
    if (!pb.authStore.isValid) { window.location.href = "/auth/login"; return; }
    void init();
  }, []);

  async function init() {
    // Ensure collection exists
    try {
      await fetch("/api/setup/calendar", { method: "POST" });
    } catch { /* proceed */ }
    await Promise.all([loadDocs(), loadPlanned(), loadBookings()]);
    setLoading(false);
  }

  async function loadBookings() {
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await pb.collection("bookings").getList(1, 200, {
        filter: `user = '${userId}' && status != 'cancelled'`,
        sort: "-start_time",
      });
      setBookings(res.items as unknown as Booking[]);
    } catch { setBookings([]); }
  }

  async function loadDocs() {
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await pb.collection("documents").getList(1, 500, {
        filter: `user = '${userId}'`,
        sort: "-created",
        fields: "id,department,agent_name,prompt,created",
      });
      setDocs(res.items as unknown as CalDoc[]);
    } catch { setDocs([]); }
  }

  async function loadPlanned() {
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await pb.collection("scheduled_content").getList(1, 200, {
        filter: `user = '${userId}'`,
        sort: "scheduled_date",
      });
      setPlanned(res.items as unknown as ScheduledItem[]);
    } catch { setPlanned([]); }
  }

  async function savePlan() {
    if (!planTask.trim() || !modalDate) return;
    setSaving(true);
    try {
      const userId = pb.authStore.record?.id ?? "";
      await pb.collection("scheduled_content").create({
        user: userId,
        department: planDept,
        agent_name: planAgent || DEPT_OPTIONS.find(d => d.value === planDept)?.label || planDept,
        task: planTask.trim(),
        scheduled_date: modalDate,
        status: "planned",
      });
      await loadPlanned();
      setShowModal(false);
      setPlanTask("");
      setPlanAgent("");
    } catch { /* proceed */ }
    finally { setSaving(false); }
  }

  async function deletePlan(id: string) {
    setDeleting(id);
    try {
      await pb.collection("scheduled_content").delete(id);
      setPlanned(prev => prev.filter(p => p.id !== id));
    } catch { /* proceed */ }
    finally { setDeleting(null); }
  }

  function openPlan(dateKey: string) {
    setModalDate(dateKey);
    setShowModal(true);
  }

  // Build day map
  const dayMap = new Map<string, DayData>();
  for (const doc of docs) {
    const key = toDateKey(doc.created);
    const entry = dayMap.get(key) ?? { docs: [], planned: [], bookings: [] };
    entry.docs.push(doc);
    dayMap.set(key, entry);
  }
  for (const item of planned) {
    const key = toDateKey(item.scheduled_date);
    const entry = dayMap.get(key) ?? { docs: [], planned: [], bookings: [] };
    entry.planned.push(item);
    dayMap.set(key, entry);
  }
  for (const booking of bookings) {
    // Bucket by the date of the booking in the host's local time
    const local = new Date(booking.start_time);
    const yyyy = local.getFullYear();
    const mm = String(local.getMonth() + 1).padStart(2, "0");
    const dd = String(local.getDate()).padStart(2, "0");
    const key = `${yyyy}-${mm}-${dd}`;
    const entry = dayMap.get(key) ?? { docs: [], planned: [], bookings: [] };
    entry.bookings.push(booking);
    dayMap.set(key, entry);
  }

  const daysInMonth = getDaysInMonth(year, month);
  const firstDow    = getFirstDayOfWeek(year, month);
  const todayKey    = toDateKey(today.toISOString());

  const selectedData = selected ? dayMap.get(selected) : null;

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelected(null);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelected(null);
  }

  const inputStyle: React.CSSProperties = {
    background: "#111118", border: "1px solid #2A2A38", color: "#F0F0F8",
    borderRadius: "10px", padding: "10px 14px", fontSize: "13px",
    outline: "none", width: "100%",
  };

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "#09090F" }}>
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
        backgroundSize: "64px 64px",
      }} />

      <div className="relative z-10 w-full max-w-5xl mx-auto px-6 py-8">

        <header className="flex items-center justify-between mb-10">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
          <a href="/dashboard" className="text-sm transition-colors hover:text-white" style={{ color: "#5A5A70" }}>
            ← Dashboard
          </a>
        </header>

        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>Content Calendar</p>
          <h1 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.75rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            Plan &amp; Track
          </h1>
          <p className="text-sm mt-2" style={{ color: "#5A5A70" }}>
            See what your staff has produced and plan upcoming work.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-16" style={{ color: "#5A5A70" }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#5B21E8" }} />
            <span className="text-sm">Loading…</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* Calendar grid */}
            <div className="lg:col-span-2 rounded-2xl overflow-hidden" style={{ background: "#111118", border: "1px solid #2A2A38" }}>

              {/* Month nav */}
              <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #1E1E2A" }}>
                <button onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", color: "#5A5A70", fontSize: "16px", padding: "4px 8px" }}>‹</button>
                <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>{MONTHS[month]} {year}</p>
                <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", color: "#5A5A70", fontSize: "16px", padding: "4px 8px" }}>›</button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7" style={{ borderBottom: "1px solid #1E1E2A" }}>
                {DAYS.map(d => (
                  <div key={d} className="text-center py-2.5 text-xs font-medium" style={{ color: "#3A3A50" }}>{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7">
                {Array.from({ length: firstDow }).map((_, i) => (
                  <div key={`empty-${i}`} style={{ minHeight: "72px", borderRight: "1px solid #1A1A24", borderBottom: "1px solid #1A1A24" }} />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const data = dayMap.get(dateKey);
                  const isToday = dateKey === todayKey;
                  const isSelected = dateKey === selected;
                  const isPast = dateKey < todayKey;
                  const hasDocs = (data?.docs.length ?? 0) > 0;
                  const hasPlanned = (data?.planned.length ?? 0) > 0;

                  return (
                    <div
                      key={day}
                      onClick={() => setSelected(isSelected ? null : dateKey)}
                      style={{
                        minHeight: "72px",
                        borderRight: "1px solid #1A1A24",
                        borderBottom: "1px solid #1A1A24",
                        padding: "8px",
                        cursor: "pointer",
                        background: isSelected ? "rgba(91,33,232,0.1)" : "transparent",
                        transition: "background 0.15s",
                      }}
                    >
                      <div className="flex items-start justify-between mb-1.5">
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: isToday ? 700 : 400,
                            color: isToday ? "#A07BFF" : isPast ? "#3A3A50" : "#9090A8",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: isToday ? "20px" : "auto",
                            height: isToday ? "20px" : "auto",
                            borderRadius: isToday ? "50%" : 0,
                            background: isToday ? "rgba(91,33,232,0.25)" : "transparent",
                          }}
                        >
                          {day}
                        </span>
                        {!isPast && (
                          <button
                            onClick={(e) => { e.stopPropagation(); openPlan(dateKey); }}
                            style={{
                              background: "none", border: "none", cursor: "pointer",
                              color: "#3A3A50", fontSize: "14px", lineHeight: 1, padding: "0 2px",
                              opacity: 0,
                            }}
                            className="plan-btn"
                          >
                            +
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        {(data?.docs ?? []).slice(0, 2).map(doc => (
                          <div
                            key={doc.id}
                            style={{
                              fontSize: "9px",
                              color: "#9090A8",
                              background: "rgba(91,33,232,0.12)",
                              borderRadius: "4px",
                              padding: "2px 5px",
                              overflow: "hidden",
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {DEPT_ICONS[doc.department] ?? "📄"} {doc.prompt.slice(0, 22)}
                          </div>
                        ))}
                        {(data?.planned ?? []).slice(0, 2).map(item => (
                          <div
                            key={item.id}
                            style={{
                              fontSize: "9px",
                              color: "#F59E0B",
                              background: "rgba(245,158,11,0.08)",
                              border: "1px dashed rgba(245,158,11,0.3)",
                              borderRadius: "4px",
                              padding: "2px 5px",
                              overflow: "hidden",
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {DEPT_ICONS[item.department] ?? "📄"} {item.task.slice(0, 22)}
                          </div>
                        ))}
                        {(data?.bookings ?? []).slice(0, 2).map(b => {
                          const t = new Date(b.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                          return (
                            <div
                              key={b.id}
                              style={{
                                fontSize: "9px",
                                color: "#22C55E",
                                background: "rgba(34,197,94,0.08)",
                                border: "1px solid rgba(34,197,94,0.25)",
                                borderRadius: "4px",
                                padding: "2px 5px",
                                overflow: "hidden",
                                whiteSpace: "nowrap",
                                textOverflow: "ellipsis",
                              }}
                            >
                              📞 {t} · {b.attendee_name.slice(0, 14)}
                            </div>
                          );
                        })}
                        {((data?.docs.length ?? 0) + (data?.planned.length ?? 0) + (data?.bookings.length ?? 0)) > 6 && (
                          <div style={{ fontSize: "9px", color: "#3A3A50" }}>
                            +{(data!.docs.length + data!.planned.length + data!.bookings.length) - 6} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sidebar — selected day or upcoming */}
            <div className="flex flex-col gap-4">

              {selected ? (
                <div className="rounded-2xl overflow-hidden" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                  <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #1E1E2A" }}>
                    <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>
                      {new Date(selected + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                    </p>
                    {selected >= todayKey && (
                      <button
                        onClick={() => openPlan(selected)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                        style={{ background: "rgba(91,33,232,0.15)", border: "1px solid rgba(91,33,232,0.3)", color: "#A07BFF" }}
                      >
                        + Plan
                      </button>
                    )}
                  </div>

                  <div className="px-5 py-4">
                    {!selectedData && (
                      <p className="text-xs" style={{ color: "#3A3A50" }}>Nothing here yet.</p>
                    )}
                    {selectedData?.docs.map(doc => (
                      <a key={doc.id} href={`/doc/${doc.id}`} target="_blank" rel="noreferrer"
                        className="flex items-start gap-3 py-3 border-b last:border-0 group"
                        style={{ borderColor: "#1E1E2A", textDecoration: "none" }}>
                        <span className="text-base flex-shrink-0">{DEPT_ICONS[doc.department] ?? "📄"}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate group-hover:text-purple-400 transition-colors" style={{ color: "#D0D0E8" }}>
                            {doc.prompt.length > 70 ? doc.prompt.slice(0, 70) + "…" : doc.prompt}
                          </p>
                          <p className="text-xs mt-0.5 capitalize" style={{ color: "#4A4A65" }}>
                            {doc.agent_name || doc.department}
                          </p>
                        </div>
                      </a>
                    ))}
                    {selectedData?.planned.map(item => (
                      <div key={item.id} className="flex items-start gap-3 py-3 border-b last:border-0"
                        style={{ borderColor: "#1E1E2A" }}>
                        <span className="text-base flex-shrink-0">{DEPT_ICONS[item.department] ?? "📄"}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: "#F0C060" }}>
                            {item.task.length > 70 ? item.task.slice(0, 70) + "…" : item.task}
                          </p>
                          <div className="flex items-center justify-between mt-0.5">
                            <p className="text-xs capitalize" style={{ color: "#4A4A65" }}>{item.agent_name || item.department} · Planned</p>
                            <button
                              onClick={() => void deletePlan(item.id)}
                              disabled={deleting === item.id}
                              className="text-xs transition-colors hover:text-red-400"
                              style={{ color: "#3A3A50" }}
                            >
                              {deleting === item.id ? "…" : "×"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {selectedData?.bookings.map(b => {
                      const t = new Date(b.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                      return (
                        <div key={b.id} className="flex items-start gap-3 py-3 border-b last:border-0" style={{ borderColor: "#1E1E2A" }}>
                          <span className="text-base flex-shrink-0">📞</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium" style={{ color: "#22C55E" }}>
                              {t} · {b.attendee_name} ({b.duration} min)
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: "#4A4A65" }}>{b.attendee_email}</p>
                            {b.notes && (
                              <p className="text-xs mt-1 italic" style={{ color: "#6060A0" }}>
                                &ldquo;{b.notes.length > 80 ? b.notes.slice(0, 80) + "…" : b.notes}&rdquo;
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl p-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                  <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#3A3A50" }}>Select a date</p>
                  <p className="text-xs" style={{ color: "#3A3A50" }}>Click any day to see documents generated that day, or plan upcoming content.</p>
                </div>
              )}

              {/* Upcoming planned */}
              {planned.filter(p => p.scheduled_date >= todayKey).length > 0 && (
                <div className="rounded-2xl overflow-hidden" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                  <div className="px-5 py-4" style={{ borderBottom: "1px solid #1E1E2A" }}>
                    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#5A5A70" }}>Upcoming</p>
                  </div>
                  <div className="px-5 py-2">
                    {planned
                      .filter(p => p.scheduled_date >= todayKey)
                      .slice(0, 8)
                      .map(item => (
                        <div key={item.id} className="flex items-center gap-3 py-3 border-b last:border-0" style={{ borderColor: "#1E1E2A" }}>
                          <span className="text-sm flex-shrink-0">{DEPT_ICONS[item.department] ?? "📄"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate" style={{ color: "#D0D0E8" }}>
                              {item.task.length > 50 ? item.task.slice(0, 50) + "…" : item.task}
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: "#4A4A65" }}>
                              {new Date(item.scheduled_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {item.agent_name || item.department}
                            </p>
                          </div>
                          <button
                            onClick={() => void deletePlan(item.id)}
                            disabled={deleting === item.id}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#3A3A50", fontSize: "12px" }}
                          >
                            {deleting === item.id ? "…" : "×"}
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Upcoming bookings */}
              {bookings.filter(b => new Date(b.start_time) >= new Date()).length > 0 && (
                <div className="rounded-2xl overflow-hidden" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                  <div className="px-5 py-4" style={{ borderBottom: "1px solid #1E1E2A" }}>
                    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#22C55E" }}>Booked Calls</p>
                  </div>
                  <div className="px-5 py-2">
                    {bookings
                      .filter(b => new Date(b.start_time) >= new Date())
                      .slice()
                      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
                      .slice(0, 8)
                      .map(b => {
                        const start = new Date(b.start_time);
                        const dateStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                        const timeStr = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                        return (
                          <div key={b.id} className="flex items-start gap-3 py-3 border-b last:border-0" style={{ borderColor: "#1E1E2A" }}>
                            <span className="text-sm flex-shrink-0">📞</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate" style={{ color: "#D0D0E8" }}>
                                {b.attendee_name}
                              </p>
                              <p className="text-xs mt-0.5" style={{ color: "#4A4A65" }}>
                                {dateStr} · {timeStr} · {b.duration}m
                              </p>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Plan modal */}
      {showModal && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 px-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6"
            style={{ background: "#111118", border: "1px solid #2A2A38" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>
                Plan Content —{" "}
                {new Date(modalDate + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </p>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#5A5A70", fontSize: "18px" }}>×</button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: "#6060A0" }}>Department</label>
                <select
                  value={planDept}
                  onChange={e => setPlanDept(e.target.value)}
                  style={{ ...inputStyle }}
                >
                  {DEPT_OPTIONS.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: "#6060A0" }}>What to create</label>
                <textarea
                  value={planTask}
                  onChange={e => setPlanTask(e.target.value)}
                  placeholder="e.g. Write an email campaign for our summer sale"
                  rows={3}
                  style={{ ...inputStyle, resize: "none", lineHeight: "1.6" }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                style={{ background: "none", border: "1px solid #2A2A38", borderRadius: "10px", padding: "9px 18px", fontSize: "13px", color: "#5A5A70", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={() => void savePlan()}
                disabled={!planTask.trim() || saving}
                className="btn-primary rounded-xl font-semibold text-white"
                style={{ padding: "9px 18px", fontSize: "13px", opacity: !planTask.trim() || saving ? 0.5 : 1 }}
              >
                {saving ? "Saving…" : "Save Plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        div:hover .plan-btn { opacity: 1 !important; }
      `}</style>
    </main>
  );
}
