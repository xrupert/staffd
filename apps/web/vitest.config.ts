import { defineConfig } from "vitest/config";

export default defineConfig({
  // T3.0 — automatic JSX runtime so components written for Next's transform
  // (no explicit React import) render in component tests.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "happy-dom",
    include: ["app/**/*.{test,spec}.{ts,tsx}", "__tests__/**/*.{test,spec}.{ts,tsx}"],
    globals: true,
  },
});
