import { evaluateRun, type EvalCase, type EvalCaseResult, type EvalRunVerdict, type EvalSuite } from "../../_lib/evals/eval-engineering";
import { compareEvalRuns, createCaseRecord, createRunRecord, createSuiteRecord, type EvalRunRecord } from "../../_lib/evals/eval-registry";
import { toStoredCase, toStoredRun, toStoredSuite } from "../../_lib/evals/eval-store";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";

type RegistryAction =
  | { action: "register_suite"; suite: EvalSuite; supersedesSuiteId?: string | null }
  | { action: "register_case"; testCase: EvalCase }
  | {
      action: "submit_run";
      runId: string;
      suiteId: string;
      results: EvalCaseResult[];
      evidence?: string[];
      baselineRunId?: string | null;
      startedAt: string;
      completedAt: string;
      driftTolerance?: number;
    };

type StoredSuite = { id: string; suite_id: string; definition: EvalSuite };
type StoredCase = { id: string; case_id: string; suite_id: string; definition: EvalCase };
type StoredRun = {
  id: string;
  run_id: string;
  suite_id: string;
  capability: string;
  capability_version: string;
  suite_version: string;
  baseline_run_id?: string;
  verdict: EvalRunVerdict;
  evidence: string[];
  release_decision: "approved" | "blocked";
  started_at: string;
  completed_at: string;
};

function authorized(request: Request): boolean {
  const expected = process.env.EVAL_REGISTRY_WRITE_TOKEN?.trim();
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

async function collectionItems<T>(collection: string, filter: string, sort = "created"): Promise<T[]> {
  const token = await getAdminToken();
  const params = new URLSearchParams({ filter, sort, perPage: "200" });
  const response = await fetch(`${pbUrl()}/api/collections/${collection}/records?${params}`, {
    headers: { Authorization: token },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${collection} lookup failed (${response.status})`);
  return (((await response.json()) as { items?: T[] }).items ?? []);
}

async function createStored(collection: string, payload: unknown): Promise<unknown> {
  const token = await getAdminToken();
  const response = await fetch(`${pbUrl()}/api/collections/${collection}/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`${collection} creation failed (${response.status}): ${detail}`);
  }
  return response.json();
}

function storedRunToRecord(record: StoredRun): EvalRunRecord {
  return createRunRecord({
    id: record.run_id,
    suiteId: record.suite_id,
    capability: record.capability,
    capabilityVersion: record.capability_version,
    suiteVersion: record.suite_version,
    baselineRunId: record.baseline_run_id || null,
    verdict: record.verdict,
    evidence: record.evidence ?? [],
    startedAt: record.started_at,
    completedAt: record.completed_at,
  });
}

async function registerSuite(input: Extract<RegistryAction, { action: "register_suite" }>) {
  const existing = await collectionItems<StoredSuite>("eval_suites", `suite_id = '${pbEscape(input.suite.id)}'`);
  if (existing.length) return { status: 200, body: { suiteId: input.suite.id, created: false, idempotent: true } };

  const record = createSuiteRecord({
    id: input.suite.id,
    capability: input.suite.capability,
    capabilityVersion: input.suite.capabilityVersion,
    suiteVersion: input.suite.suiteVersion,
    definition: input.suite,
    createdAt: new Date().toISOString(),
    createdBy: "cso",
    supersedesSuiteId: input.supersedesSuiteId ?? null,
  });
  await createStored("eval_suites", toStoredSuite(record));
  return { status: 201, body: { suiteId: record.id, created: true } };
}

async function registerCase(input: Extract<RegistryAction, { action: "register_case" }>) {
  const suites = await collectionItems<StoredSuite>("eval_suites", `suite_id = '${pbEscape(input.testCase.suiteId)}'`);
  if (!suites.length) return { status: 404, body: { error: "suite_not_found" } };
  const existing = await collectionItems<StoredCase>("eval_cases", `case_id = '${pbEscape(input.testCase.id)}'`);
  if (existing.length) return { status: 200, body: { caseId: input.testCase.id, created: false, idempotent: true } };

  const record = createCaseRecord({
    id: input.testCase.id,
    suiteId: input.testCase.suiteId,
    definition: input.testCase,
    createdAt: new Date().toISOString(),
  });
  await createStored("eval_cases", toStoredCase(record));
  return { status: 201, body: { caseId: record.id, created: true } };
}

async function submitRun(input: Extract<RegistryAction, { action: "submit_run" }>) {
  const duplicate = await collectionItems<StoredRun>("eval_runs", `run_id = '${pbEscape(input.runId)}'`);
  if (duplicate.length) return { status: 200, body: { runId: input.runId, created: false, idempotent: true, releaseDecision: duplicate[0]!.release_decision } };

  const suites = await collectionItems<StoredSuite>("eval_suites", `suite_id = '${pbEscape(input.suiteId)}'`);
  const storedSuite = suites[0];
  if (!storedSuite) return { status: 404, body: { error: "suite_not_found" } };
  const cases = await collectionItems<StoredCase>("eval_cases", `suite_id = '${pbEscape(input.suiteId)}'`, "case_id");
  if (!cases.length) return { status: 409, body: { error: "suite_has_no_cases" } };

  const verdict = evaluateRun(storedSuite.definition, cases.map((item) => item.definition), input.results);
  let record = createRunRecord({
    id: input.runId,
    suiteId: input.suiteId,
    capability: storedSuite.definition.capability,
    capabilityVersion: storedSuite.definition.capabilityVersion,
    suiteVersion: storedSuite.definition.suiteVersion,
    baselineRunId: input.baselineRunId ?? null,
    verdict,
    evidence: input.evidence ?? [],
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  });

  let drift = null;
  if (input.baselineRunId) {
    const baselines = await collectionItems<StoredRun>("eval_runs", `run_id = '${pbEscape(input.baselineRunId)}'`);
    const baseline = baselines[0];
    if (!baseline) return { status: 404, body: { error: "baseline_run_not_found" } };
    drift = compareEvalRuns(record, storedRunToRecord(baseline), input.driftTolerance ?? 0);
    if (drift.regressed) {
      record = createRunRecord({
        ...record,
        verdict: {
          ...record.verdict,
          releasable: false,
          failures: [...new Set([...record.verdict.failures, ...drift.reasons.map((reason) => `Drift: ${reason}`)])],
        },
      });
    }
  }

  await createStored("eval_runs", toStoredRun(record));
  return {
    status: record.releaseDecision === "approved" ? 201 : 409,
    body: {
      runId: record.id,
      created: true,
      releaseDecision: record.releaseDecision,
      verdict: record.verdict,
      drift,
    },
  };
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let input: RegistryAction;
  try {
    input = (await request.json()) as RegistryAction;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    let result;
    if (input.action === "register_suite") result = await registerSuite(input);
    else if (input.action === "register_case") result = await registerCase(input);
    else if (input.action === "submit_run") result = await submitRun(input);
    else return Response.json({ error: "unsupported_action" }, { status: 400 });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    const invalid = /required|invalid|between|threshold|identity|must|cannot|missing/i.test(detail);
    return Response.json({ error: invalid ? "invalid_eval_submission" : "eval_registry_unavailable", detail }, { status: invalid ? 400 : 503 });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const capability = url.searchParams.get("capability")?.trim();
  const clauses = capability ? `capability = '${pbEscape(capability)}'` : "run_id != ''";
  try {
    const runs = await collectionItems<StoredRun>("eval_runs", clauses, "-completed_at");
    return Response.json({ runs: runs.slice(0, 100) });
  } catch (error) {
    return Response.json({ error: "eval_registry_unavailable", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 503 });
  }
}
