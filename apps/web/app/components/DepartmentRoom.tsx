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

// Plan → departments unlocked (mirrors server-side resolveUnlocked).
// Note: client-side fallback only — server's resolved_departments is the source of truth.
const PLAN_DEPARTMENTS: Record<string, Set<string>> = {
  starter: new Set(["marketing", "sales", "legal"]),
  growth:  new Set(["marketing", "sales", "legal", "hr"]),
  pro:     new Set(["marketing", "sales", "legal", "hr", "finance", "operations", "ceo"]),
  agency:  new Set(["marketing", "sales", "legal", "hr", "finance", "operations", "ceo", "paid-media", "design", "reputation"]),
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
  const [savedDocId, setSavedDocId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showTeamDrawer, setShowTeamDrawer] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageRatio, setImageRatio] = useState<"1:1" | "16:9" | "9:16" | "4:3">("1:1");
  const [imageError, setImageError] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [creditsRemaining, setCreditsRemaining] = useState<{ image: number; video: number } | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const rosterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadAgents();
    void loadContext();
    void loadTrialStatus();
    void loadCreditsState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department]);

  async function loadCreditsState() {
    if (!pb.authStore.isValid) return;
    const userId = pb.authStore.record?.id ?? "";
    if (!userId) return;
    try {
      const res = await fetch(`/api/credits?userId=${userId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { totalRemaining?: { image: number; video: number } };
      if (data.totalRemaining) setCreditsRemaining(data.totalRemaining);
    } catch { /* proceed */ }
  }

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
    setSavedDocId(null);
    setLinkCopied(false);
    setImageUrl(null);
    setImageError("");
    setVideoUrl(null);
    setVideoError("");

    const userId = pb.authStore.record?.id ?? "";
    const pbToken = pb.authStore.token;

    // Agency mode — include the active client so the staff produces work for them
    const activeClientId = typeof window !== "undefined"
      ? localStorage.getItem("staffd_active_client")
      : null;

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
          clientId: activeClientId ?? undefined,
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
      const activeClientId = typeof window !== "undefined"
        ? localStorage.getItem("staffd_active_client")
        : null;
      const rec = await pb.collection("documents").create({
        user: userId,
        department,
        agent_name: activeAgent?.name ?? department,
        prompt,
        output: content,
        client: activeClientId ?? "",
      });
      setSavedDocId(rec.id);
    } catch { /* proceed */ }
  }

  async function copyShareLink() {
    if (!savedDocId) return;
    const url = `${window.location.origin}/doc/${savedDocId}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
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

    // Copies the user's STAFFD booking link so they can paste it into the outreach.
    // Nudges them to enable Scheduling in Settings if no link is configured yet.
    try {
      const userId = pb.authStore.record?.id ?? "";
      const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL ?? "";
      const res = await fetch(
        `${pbUrl}/api/collections/businesses/records?filter=(user='${userId}')&perPage=1`,
        { headers: { Authorization: pb.authStore.token } }
      );
      const data = (await res.json()) as { items?: Array<{ booking_slug?: string; booking_enabled?: boolean }> };
      const biz = data.items?.[0];
      if (biz?.booking_enabled && biz.booking_slug) {
        const url = `${window.location.origin}/book/${biz.booking_slug}`;
        await navigator.clipboard.writeText(url);
        setIntegrationStatus("sent");
        setIntegrationMsg(`Booking link copied — paste into the outreach: ${url}`);
      } else {
        setIntegrationStatus("error");
        setIntegrationMsg("Turn on Scheduling in Settings first to get your public booking link.");
      }
    } catch {
      setIntegrationStatus("error");
      setIntegrationMsg("Couldn't load your booking settings. Try again.");
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

  async function generateImage() {
    if (!output || imageLoading) return;
    const userId = pb.authStore.record?.id ?? "";
    if (!userId) return;
    setImageLoading(true);
    setImageError("");
    setImageUrl(null);
    try {
      const res = await fetch("/api/integrations/muapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, kind: "image", prompt: output, aspectRatio: imageRatio }),
      });
      const data = (await res.json()) as { url?: string; message?: string; error?: string; remaining?: number };
      if (res.status === 503) {
        setImageError(data.message ?? "Image generation not configured.");
      } else if (res.status === 402) {
        setImageError(data.message ?? "Out of image credits this month.");
      } else if (!res.ok || !data.url) {
        setImageError(data.message ?? data.error ?? "Failed to generate image.");
      } else {
        setImageUrl(data.url);
        if (typeof data.remaining === "number") {
          setCreditsRemaining((c) => ({ image: data.remaining!, video: c?.video ?? 0 }));
        }
      }
    } catch {
      setImageError("Failed to reach generation service.");
    } finally {
      setImageLoading(false);
    }
  }

  async function generateVideo() {
    if (!output || videoLoading) return;
    const userId = pb.authStore.record?.id ?? "";
    if (!userId) return;
    setVideoLoading(true);
    setVideoError("");
    setVideoUrl(null);
    try {
      const res = await fetch("/api/integrations/muapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, kind: "video", prompt: output, aspectRatio: imageRatio }),
      });
      const data = (await res.json()) as { url?: string; message?: string; error?: string; remaining?: number };
      if (res.status === 503) {
        setVideoError(data.message ?? "Video generation not configured.");
      } else if (res.status === 402) {
        setVideoError(data.message ?? "Out of video credits this month.");
      } else if (!res.ok || !data.url) {
        setVideoError(data.message ?? data.error ?? "Failed to generate video.");
      } else {
        setVideoUrl(data.url);
        if (typeof data.remaining === "number") {
          setCreditsRemaining((c) => ({ image: c?.image ?? 0, video: data.remaining! }));
        }
      }
    } catch {
      setVideoError("Failed to reach generation service.");
    } finally {
      setVideoLoading(false);
    }
  }

  async function downloadMedia(url: string, ext: "png" | "mp4") {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `staffd-${ext === "png" ? "image" : "video"}-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(url, "_blank");
    }
  }

  async function downloadImage() {
    if (imageUrl) await downloadMedia(imageUrl, "png");
  }

  async function downloadVideo() {
    if (videoUrl) await downloadMedia(videoUrl, "mp4");
  }

  async function publishMedia(platform: "tiktok" | "youtube" | "instagram", mediaUrl: string) {
    const userId = pb.authStore.record?.id ?? "";
    if (!userId || !mediaUrl) return;
    const caption = task.trim() || output.slice(0, 200);
    const confirmMsg = `Publish to ${platform.charAt(0).toUpperCase() + platform.slice(1)}? The post will use your latest task description as the caption.`;
    if (!confirm(confirmMsg)) return;
    setIntegrationStatus("sending");
    setIntegrationMsg("");
    try {
      const res = await fetch("/api/integrations/muapi/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, platform, mediaUrl, caption }),
      });
      const data = (await res.json()) as { postUrl?: string; message?: string; error?: string };
      if (res.status === 503) {
        setIntegrationStatus("error");
        setIntegrationMsg(data.message ?? "Publishing not configured.");
      } else if (!res.ok && data.error !== "not_connected") {
        setIntegrationStatus("error");
        setIntegrationMsg(data.message ?? "Publish failed.");
      } else if (data.error === "not_connected") {
        setIntegrationStatus("error");
        setIntegrationMsg(data.message ?? `Connect your ${platform} account in Settings first.`);
      } else {
        setIntegrationStatus("sent");
        setIntegrationMsg(data.postUrl ? `Posted → ${data.postUrl}` : data.message ?? `Published to ${platform}.`);
      }
    } catch {
      setIntegrationStatus("error");
      setIntegrationMsg("Failed to reach publishing service.");
    }
  }

  async function sendAsTicket() {
    if (!output || integrationStatus === "sending") return;
    const email = prompt("Customer's email address:");
    if (!email?.trim()) return;
    const name = prompt("Customer's name:") ?? "Customer";
    setIntegrationStatus("sending");
    setIntegrationMsg("");
    try {
      const res = await fetch("/api/integrations/chatwoot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name.trim() || "Customer",
          customerEmail: email.trim(),
          subject: task.slice(0, 80) || "Customer reply",
          reply: output,
        }),
      });
      const data = (await res.json()) as { conversationUrl?: string; message?: string; error?: string };
      if (res.status === 503) {
        setIntegrationMsg("Support tickets not configured. Add CHATWOOT_URL, CHATWOOT_API_KEY and CHATWOOT_ACCOUNT_ID to your environment.");
        setIntegrationStatus("error");
      } else if (!res.ok) {
        setIntegrationStatus("error");
        setIntegrationMsg(data.message ?? "Failed to create ticket.");
      } else {
        setIntegrationStatus("sent");
        setIntegrationMsg(data.conversationUrl ? `Ticket opened → ${data.conversationUrl}` : "Ticket opened in Chatwoot.");
      }
    } catch {
      setIntegrationStatus("error");
      setIntegrationMsg("Failed to reach support system.");
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
    <>
    {/* Meet the team drawer */}
    {showTeamDrawer && (
      <div
        className="fixed inset-0 z-50 flex justify-end"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
        onClick={() => setShowTeamDrawer(false)}
      >
        <div
          className="w-full max-w-md h-full overflow-y-auto"
          style={{ background: "#0D0D14", borderLeft: "1px solid #2A2A38" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 px-6 py-5 flex items-center justify-between" style={{ background: "#0D0D14", borderBottom: "1px solid #1E1E2A", zIndex: 10 }}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#5B21E8" }}>
                The {title} Team
              </p>
              <p className="text-sm" style={{ color: "#9090A8" }}>
                {agents.length} specialist{agents.length === 1 ? "" : "s"} on call — Command Center routes the right one automatically.
              </p>
            </div>
            <button
              onClick={() => setShowTeamDrawer(false)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#5A5A70", fontSize: "22px", padding: "0 0 0 12px" }}
            >
              ×
            </button>
          </div>
          <div className="p-5 flex flex-col gap-3">
            {agents.map((a) => (
              <div
                key={a.id}
                className="rounded-xl p-4 flex gap-3 items-start"
                style={{ background: "#111118", border: "1px solid #2A2A38" }}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                  style={{ background: `${a.color}15`, border: `1px solid ${a.color}35` }}
                >
                  {a.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-0.5" style={{ color: "#F0F0F8" }}>{a.name}</p>
                  <p className="text-xs leading-snug" style={{ color: "#6060A0" }}>{a.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}

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
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-3">
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
            {agents.length > 0 && (
              <button
                onClick={() => setShowTeamDrawer(true)}
                className="text-xs transition-colors hover:text-white flex-shrink-0 mt-1.5"
                style={{ color: "#A07BFF", background: "none", border: "none", cursor: "pointer" }}
              >
                Meet the team ({agents.length}) →
              </button>
            )}
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
                  {savedDocId && (
                    <button
                      onClick={() => void copyShareLink()}
                      className="text-xs transition-colors"
                      style={{ color: linkCopied ? "#22C55E" : "#5B21E8" }}
                    >
                      {linkCopied ? "Link copied ✓" : "Share →"}
                    </button>
                  )}
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
                  {department === "reputation" && (
                    <button
                      onClick={() => void sendAsTicket()}
                      disabled={integrationStatus === "sending"}
                      className="text-xs transition-colors hover:text-white"
                      style={{ color: integrationStatus === "sent" ? "#22C55E" : integrationStatus === "error" ? "#F59E0B" : "#5A5A70" }}
                    >
                      {integrationStatus === "sending" ? "Opening ticket…" : integrationStatus === "sent" ? "Ticket opened ✓" : "Send as Ticket"}
                    </button>
                  )}
                  {department === "design" && (
                    <>
                      <select
                        value={imageRatio}
                        onChange={(e) => setImageRatio(e.target.value as typeof imageRatio)}
                        disabled={imageLoading || videoLoading}
                        className="text-xs"
                        style={{
                          background: "transparent",
                          border: "1px solid #2A2A38",
                          color: "#9090A8",
                          borderRadius: "6px",
                          padding: "2px 6px",
                          cursor: imageLoading || videoLoading ? "not-allowed" : "pointer",
                        }}
                      >
                        <option value="1:1">Square</option>
                        <option value="16:9">Landscape</option>
                        <option value="9:16">Portrait</option>
                        <option value="4:3">4:3</option>
                      </select>
                      <button
                        onClick={() => void generateImage()}
                        disabled={imageLoading || videoLoading}
                        className="text-xs transition-colors hover:text-white"
                        style={{ color: imageUrl ? "#22C55E" : imageError ? "#F59E0B" : "#5A5A70" }}
                      >
                        {imageLoading ? "Rendering…" : imageUrl ? "Image ready ✓" : "Generate Image →"}
                      </button>
                      <button
                        onClick={() => void generateVideo()}
                        disabled={imageLoading || videoLoading}
                        className="text-xs transition-colors hover:text-white"
                        style={{ color: videoUrl ? "#22C55E" : videoError ? "#F59E0B" : "#5A5A70" }}
                      >
                        {videoLoading ? "Filming…" : videoUrl ? "Video ready ✓" : "Generate Video →"}
                      </button>
                      {creditsRemaining && (
                        <span className="text-xs" style={{ color: "#3A3A55" }}>
                          · {creditsRemaining.image} 🖼️ / {creditsRemaining.video} 🎬
                        </span>
                      )}
                    </>
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

              {/* Generated image — appears below output for Design department */}
              {department === "design" && (imageUrl || imageLoading || imageError) && (
                <div
                  className="mt-5 rounded-xl overflow-hidden"
                  style={{ background: "#0D0D14", border: "1px solid #2A2A38" }}
                >
                  <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid #1E1E2A" }}>
                    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#5B21E8" }}>
                      Generated Image
                    </p>
                    {imageUrl && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          onClick={() => void publishMedia("instagram", imageUrl)}
                          className="text-xs transition-colors hover:text-white"
                          style={{ color: "#E4405F", background: "none", border: "none", cursor: "pointer" }}
                          title="Publish to Instagram"
                        >
                          📷 Instagram
                        </button>
                        <button
                          onClick={() => void downloadImage()}
                          className="text-xs transition-colors hover:text-white"
                          style={{ color: "#A07BFF", background: "none", border: "none", cursor: "pointer" }}
                        >
                          Download PNG
                        </button>
                        <button
                          onClick={() => void generateImage()}
                          className="text-xs transition-colors hover:text-white"
                          style={{ color: "#5A5A70", background: "none", border: "none", cursor: "pointer" }}
                        >
                          Regenerate
                        </button>
                      </div>
                    )}
                  </div>
                  {imageLoading && (
                    <div className="flex items-center justify-center" style={{ padding: "48px 20px" }}>
                      <div className="flex flex-col items-center gap-3">
                        <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "#5B21E8" }} />
                        <p className="text-xs" style={{ color: "#5A5A70" }}>Your designer is rendering…</p>
                      </div>
                    </div>
                  )}
                  {imageError && !imageLoading && (
                    <div style={{ padding: "20px" }}>
                      <p className="text-xs" style={{ color: "#F59E0B", lineHeight: 1.5 }}>{imageError}</p>
                    </div>
                  )}
                  {imageUrl && !imageLoading && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={imageUrl}
                      alt="Generated by your design specialist"
                      style={{ display: "block", width: "100%", height: "auto", maxHeight: "640px", objectFit: "contain", background: "#0D0D14" }}
                    />
                  )}
                </div>
              )}

              {/* Generated video — appears below output for Design department */}
              {department === "design" && (videoUrl || videoLoading || videoError) && (
                <div
                  className="mt-4 rounded-xl overflow-hidden"
                  style={{ background: "#0D0D14", border: "1px solid #2A2A38" }}
                >
                  <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid #1E1E2A" }}>
                    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#5B21E8" }}>
                      Generated Video
                    </p>
                    {videoUrl && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          onClick={() => void publishMedia("tiktok", videoUrl)}
                          className="text-xs transition-colors hover:text-white"
                          style={{ color: "#000000", background: "rgba(255,255,255,0.1)", padding: "2px 8px", borderRadius: "6px", border: "1px solid #2A2A38", cursor: "pointer" }}
                          title="Publish to TikTok"
                        >
                          🎵 TikTok
                        </button>
                        <button
                          onClick={() => void publishMedia("youtube", videoUrl)}
                          className="text-xs transition-colors hover:text-white"
                          style={{ color: "#FF0000", background: "none", border: "none", cursor: "pointer" }}
                          title="Publish to YouTube"
                        >
                          ▶️ YouTube
                        </button>
                        <button
                          onClick={() => void publishMedia("instagram", videoUrl)}
                          className="text-xs transition-colors hover:text-white"
                          style={{ color: "#E4405F", background: "none", border: "none", cursor: "pointer" }}
                          title="Publish to Instagram"
                        >
                          📷 Instagram
                        </button>
                        <button
                          onClick={() => void downloadVideo()}
                          className="text-xs transition-colors hover:text-white"
                          style={{ color: "#A07BFF", background: "none", border: "none", cursor: "pointer" }}
                        >
                          Download MP4
                        </button>
                        <button
                          onClick={() => void generateVideo()}
                          className="text-xs transition-colors hover:text-white"
                          style={{ color: "#5A5A70", background: "none", border: "none", cursor: "pointer" }}
                        >
                          Regenerate
                        </button>
                      </div>
                    )}
                  </div>
                  {videoLoading && (
                    <div className="flex items-center justify-center" style={{ padding: "60px 20px" }}>
                      <div className="flex flex-col items-center gap-3">
                        <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "#5B21E8" }} />
                        <p className="text-xs" style={{ color: "#5A5A70" }}>Your Producer is filming — usually 30-60 seconds…</p>
                      </div>
                    </div>
                  )}
                  {videoError && !videoLoading && (
                    <div style={{ padding: "20px" }}>
                      <p className="text-xs" style={{ color: "#F59E0B", lineHeight: 1.5 }}>{videoError}</p>
                    </div>
                  )}
                  {videoUrl && !videoLoading && (
                    <video
                      src={videoUrl}
                      controls
                      autoPlay
                      loop
                      muted
                      style={{ display: "block", width: "100%", maxHeight: "640px", background: "#0D0D14" }}
                    />
                  )}
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
                  Add your business details to the Vault and your staff will use them automatically →
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
    </>
  );
}
