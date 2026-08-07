import type { EvalCase, EvalCaseResult, EvalSuite } from "../../_lib/evals/eval-engineering";
import {
  createEvalRegistryService,
  isEvalRegistryAuthorized,
  type EvalRegistryStore,
  type StoredCase,
  type StoredRun,
  type StoredSuite,
} from "../../_lib/evals/eval-registry-service";
import type { ResearchEvalObservation } from "../../_lib/evals/research-answer-runner";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";

type RegistryAction =
  | { action: "register_suite"; suite: EvalSuite; supersedesSuiteId?: string | null }
  | { action: "register_case"; testCase: EvalCase }
  | { action: "seed_governed_research_benchmark" }
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
    }
  | {
      action: "submit_governed_research_run";
      runId: string;
      observations: ResearchEvalObservation[];
      evidence?: string[];
      baselineRunId?: string | null;
      startedAt: string;
      completedAt: string;
      driftTolerance?: number;
    };

async function items<T>(collection: string, filter: string, sort = "created"): Promise<T[]> {
  const token = await getAdminToken();
  const params = new URLSearchParams({ filter, sort, perPage: "200" });
  const response = await fetch(`${pbUrl()}/api/collections/${collection}/records?${params}`, {
    headers: { Authorization: token },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${collection} lookup failed (${response.status})`);
  return (((await response.json()) as { items?: T[] }).items ?? []);
}

const store: EvalRegistryStore = {
  findSuites: (suiteId) => items<StoredSuite>("eval_suites", `suite_id = '${pbEscape(suiteId)}'`),
  findCasesById: (caseId) => items<StoredCase>("eval_cases", `case_id = '${pbEscape(caseId)}'`),
  findCasesBySuite: (suiteId) => items<StoredCase>("eval_cases", `suite_id = '${pbEscape(suiteId)}'`, "case_id"),
  findRuns: (runId) => items<StoredRun>("eval_runs", `run_id = '${pbEscape(runId)}'`),
  async create(collection, payload) {
    const token = await getAdminToken();
    const response = await fetch(`${pbUrl()}/api/collections/${collection}/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${collection} creation failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return response.json();
  },
};

const service = createEvalRegistryService(store);

export async function POST(request: Request) {
  if (!isEvalRegistryAuthorized(request, process.env.EVAL_REGISTRY_WRITE_TOKEN)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let input: RegistryAction;
  try {
    input = (await request.json()) as RegistryAction;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    let result;
    if (input.action === "register_suite") result = await service.registerSuite(input.suite, input.supersedesSuiteId ?? null);
    else if (input.action === "register_case") result = await service.registerCase(input.testCase);
    else if (input.action === "seed_governed_research_benchmark") result = await service.seedGovernedResearchBenchmark();
    else if (input.action === "submit_run") result = await service.submitRun(input);
    else if (input.action === "submit_governed_research_run") result = await service.submitGovernedResearchRun(input);
    else return Response.json({ error: "unsupported_action" }, { status: 400 });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    const invalid = /required|invalid|between|threshold|identity|must|cannot|missing|unknown|duplicate/i.test(detail);
    return Response.json({ error: invalid ? "invalid_eval_submission" : "eval_registry_unavailable", detail }, { status: invalid ? 400 : 503 });
  }
}

export async function GET(request: Request) {
  if (!isEvalRegistryAuthorized(request, process.env.EVAL_REGISTRY_WRITE_TOKEN)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const capability = new URL(request.url).searchParams.get("capability")?.trim();
  try {
    const runs = await items<StoredRun>(
      "eval_runs",
      capability ? `capability = '${pbEscape(capability)}'` : "run_id != ''",
      "-completed_at",
    );
    return Response.json({ runs: runs.slice(0, 100) });
  } catch (error) {
    return Response.json({ error: "eval_registry_unavailable", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 503 });
  }
}
