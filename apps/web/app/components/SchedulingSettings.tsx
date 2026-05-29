"use client";

import { useEffect, useState } from "react";
import pb from "../../lib/pb";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type DayKey = typeof DAY_KEYS[number];

const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

type Availability = Partial<Record<DayKey, [string, string][]>>;

interface BusinessRecord {
  id: string;
  booking_slug?: string;
  booking_timezone?: string;
  booking_availability?: Availability;
  booking_default_duration?: number;
  booking_buffer?: number;
  booking_enabled?: boolean;
}

function defaultAvailability(): Availability {
  return {
    mon: [["09:00", "17:00"]],
    tue: [["09:00", "17:00"]],
    wed: [["09:00", "17:00"]],
    thu: [["09:00", "17:00"]],
    fri: [["09:00", "17:00"]],
  };
}

export default function SchedulingSettings() {
  const [bizId, setBizId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [duration, setDuration] = useState(30);
  const [buffer, setBuffer] = useState(0);
  const [availability, setAvailability] = useState<Availability>(defaultAvailability());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      // Ensure the bookings schema migration has been run
      void fetch("/api/setup/bookings", { method: "POST" }).catch(() => null);

      const userId = pb.authStore.record?.id ?? "";
      if (!userId) return;
      const res = await pb.collection("businesses").getList(1, 1, { filter: `user = '${userId}'` });
      const rec = res.items[0] as unknown as BusinessRecord | undefined;
      if (rec) {
        setBizId(rec.id);
        setEnabled(rec.booking_enabled ?? false);
        setSlug(rec.booking_slug ?? "");
        setTimezone(rec.booking_timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
        setDuration(rec.booking_default_duration ?? 30);
        setBuffer(rec.booking_buffer ?? 0);
        const avail = rec.booking_availability;
        if (avail && Object.keys(avail).length > 0) {
          setAvailability(avail);
        }
      }
    } catch {
      // proceed
    } finally {
      setLoading(false);
    }
  }

  function toggleDay(day: DayKey) {
    setAvailability((prev) => {
      const next = { ...prev };
      if (next[day]) delete next[day];
      else next[day] = [["09:00", "17:00"]];
      return next;
    });
  }

  function updateWindow(day: DayKey, index: number, field: 0 | 1, value: string) {
    setAvailability((prev) => {
      const windows = prev[day] ? [...prev[day]!] : [];
      const tuple: [string, string] = windows[index] ? [...windows[index]!] as [string, string] : ["09:00", "17:00"];
      tuple[field] = value;
      windows[index] = tuple;
      return { ...prev, [day]: windows };
    });
  }

  async function save() {
    if (!bizId) {
      setMsg({ text: "Save your Business Vault first before enabling scheduling.", ok: false });
      return;
    }
    const slugClean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/(^-|-$)/g, "");
    if (enabled && !slugClean) {
      setMsg({ text: "A booking URL slug is required when scheduling is on.", ok: false });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await pb.collection("businesses").update(bizId, {
        booking_enabled: enabled,
        booking_slug: slugClean,
        booking_timezone: timezone,
        booking_default_duration: duration,
        booking_buffer: buffer,
        booking_availability: availability,
      });
      setSlug(slugClean);
      setMsg({ text: enabled ? "Scheduling is live. Share your booking link." : "Scheduling saved.", ok: true });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Failed to save.";
      // PocketBase will reject duplicate slugs if a unique index is set — explain
      setMsg({ text: detail.includes("unique") ? "That slug is already taken — try another." : "Failed to save. Try again.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  const bookingUrl = slug ? `${origin}/book/${slug}` : "";

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "12px", fontWeight: 500, marginBottom: "6px", color: "#9090A8",
  };
  const inputStyle: React.CSSProperties = {
    background: "#0D0D14", border: "1px solid #2A2A38", color: "#F0F0F8",
    borderRadius: "12px", padding: "10px 14px", fontSize: "14px", outline: "none", width: "100%",
  };

  if (loading) {
    return (
      <section className="rounded-2xl p-6 mb-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
        <p className="text-xs" style={{ color: "#5A5A70" }}>Loading scheduling…</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl p-6 mb-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold mb-1" style={{ color: "#F0F0F8" }}>Scheduling</h2>
          <p className="text-xs" style={{ color: "#5A5A70" }}>Let people book calls with you — built in, no extra service needed.</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer" style={{ marginTop: "2px" }}>
          <span className="text-xs" style={{ color: "#9090A8" }}>{enabled ? "On" : "Off"}</span>
          <span
            onClick={() => setEnabled(!enabled)}
            style={{
              display: "inline-block",
              width: "32px", height: "18px", borderRadius: "10px",
              background: enabled ? "#5B21E8" : "#2A2A38",
              position: "relative", transition: "background 0.2s",
            }}
          >
            <span style={{
              position: "absolute", top: "2px", left: enabled ? "16px" : "2px",
              width: "14px", height: "14px", borderRadius: "50%",
              background: "#fff", transition: "left 0.2s",
            }} />
          </span>
        </label>
      </div>

      {enabled && (
        <>
          {/* URL slug */}
          <div className="mb-4">
            <label style={labelStyle}>Your booking URL</label>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: "#5A5A70", whiteSpace: "nowrap" }}>{origin}/book/</span>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="your-name"
                style={inputStyle}
              />
            </div>
            {bookingUrl && (
              <p className="text-xs mt-2" style={{ color: "#5A5A70" }}>
                Public link: <a href={bookingUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#A07BFF" }}>{bookingUrl}</a>
              </p>
            )}
          </div>

          {/* Duration + buffer */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label style={labelStyle}>Call duration (minutes)</label>
              <select
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value, 10))}
                style={inputStyle}
              >
                {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Buffer between calls (minutes)</label>
              <select
                value={buffer}
                onChange={(e) => setBuffer(parseInt(e.target.value, 10))}
                style={inputStyle}
              >
                {[0, 5, 10, 15, 30].map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
          </div>

          {/* Timezone */}
          <div className="mb-5">
            <label style={labelStyle}>Your timezone</label>
            <input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="e.g. America/New_York"
              style={inputStyle}
            />
            <p className="text-xs mt-1.5" style={{ color: "#3A3A50" }}>IANA timezone — your visitors&apos; calendars will show local times.</p>
          </div>

          {/* Availability */}
          <div className="mb-2">
            <label style={labelStyle}>Available days &amp; hours</label>
            <div className="flex flex-col gap-2">
              {DAY_KEYS.map((day) => {
                const windows = availability[day];
                const active = !!windows && windows.length > 0;
                return (
                  <div key={day} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "#0D0D14", border: "1px solid #2A2A38" }}>
                    <button
                      onClick={() => toggleDay(day)}
                      style={{
                        width: "18px", height: "18px", borderRadius: "4px",
                        background: active ? "#5B21E8" : "transparent",
                        border: active ? "1px solid #5B21E8" : "1px solid #3A3A50",
                        color: "#fff", fontSize: "11px",
                        cursor: "pointer",
                      }}
                    >
                      {active ? "✓" : ""}
                    </button>
                    <span className="text-xs w-20" style={{ color: active ? "#D0D0E8" : "#5A5A70" }}>{DAY_LABELS[day]}</span>
                    {active && windows && windows.map((w, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="time"
                          value={w[0]}
                          onChange={(e) => updateWindow(day, i, 0, e.target.value)}
                          style={{ ...inputStyle, padding: "6px 10px", fontSize: "12px", width: "auto" }}
                        />
                        <span className="text-xs" style={{ color: "#5A5A70" }}>→</span>
                        <input
                          type="time"
                          value={w[1]}
                          onChange={(e) => updateWindow(day, i, 1, e.target.value)}
                          style={{ ...inputStyle, padding: "6px 10px", fontSize: "12px", width: "auto" }}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Save */}
      <div className="flex items-center justify-between mt-5">
        {msg && (
          <p className="text-xs" style={{ color: msg.ok ? "#22C55E" : "#EF4444" }}>{msg.text}</p>
        )}
        <button
          onClick={() => void save()}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white ml-auto"
          style={{ background: "#5B21E8", border: "none", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : "Save scheduling"}
        </button>
      </div>
    </section>
  );
}
