"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import pb from "../../lib/pb";
import { exportToDocx } from "./DocExport";
import { getQuickActions } from "./agentQuickActions";
import UpgradeModal from "./UpgradeModal";
import { DEPARTMENT_CATEGORIES, type DeptCategory } from "../lib/departmentCategories";

// Departments that are always unlocked (starter pack)
const ALWAYS_UNLOCKED = new Set(["marketing", "sales", "legal"]);

// Plan → departments unlocked (mirrors server-side PLAN_DEPARTMENTS)
const PLAN_DEPARTMENTS: Record<string, Set<string>> = {
  starter: new Set(["marketing", "sales", "legal"]),
  growth:  new Set(["marketing", "sales", "legal", "hr"]),
  pro:     new Set(["marketing", "sales", "legal", "hr", "finance", "operations", "ceo"]),
  agency:  new Set(["marketing", "sales", "legal", "hr", "finance", "operations", "ceo", "paid-media", "design"]),
};

interface AgentMeta {
  id: string;
  name: string;
  department: string;
  description: string;
  emoji: string;
  color: string;
  tags: string[];
}

interface Template {
  id: string;
  name: string;
  content: string;
}

export interface DepartmentRoomConfig {
  department: string;
  icon: string;
  title: string;
  eyebrow?: string;
  tagline: string;
  placeholder: string;
  headerSlot?: React.ReactNode;
}

