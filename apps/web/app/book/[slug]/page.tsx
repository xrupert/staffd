"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";

interface HostMeta {
  business_name: string;
  duration: number;
  timezone: string;
}

interface AvailabilityResponse {
  slots: string[];
  duration: number;
  timezone: string;
  business_name?: string;
}

type BookingState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; startTime: string; duration: number }
  | { status: "error"; message: string };

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonthDays(year: number, month: number): Array<{ date: Date; inMonth: boolean }> {
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: Array<{ date: Date; inMonth: boolean }> = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push({ date: d, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ date: new Date(year, month, d), inMonth: true });
  }
  // pad to 6 rows for stable layout
  while (days.length < 42) {
    const last = days[days.length - 1]!.date;
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    days.push({ date: next, inMonth: false });
  }
  return days;
}

export default function BookPage() {
  const params = useParams();
  const slug = params?.slug as string;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [host, setHost] = useState<HostMeta | null>(null);
  const [hostLoading, setHostLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [bookingState, setBookingState] = useState<BookingState>({ status: "idle" });

  const attendeeTz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );

  // Load host metadata
  useEffect(() => {
    if (!slug) return;
    void (async () => {
      try {
        const res = await fetch(`/api/book/${slug}`);
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = (await res.json()) as HostMeta;
        setHost(data);
      } catch {
        setNotFound(true);
      } finally {
        setHostLoading(false);
      }
    })();
  }, [slug]);

  // Fetch slots when date changes
  useEffect(() => {
    if (!selectedDate || !slug) return;
    setSelectedSlot(null);
    setSlotsLoading(true);
    void (async () => {
      try {
        const dateKey = formatDateKey(selectedDate);
        const res = await fetch(`/api/book/${slug}/availability?date=${dateKey}&tz=${attendeeTz}`);
        if (res.ok) {
          const data = (await res.json()) as AvailabilityResponse;
          setSlots(data.slots);
        } else {
          setSlots([]);
        }
      } catch {
        setSlots([]);
      } finally {
        setSlotsLoading(false);
      }
    })();
  }, [selectedDate, slug, attendeeTz]);

  async function submit() {
    if (!selectedSlot || !name.trim() || !email.trim()) return;
    setBookingState({ status: "submitting" });
    try {
      const res = await fetch(`/api/book/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attendee_name: name,
          attendee_email: email,
          attendee_phone: phone,
          start_time: selectedSlot,
          notes,
          timezone: attendeeTz,
          source: "public",
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; duration?: number };
      if (!res.ok) {
        setBookingState({ status: "error", message: data.error ?? "Failed to book" });
        return;
      }
      setBookingState({
        status: "success",
        startTime: selectedSlot,
        duration: data.duration ?? host?.duration ?? 30,
      });
    } catch {
      setBookingState({ status: "error", message: "Network error. Please try again." });
    }
  }

  if (hostLoading) {
    return (
      <main style={{ background: "#09090F", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#5A5A70", fontSize: "13px" }}>Loading…</span>
      </main>
    );
  }

  if (notFound || !host) {
    return (
      <main style={{ background: "#09090F", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#F0F0F8", fontSize: "14px", marginBottom: "6px", fontWeight: 600 }}>This booking page isn&apos;t available.</p>
          <p style={{ color: "#5A5A70", fontSize: "12px" }}>The link may have expired or scheduling may be turned off.</p>
        </div>
      </main>
    );
  }

  if (bookingState.status === "success") {
    const display = new Date(bookingState.startTime).toLocaleString("en-US", {
      weekday: "long", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit",
      timeZone: attendeeTz,
    });
    return (
      <main style={{ background: "#09090F", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div className="w-full max-w-md rounded-2xl px-8 py-10 text-center" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
          <div style={{ fontSize: "36px", marginBottom: "12px" }}>✅</div>
          <h1 className="text-xl font-bold mb-2" style={{ color: "#F0F0F8" }}>You&apos;re booked.</h1>
          <p className="text-sm mb-1" style={{ color: "#A07BFF" }}>{display}</p>
          <p className="text-sm" style={{ color: "#5A5A70" }}>{bookingState.duration} minutes with {host.business_name || "the team"}</p>
          <p className="text-xs mt-6" style={{ color: "#3A3A50" }}>You&apos;ll receive a calendar invite by email shortly.</p>
        </div>
      </main>
    );
  }

  const days = getMonthDays(viewYear, viewMonth);
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <main style={{ background: "#09090F", minHeight: "100vh", padding: "32px 16px" }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative z-10 max-w-3xl mx-auto">
        {/* Header */}
        <header className="mb-8 text-center">
          <div className="flex justify-center mb-4">
            <Image src="/logo-light.png" alt="STAFFD" width={80} height={36} style={{ objectFit: "contain" }} />
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#5B21E8" }}>Book a Call</p>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "#F0F0F8", letterSpacing: "-0.02em" }}>{host.business_name || "Schedule with us"}</h1>
          <p className="text-sm" style={{ color: "#5A5A70" }}>{host.duration} minutes · times shown in {attendeeTz}</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Calendar */}
          <div className="rounded-2xl p-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => {
                  if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
                  else setViewMonth(viewMonth - 1);
                }}
                className="text-sm transition-colors hover:text-white"
                style={{ color: "#5A5A70", background: "none", border: "none", cursor: "pointer" }}
              >
                ←
              </button>
              <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>{monthLabel}</p>
              <button
                onClick={() => {
                  if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
                  else setViewMonth(viewMonth + 1);
                }}
                className="text-sm transition-colors hover:text-white"
                style={{ color: "#5A5A70", background: "none", border: "none", cursor: "pointer" }}
              >
                →
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {["S","M","T","W","T","F","S"].map((d, i) => (
                <div key={i} className="text-center text-xs" style={{ color: "#3A3A50" }}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((d, i) => {
                const isPast = d.date < today;
                const isSelected = selectedDate?.getTime() === d.date.getTime();
                const isToday = d.date.getTime() === today.getTime();
                const disabled = isPast || !d.inMonth;
                return (
                  <button
                    key={i}
                    onClick={() => !disabled && setSelectedDate(d.date)}
                    disabled={disabled}
                    className="text-xs rounded-lg transition-all"
                    style={{
                      aspectRatio: "1",
                      background: isSelected ? "#5B21E8" : isToday ? "rgba(91,33,232,0.1)" : "transparent",
                      color: isSelected ? "#fff" : disabled ? "#2A2A38" : "#D0D0E8",
                      cursor: disabled ? "not-allowed" : "pointer",
                      fontWeight: isToday || isSelected ? 600 : 400,
                      border: isToday && !isSelected ? "1px solid rgba(91,33,232,0.35)" : "none",
                    }}
                  >
                    {d.date.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Slot picker */}
          <div className="rounded-2xl p-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
            {!selectedDate ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-center" style={{ color: "#3A3A50" }}>Pick a date to see available times.</p>
              </div>
            ) : slotsLoading ? (
              <p className="text-xs" style={{ color: "#5A5A70" }}>Loading times…</p>
            ) : slots.length === 0 ? (
              <p className="text-xs" style={{ color: "#5A5A70" }}>No times available on this day. Try another date.</p>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5B21E8" }}>
                  {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </p>
                <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto">
                  {slots.map((s) => {
                    const display = new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: attendeeTz });
                    const isSelected = selectedSlot === s;
                    return (
                      <button
                        key={s}
                        onClick={() => setSelectedSlot(s)}
                        className="px-3 py-2 rounded-lg text-sm font-medium transition-all"
                        style={{
                          background: isSelected ? "#5B21E8" : "#1A1A24",
                          border: isSelected ? "1px solid #5B21E8" : "1px solid #2A2A38",
                          color: isSelected ? "#fff" : "#D0D0E8",
                          cursor: "pointer",
                        }}
                      >
                        {display}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Booking form */}
        {selectedSlot && (
          <div className="mt-4 rounded-2xl p-6" style={{ background: "#111118", border: "1px solid rgba(91,33,232,0.3)" }}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "#5B21E8" }}>Your details</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" }}
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" }}
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (optional)"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" }}
              />
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What would you like to discuss?"
                rows={2}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none resize-none sm:col-span-2"
                style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" }}
              />
            </div>
            {bookingState.status === "error" && (
              <div className="mt-3 px-4 py-2.5 rounded-xl text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}>
                {bookingState.message}
              </div>
            )}
            <button
              onClick={() => void submit()}
              disabled={!name.trim() || !email.trim() || bookingState.status === "submitting"}
              className="mt-4 w-full px-6 py-3 rounded-xl text-sm font-semibold text-white"
              style={{
                background: "#5B21E8",
                opacity: name.trim() && email.trim() && bookingState.status !== "submitting" ? 1 : 0.4,
                cursor: name.trim() && email.trim() && bookingState.status !== "submitting" ? "pointer" : "not-allowed",
                border: "none",
              }}
            >
              {bookingState.status === "submitting" ? "Confirming…" : "Confirm booking →"}
            </button>
          </div>
        )}

        <footer className="mt-12 text-center text-xs" style={{ color: "#2A2A38" }}>
          Powered by STAFFD
        </footer>
      </div>
    </main>
  );
}
