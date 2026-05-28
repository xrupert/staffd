import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { getAgent, routeTask, buildPrompt } from "@staffd/agents";
import { fetchVault } from "../lib/vault";
import { rateLimitMiddleware } from "../middleware/rateLimit";

const anthropic = new Anthropic();

const agentRouter = new Hono();

/**
 * POST /agent/run
 *
 * Execute a specific agent by id, or auto-route by task + department.
 *
 * Body: {
 *   task: string;
 *   agentId?: string;       // specific agent — skips routing
 *   department?: string;    // scope routing to a department
 *   userId: string;
 *   pbToken: string;
 *   templateContent?: string;
 * }
 */
agentRouter.post("/run", rateLimitMiddleware, async (c) => {
  const body = await c.req.json<{
    task: string;
    agentId?: string;
    department?: string;
    userId: string;
    pbToken: string;
    templateContent?: string;
  }>();

  const { task, agentId, department, userId, pbToken, templateContent } = body;

  if (!task?.trim()) {
    return c.json({ error: "task is required" }, 400);
  }

  // Resolve agent
  const agent = agentId
    ? getAgent(agentId)
    : routeTask(task, department as Parameters<typeof routeTask>[1]);

  if (!agent) {
    return c.json({ error: "No agent found for this task" }, 404);
  }

  // Build system prompt with vault context
  const vault = await fetchVault(userId, pbToken);
  let systemPrompt = buildPrompt(agent.systemPrompt, vault);

  if (templateContent?.trim()) {
    systemPrompt += `\n\n--- USER TEMPLATE ---\nThe user has provided an existing document template. Use this EXACT structure, layout, and format as your output. Replace placeholder values and example data with appropriate content for this task. Preserve every section heading, field label, and formatting pattern from the template.\n\n${templateContent.trim()}\n--- END TEMPLATE ---`;
  }

  // Stream Claude response
  const stream = await anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: task }],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (
          chunk.type === "content_block_delta" &&
          chunk.delta.type === "text_delta"
        ) {
          controller.enqueue(encoder.encode(chunk.delta.text));
        }
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Agent-Id": agent.id,
      "X-Agent-Name": agent.name,
    },
  });
});

/**
 * GET /agent/department/:department
 * Returns all agents for a given department.
 */
import { getDepartmentAgents } from "@staffd/agents";

agentRouter.get("/department/:department", (c) => {
  const department = c.req.param("department");
  const agents = getDepartmentAgents(department as Parameters<typeof getDepartmentAgents>[0]);

  if (!agents.length) {
    return c.json({ error: "Department not found" }, 404);
  }

  // Return agent metadata only (no system prompts — those are server-side only)
  return c.json(
    agents.map(({ id, name, department, description, emoji, color, tags }) => ({
      id,
      name,
      department,
      description,
      emoji,
      color,
      tags,
    }))
  );
});

/**
 * GET /agent/all
 * Returns all agent metadata for the UI roster.
 */
import { allAgents } from "@staffd/agents";

agentRouter.get("/all", (c) => {
  return c.json(
    allAgents.map(({ id, name, department, description, emoji, color, tags }) => ({
      id,
      name,
      department,
      description,
      emoji,
      color,
      tags,
    }))
  );
});

export { agentRouter };