export default function DepartmentRoom({
  department,
  icon,
  title,
  eyebrow = "Department",
  tagline,
  placeholder,
  headerSlot,
}: DepartmentRoomConfig) {
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [activeAgent, setActiveAgent] = useState<AgentMeta | null>(null);
  const [task, setTask] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeChip, setActiveChip] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [integrationStatus, setIntegrationStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [integrationMsg, setIntegrationMsg] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [currentPlan, setCurrentPlan] = useState("starter");
  const [trialRemaining, setTrialRemaining] = useState<number | null>(null);
  const [activeCategory, setActiveCategory] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);
  const rosterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadAgents();
    void loadContext();
    void loadTrialStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department]);

  async function loadAgents() {
    try {
      const res = await fetch(`/api/agents/${department}`);
      if (!res.ok) return;
      const data = (await res.json()) as AgentMeta[];
      setAgents(data);

      const cats = DEPARTMENT_CATEGORIES[department] ?? [];
      if (cats.length > 0) {
        const firstCat = cats[0]!;
        setActiveCategory(firstCat.id);
        const firstAgent = data.find(a => firstCat.agentIds.includes(a.id)) ?? data[0] ?? null;
        setActiveAgent(firstAgent);
      } else {
        if (data.length > 0) setActiveAgent(data[0] ?? null);
      }
    } catch { /* proceed */ }
  }

  function selectCategory(cat: DeptCategory) {
    setActiveCategory(cat.id);
    setActiveChip("");
    setTask("");
    setOutput("");
    setError("");
    setSelectedTemplate(null);
    const firstAgent = agents.find(a => cat.agentIds.includes(a.id)) ?? null;
    if (firstAgent) setActiveAgent(firstAgent);
  }

  async function loadContext() {
    if (!pb.authStore.isValid) return;
    const userId = pb.authStore.record?.id ?? "";
    const pbToken = pb.authStore.token;

    try {
      const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL ?? "";
      const res = await fetch(
        `${pbUrl}/api/collections/businesses/records?filter=(user='${userId}')&perPage=1`,
        { headers: { Authorization: pbToken } }
      );
      const data = (await res.json()) as { items?: Array<Record<string, unknown>> };
      const rec = data.items?.[0];
      if (rec) {
        setBusinessName((rec.business_name as string) ?? "");
        if (rec.logo && rec.id && rec.collectionId) {
          setLogoUrl(`${pbUrl}/api/files/${rec.collectionId as string}/${rec.id as string}/${rec.logo as string}`);
        }
      }
    } catch { /* proceed */ }

    try {
      const res = await pb.collection("templates").getList(1, 50, {
        filter: `user = '${userId}'`,
        sort: "name",
      });
      setTemplates(
        res.items.map((t) => ({
          id: t.id,
          name: t.name as string,
          content: t.content as string,
        }))
      );
    } catch { /* proceed */ }
  }

  async function loadTrialStatus() {
    if (!pb.authStore.isValid) return;
    const userId = pb.authStore.record?.id ?? "";
    if (!userId || ALWAYS_UNLOCKED.has(department)) return;
    try {
      const res = await fetch(`/api/trial?userId=${userId}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        plan: string;
        trial_runs: Record<string, number>;
        resolved_departments: string[];
      };
      const plan = data.plan ?? "starter";
      setCurrentPlan(plan);
      // Use server-resolved department list (respects user's chosen departments)
      const resolved = new Set(data.resolved_departments ?? []);
      if (resolved.has(department)) {
        setTrialRemaining(null); // fully unlocked
      } else {
        const used = data.trial_runs?.[department] ?? 0;
        setTrialRemaining(Math.max(0, 3 - used));
      }
    } catch { /* proceed */ }
  }

  async function run(customTask?: string) {
    const finalTask = (customTask ?? task).trim();
    if (!finalTask || loading) return;

    setOutput("");
    setError("");
    setLoading(true);
    setIntegrationStatus("idle");
    setIntegrationMsg("");

    const userId = pb.authStore.record?.id ?? "";
    const pbToken = pb.authStore.token;

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: finalTask,
          department,
          agentId: activeAgent?.id,
          userId,
          pbToken,
          templateContent: selectedTemplate?.content ?? undefined,
        }),
      });

      if (res.status === 429) {
        setError("Daily generation limit reached. Limit resets in 24 hours.");
        return;
      }
      if (res.status === 402) {
        const data = (await res.json()) as { error: string; plan: string };
        setCurrentPlan(data.plan ?? "starter");
        setTrialRemaining(0);
        setShowUpgrade(true);
        return;
      }
      if (!res.ok) throw new Error("Agent request failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response stream");

      let result = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
        setOutput(result);
        outputRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }

      void saveDocument(finalTask, result, userId);
      // Decrement local trial counter (server already recorded the run)
      setTrialRemaining(prev => prev !== null ? Math.max(0, prev - 1) : null);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function saveDocument(prompt: string, content: string, userId: string) {
    try {
      await pb.collection("documents").create({
        user: userId,
        department,
        agent_name: activeAgent?.name ?? department,
        prompt,
        output: content,
      });
    } catch { /* proceed */ }
  }

  function selectAgent(agent: AgentMeta) {
    setActiveAgent(agent);
    setActiveChip("");
    setTask("");
    setOutput("");
    setError("");
    setSelectedTemplate(null);
  }

  async function sendCampaign() {
    if (!output || integrationStatus === "sending") return;
    setIntegrationStatus("sending");
    setIntegrationMsg("");
    try {
      const res = await fetch("/api/integrations/listmonk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: task.slice(0, 80) || "Campaign", body: output }),
      });
      const data = (await res.json()) as { campaignUrl?: string; message?: string; error?: string };
      if (res.status === 503) {
        setIntegrationMsg("Email sending not configured. Add LISTMONK_URL to your environment to enable this.");
        setIntegrationStatus("error");
      } else if (!res.ok) {
        setIntegrationStatus("error");
        setIntegrationMsg("Failed to create campaign.");
      } else {
        setIntegrationStatus("sent");
        setIntegrationMsg(data.campaignUrl ? `Draft saved → ${data.campaignUrl}` : "Campaign draft created.");
      }
    } catch {
      setIntegrationStatus("error");
      setIntegrationMsg("Failed to reach email service.");
    }
  }

  async function scheduleCall() {
    if (!output || integrationStatus === "sending") return;
    const email = prompt("Prospect's email address:");
    if (!email?.trim()) return;
    const name = prompt("Prospect's name (optional):") ?? "";
    setIntegrationStatus("sending");
    setIntegrationMsg("");
    try {
      const res = await fetch("/api/integrations/cal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeEmail: email.trim(), attendeeName: name || undefined, notes: task }),
      });
      const data = (await res.json()) as { bookingUrl?: string; message?: string; error?: string };
      if (res.status === 503) {
        setIntegrationMsg("Scheduling not configured. Add CAL_API_URL and CAL_API_KEY to your environment.");
        setIntegrationStatus("error");
      } else if (!res.ok) {
        setIntegrationStatus("error");
        setIntegrationMsg("Failed to schedule call.");
      } else {
        setIntegrationStatus("sent");
        setIntegrationMsg(data.bookingUrl ? `Booking created → ${data.bookingUrl}` : "Call scheduled.");
      }
    } catch {
      setIntegrationStatus("error");
      setIntegrationMsg("Failed to reach scheduling service.");
    }
  }

  async function addToCRM() {
    if (!output || integrationStatus === "sending") return;
    const name = prompt("Contact or company name:");
    if (!name?.trim()) return;
    const email = prompt("Email (optional):") ?? "";
    setIntegrationStatus("sending");
    setIntegrationMsg("");
    try {
      const res = await fetch("/api/integrations/twenty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "contact", name: name.trim(), email: email.trim() || undefined, notes: task }),
      });
      const data = (await res.json()) as { crmUrl?: string; message?: string; error?: string };
      if (res.status === 503) {
        setIntegrationMsg("CRM not configured. Add TWENTY_API_URL and TWENTY_API_KEY to your environment.");
        setIntegrationStatus("error");
      } else if (!res.ok) {
        setIntegrationStatus("error");
        setIntegrationMsg("Failed to add to CRM.");
      } else {
        setIntegrationStatus("sent");
        setIntegrationMsg(data.crmUrl ? `Added to CRM → ${data.crmUrl}` : "Added to CRM.");
      }
    } catch {
      setIntegrationStatus("error");
      setIntegrationMsg("Failed to reach CRM.");
    }
  }

  async function sendForSignature() {
    if (!output || integrationStatus === "sending") return;
    const email = prompt("Signer's email address:");
    if (!email?.trim()) return;
    setIntegrationStatus("sending");
    setIntegrationMsg("");
    try {
      const res = await fetch("/api/integrations/docuseal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: task.slice(0, 80) || "Document", documentContent: output, signerEmail: email.trim() }),
      });
      const data = (await res.json()) as { signingUrl?: string; message?: string; error?: string };
      if (res.status === 503) {
        setIntegrationMsg("E-signatures not configured. Add DOCUSEAL_URL to your environment to enable this.");
        setIntegrationStatus("error");
      } else if (!res.ok) {
        setIntegrationStatus("error");
        setIntegrationMsg("Failed to send for signature.");
      } else {
        setIntegrationStatus("sent");
        setIntegrationMsg(data.signingUrl ? `Sent → ${data.signingUrl}` : "Sent for signature.");
      }
    } catch {
      setIntegrationStatus("error");
      setIntegrationMsg("Failed to reach signature service.");
    }
  }

  function handleQuickAction(prompt: string, label: string) {
    setActiveChip(label);
    setTask(prompt);
    void run(prompt);
  }

  const quickActions = activeAgent ? getQuickActions(activeAgent.id) : [];

  // Category tab derived values
  const categories = DEPARTMENT_CATEGORIES[department] ?? [];
  const activeCategoryDef = categories.find(c => c.id === activeCategory) ?? categories[0] ?? null;
  const activeCategoryAgents = activeCategoryDef
    ? agents.filter(a => activeCategoryDef.agentIds.includes(a.id))
    : [];

  return (
    <main className="min-h-screen flex flex-col no-print-chrome" style={{ background: "#09090F" }}>
      {/* Grid bg */}
      <div
        className="fixed inset-0 pointer-events-none no-print"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />
      <div
        className="fixed pointer-events-none no-print"
        style={{
          top: "-150px", left: "50%", transform: "translateX(-50%)",
          width: "700px", height: "500px", borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(91,33,232,0.1) 0%, transparent 65%)",
        }}
      />

      {/* Print header */}
      <div className="print-only print-header">
        {logoUrl && <img src={logoUrl} alt={businessName} className="print-logo" />}
        {businessName && !logoUrl && <span className="print-biz-name">{businessName}</span>}
        <div className="print-divider" />
      </div>

      <div className="relative z-10 w-full max-w-4xl mx-auto px-6 py-8 flex flex-col flex-1">

        {/* Nav */}
        <header className="flex items-center justify-between mb-10 no-print">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
          <div className="flex items-center gap-5">
            <a href="/dashboard/library" className="text-xs transition-colors hover:text-white" style={{ color: "#3A3A55" }}>
              Library
            </a>
            <a href="/dashboard" className="text-sm transition-colors hover:text-white" style={{ color: "#5A5A70" }}>
              ← Dashboard
            </a>
          </div>
        </header>

        {/* Dept header */}
        <div className="mb-7 no-print">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
              style={{ background: "rgba(91,33,232,0.15)", border: "1px solid rgba(91,33,232,0.25)" }}
            >
              {icon}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: "#5B21E8" }}>
                {eyebrow}
              </p>
              <h1 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.4rem", lineHeight: 1.2, letterSpacing: "-0.01em" }}>
                {title}
              </h1>
            </div>
          </div>
          <p className="text-sm" style={{ color: "#6060A0" }}>{tagline}</p>
        </div>

        {/* Optional header slot — used by CEO for briefings, etc. */}
        {headerSlot}

        {/* ── Option B: Category tabs + capability panel ── */}
        {categories.length > 0 ? (
          <div className="mb-5 no-print">
            {/* Tab row */}
            <div
              className="flex gap-2 overflow-x-auto pb-1 mb-4"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {categories.map((cat) => {
                const isActive = (activeCategoryDef?.id ?? "") === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => selectCategory(cat)}
                    className="flex-shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
                    style={{
                      background: isActive ? "rgba(91,33,232,0.15)" : "#111118",
                      border: isActive ? "1px solid rgba(91,33,232,0.5)" : "1px solid #2A2A38",
                      color: isActive ? "#A07BFF" : "#6060A0",
                      cursor: "pointer",
                    }}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>

            {/* Capability panel */}
            {activeCategoryDef && (
              <div className="rounded-2xl p-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                <p className="text-sm font-medium mb-3" style={{ color: "#D0D0E8", lineHeight: 1.45 }}>
                  {activeCategoryDef.tagline}
                </p>

                <ul className="flex flex-col gap-1.5 mb-4">
                  {activeCategoryDef.capabilities.map((c) => (
                    <li key={c} className="flex items-start gap-2 text-xs" style={{ color: "#6060A0" }}>
                      <span style={{ color: "#5B21E8", flexShrink: 0, marginTop: "2px" }}>·</span>
                      {c}
                    </li>
                  ))}
                  {activeCategoryDef.integrationFeatures?.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs font-medium" style={{ color: "#7B5CE8" }}>
                      <span style={{ flexShrink: 0, marginTop: "2px" }}>→</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* Specialist chips */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs flex-shrink-0" style={{ color: "#3A3A50" }}>Specialists</span>
                  {activeCategoryAgents.length === 0
                    ? Array.from({ length: 2 }).map((_, i) => (
                        <div
                          key={i}
                          className="rounded-full animate-pulse"
                          style={{ width: "90px", height: "26px", background: "#1A1A24", border: "1px solid #2A2A38" }}
                        />
                      ))
                    : activeCategoryAgents.map((agent) => {
                        const isActive = activeAgent?.id === agent.id;
                        return (
                          <button
                            key={agent.id}
                            onClick={() => selectAgent(agent)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all"
                            style={{
                              background: isActive ? "rgba(91,33,232,0.2)" : "rgba(255,255,255,0.03)",
                              border: isActive ? "1px solid rgba(91,33,232,0.4)" : "1px solid #2A2A38",
                              color: isActive ? "#A07BFF" : "#5A5A70",
                              cursor: "pointer",
                            }}
                          >
                            <span>{agent.emoji}</span>
                            <span>{agent.name}</span>
                          </button>
                        );
                      })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Fallback: classic agent roster for any dept without categories */
          <div className="mb-7 no-print" ref={rosterRef}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#3A3A50" }}>
              Specialists
            </p>
            <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
              {agents.length === 0
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex-shrink-0 rounded-xl animate-pulse"
                      style={{ width: "160px", height: "92px", background: "#111118", border: "1px solid #1E1E2A" }} />
                  ))
                : agents.map((agent) => {
                    const isActive = activeAgent?.id === agent.id;
                    return (
                      <button key={agent.id} onClick={() => selectAgent(agent)}
                        className="flex-shrink-0 rounded-xl p-3.5 text-left transition-all"
                        style={{ width: "168px", background: isActive ? "rgba(91,33,232,0.12)" : "#111118",
                          border: isActive ? "1px solid rgba(91,33,232,0.5)" : "1px solid #2A2A38",
                          boxShadow: isActive ? "0 0 18px rgba(91,33,232,0.15)" : "none", cursor: "pointer" }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">{agent.emoji}</span>
                          {isActive && (
                            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                              style={{ background: "rgba(91,33,232,0.25)", color: "#A07BFF", fontSize: "9px" }}>ACTIVE</span>
                          )}
                        </div>
                        <p className="text-xs font-semibold mb-1" style={{ color: isActive ? "#E0D0FF" : "#D0D0E8" }}>{agent.name}</p>
                        <p className="text-xs leading-snug" style={{ color: isActive ? "#7060A0" : "#404058", fontSize: "10px" }}>
                          {agent.description.length > 68 ? agent.description.slice(0, 65) + "…" : agent.description}
                        </p>
                      </button>
                    );
                  })}
            </div>
          </div>
        )}

        {/* Active agent quick actions */}
        {activeAgent && (
          <div className="flex flex-wrap gap-2 mb-3 no-print">
            {quickActions.map((a) => (
              <button
                key={a.label}
                onClick={() => handleQuickAction(a.prompt, a.label)}
                disabled={loading}
                className="px-3.5 py-1.5 rounded-full text-xs font-medium transition-all"
                style={{
                  background: activeChip === a.label ? "rgba(91,33,232,0.2)" : "#111118",
                  border: activeChip === a.label ? "1px solid rgba(91,33,232,0.45)" : "1px solid #2A2A38",
                  color: activeChip === a.label ? "#A07BFF" : "#9090A8",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.5 : 1,
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}

        {/* Trial usage indicator — shown for locked departments */}
        {trialRemaining !== null && (
          <div className="flex items-center gap-2 mb-3 no-print">
            {trialRemaining > 0 ? (
              <p className="text-xs" style={{ color: "#5A5A70" }}>
                <span style={{ color: "#A07BFF" }}>{trialRemaining}</span> trial {trialRemaining === 1 ? "run" : "runs"} remaining in this department —{" "}
                <button
                  onClick={() => setShowUpgrade(true)}
                  className="transition-colors hover:text-white"
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#5B21E8", fontSize: "inherit" }}
                >
                  upgrade to unlock →
                </button>
              </p>
            ) : (
              <p className="text-xs" style={{ color: "#5A5A70" }}>
                Trial runs used —{" "}
                <button
                  onClick={() => setShowUpgrade(true)}
                  className="transition-colors hover:text-white"
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#5B21E8", fontSize: "inherit" }}
                >
                  upgrade to keep going →
                </button>
              </p>
            )}
          </div>
        )}

        {/* Template picker */}
        {templates.length > 0 && (
          <div className="relative flex items-center gap-2 mb-4 no-print">
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                background: selectedTemplate ? "rgba(91,33,232,0.2)" : "#111118",
                border: selectedTemplate ? "1px solid rgba(91,33,232,0.45)" : "1px solid #2A2A38",
                color: selectedTemplate ? "#A07BFF" : "#6060A0",
              }}
            >
              📄 {selectedTemplate ? selectedTemplate.name : "Use a template"}
              <span style={{ opacity: 0.6 }}>{showTemplates ? "▲" : "▼"}</span>
            </button>
            {selectedTemplate && (
              <button
                onClick={() => { setSelectedTemplate(null); setShowTemplates(false); }}
                className="text-xs transition-colors hover:text-white"
                style={{ color: "#3A3A55" }}
              >
                ✕ remove
              </button>
            )}
            {showTemplates && (
              <div
                className="absolute top-8 left-0 z-20 rounded-xl overflow-hidden shadow-xl"
                style={{ background: "#1A1A24", border: "1px solid #2A2A38", minWidth: "220px" }}
              >
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedTemplate(t); setShowTemplates(false); }}
                    className="w-full text-left px-4 py-2.5 text-xs transition-colors hover:bg-purple-900/20"
                    style={{ color: "#D0D0E8", borderBottom: "1px solid #2A2A38" }}
                  >
                    {t.name}
                  </button>
                ))}
                <a
                  href="/dashboard/templates"
                  className="block w-full text-left px-4 py-2.5 text-xs transition-colors hover:bg-purple-900/20"
                  style={{ color: "#5B21E8" }}
                >
                  + Manage templates →
                </a>
              </div>
            )}
          </div>
        )}

        {/* Input */}
        <div className="rounded-2xl overflow-hidden mb-5 no-print" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
          <textarea
            value={task}
            onChange={(e) => { setTask(e.target.value); setActiveChip(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run(); }}
            placeholder={activeAgent ? `Ask ${activeAgent.name} — ${placeholder}` : placeholder}
            rows={4}
            className="w-full px-5 py-4 text-sm outline-none resize-none"
            style={{ background: "transparent", color: "#F0F0F8", lineHeight: "1.7", caretColor: "#5B21E8" }}
          />
          <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid #1E1E2A" }}>
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: "#2E2E45" }}>⌘ Enter to run</span>
              {activeAgent && (
                <span className="text-xs" style={{ color: "#3A3A55" }}>
                  {activeAgent.emoji} {activeAgent.name}
                </span>
              )}
            </div>
            <button
              onClick={() => void run()}
              disabled={!task.trim() || loading}
              className="btn-primary px-5 py-2 rounded-xl text-sm font-semibold text-white"
              style={{
                opacity: !task.trim() || loading ? 0.35 : 1,
                cursor: !task.trim() || loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Working…" : "Generate →"}
            </button>
          </div>
        </div>

        {error && (
          <div
            className="px-4 py-3 rounded-xl text-xs mb-4 no-print"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}
          >
            {error}
          </div>
        )}

        {/* Output */}
        {(output || loading) && (
          <div ref={outputRef} className="rounded-2xl overflow-hidden flex-1" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
            <div className="flex items-center justify-between px-5 py-3 no-print" style={{ borderBottom: "1px solid #1E1E2A" }}>
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center text-sm" style={{ background: "rgba(91,33,232,0.15)" }}>
                  {activeAgent?.emoji ?? icon}
                </div>
                <span className="text-xs font-semibold" style={{ color: "#9090A8" }}>
                  {activeAgent?.name ?? title}
                </span>
                {loading && (
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: "#5A5A70" }}>
                    <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#5B21E8" }} />
                    writing
                  </span>
                )}
              </div>
              {output && !loading && (
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => void navigator.clipboard.writeText(output)}
                    className="text-xs transition-colors hover:text-white"
                    style={{ color: "#5A5A70" }}
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="text-xs transition-colors hover:text-white"
                    style={{ color: "#5A5A70" }}
                  >
                    Save PDF
                  </button>
                  <button
                    onClick={() => void exportToDocx(output, businessName || undefined)}
                    className="text-xs transition-colors hover:text-white"
                    style={{ color: "#5A5A70" }}
                  >
                    Download .docx
                  </button>
                  {department === "marketing" && (
                    <button
                      onClick={() => void sendCampaign()}
                      disabled={integrationStatus === "sending"}
                      className="text-xs transition-colors hover:text-white"
                      style={{ color: integrationStatus === "sent" ? "#22C55E" : integrationStatus === "error" ? "#F59E0B" : "#5A5A70" }}
                    >
                      {integrationStatus === "sending" ? "Sending…" : integrationStatus === "sent" ? "Campaign saved ✓" : "Send as Campaign"}
                    </button>
                  )}
                  {(department === "legal" || department === "sales") && (
                    <button
                      onClick={() => void sendForSignature()}
                      disabled={integrationStatus === "sending"}
                      className="text-xs transition-colors hover:text-white"
                      style={{ color: integrationStatus === "sent" ? "#22C55E" : integrationStatus === "error" ? "#F59E0B" : "#5A5A70" }}
                    >
                      {integrationStatus === "sending" ? "Sending…" : integrationStatus === "sent" ? "Sent ✓" : "Send for Signature"}
                    </button>
                  )}
                  {department === "sales" && (
                    <button
                      onClick={() => void scheduleCall()}
                      disabled={integrationStatus === "sending"}
                      className="text-xs transition-colors hover:text-white"
                      style={{ color: integrationStatus === "sent" ? "#22C55E" : integrationStatus === "error" ? "#F59E0B" : "#5A5A70" }}
                    >
                      {integrationStatus === "sending" ? "Sending…" : "Schedule Call"}
                    </button>
                  )}
                  {department === "sales" && (
                    <button
                      onClick={() => void addToCRM()}
                      disabled={integrationStatus === "sending"}
                      className="text-xs transition-colors hover:text-white"
                      style={{ color: integrationStatus === "sent" ? "#22C55E" : integrationStatus === "error" ? "#F59E0B" : "#5A5A70" }}
                    >
                      {integrationStatus === "sending" ? "Saving…" : "Add to CRM"}
                    </button>
                  )}
                </div>
              )}
            </div>
            {integrationMsg && (
              <div
                className="px-5 py-2.5 text-xs"
                style={{
                  borderBottom: "1px solid #1E1E2A",
                  color: integrationStatus === "sent" ? "#22C55E" : "#F59E0B",
                  background: integrationStatus === "sent" ? "rgba(34,197,94,0.05)" : "rgba(245,158,11,0.05)",
                }}
              >
                {integrationMsg}
              </div>
            )}
            <div className="px-6 py-5">
              {loading ? (
                <div className="text-sm whitespace-pre-wrap" style={{ color: "#D0D0E8", lineHeight: "1.8" }}>
                  {output}
                  <span
                    className="inline-block w-0.5 h-4 ml-0.5 animate-pulse"
                    style={{ background: "#5B21E8", verticalAlign: "middle" }}
                  />
                </div>
              ) : (
                <div className="agent-output">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        {!output && !loading && (
          <div className="mt-auto pt-8 pb-4 no-print">
            <div className="flex items-center justify-between">
              <a
                href="/dashboard/vault"
                className="flex items-center gap-3 text-xs group"
                style={{ color: "#3A3A55", textDecoration: "none" }}
              >
                <span>🔐</span>
                <span className="group-hover:text-purple-400 transition-colors">
                  Add your business details to the Vault and your AI team will use them automatically →
                </span>
              </a>
              {templates.length === 0 && (
                <a
                  href="/dashboard/templates"
                  className="text-xs ml-4 flex-shrink-0 transition-colors hover:text-purple-400"
                  style={{ color: "#3A3A55" }}
                >
                  + Templates
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Upgrade modal — triggered on trial exhaustion or manual upgrade click */}
      {showUpgrade && (
        <UpgradeModal
          department={department}
          currentPlan={currentPlan}
          onClose={() => setShowUpgrade(false)}
        />
      )}
    </main>
  );
}
