/**
 * STAFFD Montage Service client (S3) — the invisible video-production
 * backend (fork of OpenMontage behind a thin HTTP wrapper on Railway).
 *
 * Model B3: operator-held keys (MONTAGE_URL / MONTAGE_API_KEY), server-side
 * only, the vendor is never named on a customer surface. The caller
 * (STAFFD's orchestrator) is the control plane: it writes the
 * edit_decisions spec; the service executes deterministically.
 */

export function montageConfigured(): boolean {
  return !!(process.env.MONTAGE_URL && process.env.MONTAGE_API_KEY);
}

function base(): string {
  const url = process.env.MONTAGE_URL ?? "";
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-montage-key": process.env.MONTAGE_API_KEY ?? "",
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`montage ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export async function createProject(title: string): Promise<string> {
  const data = await post<{ project_id: string }>("/projects", { title });
  return data.project_id;
}

export type MontageAsset = { id: string; url: string; type: string; scene_id?: string };

export async function addAssets(projectId: string, assets: MontageAsset[]): Promise<void> {
  if (assets.length === 0) return;
  await post(`/projects/${encodeURIComponent(projectId)}/assets`, { assets });
}

export async function startRender(projectId: string, editDecisions: Record<string, unknown>): Promise<string> {
  const data = await post<{ job_id: string }>(
    `/projects/${encodeURIComponent(projectId)}/render`,
    { edit_decisions: editDecisions },
  );
  return data.job_id;
}

/** Props-driven Remotion render (typed scenes) — the schema-free path used
 *  by the v1 spec generator (hero_title/text_card/callout timelines). */
export async function startRenderProps(projectId: string, compositionData: Record<string, unknown>): Promise<string> {
  const data = await post<{ job_id: string }>(
    `/projects/${encodeURIComponent(projectId)}/render_props`,
    { composition_data: compositionData },
  );
  return data.job_id;
}

export async function getRenderJob(jobId: string): Promise<{ status: string; error?: string; output_ready: boolean }> {
  const res = await fetch(`${base()}/jobs/${encodeURIComponent(jobId)}`, { headers: headers() });
  if (!res.ok) throw new Error(`montage job lookup failed (${res.status})`);
  return (await res.json()) as { status: string; error?: string; output_ready: boolean };
}

/** Stream the finished mp4 (service-authed; callers proxy it to the owner). */
export async function fetchOutput(jobId: string): Promise<Response> {
  return fetch(`${base()}/jobs/${encodeURIComponent(jobId)}/output`, { headers: headers() });
}
