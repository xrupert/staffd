import { Hono } from "hono";

const healthRouter = new Hono();

healthRouter.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "staffd-api",
    timestamp: new Date().toISOString(),
  });
});

export { healthRouter };
