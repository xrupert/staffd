/**
 * W72 piggyback — Plausible opt-out for super-admin sessions.
 *
 * Operator + super-admin sessions must NOT be counted as customer traffic.
 * The tracking script is suppressed (and window.plausible stubbed to a
 * no-op) when the authed email matches NEXT_PUBLIC_ADMIN_EMAIL; for every
 * other (customer) session the script loads as before.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";

// next/script → plain <script> so the DOM assertion is deterministic.
vi.mock("next/script", () => ({ default: (props: Record<string, unknown>) => <script {...props} /> }));

// pb auth store — email controlled per test via a mutable holder.
const auth = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("../../lib/pb", () => ({ default: { authStore: { get record() { return auth.email ? { email: auth.email } : null; } } } }));

import PlausibleScript from "../../app/components/PlausibleScript";

beforeEach(() => {
  auth.email = null;
  vi.stubEnv("NEXT_PUBLIC_PLAUSIBLE_URL", "https://plausible.example.test");
  vi.stubEnv("NEXT_PUBLIC_ADMIN_EMAIL", "chris.rupert@cybridagency.com");
  // @ts-expect-error reset stub between tests
  delete window.plausible;
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("PlausibleScript opt-out", () => {
  it("renders the tracking script for a customer session (non-admin email)", async () => {
    auth.email = "customer@acme.com";
    render(<PlausibleScript />);
    await waitFor(() => {
      expect(document.querySelector('script[data-domain]')).not.toBeNull();
    });
    expect(document.querySelector('script[src*="/js/script.js"]')).not.toBeNull();
  });

  it("does NOT render the script for a super-admin session", async () => {
    auth.email = "chris.rupert@cybridagency.com";
    render(<PlausibleScript />);
    // Give effects a tick; assert the script never appears + stub installed.
    await waitFor(() => {
      expect((window as unknown as { plausible?: unknown }).plausible).toBeTypeOf("function");
    });
    expect(document.querySelector('script[data-domain]')).toBeNull();
  });

  it("super-admin match is case-insensitive", async () => {
    auth.email = "Chris.Rupert@CYBRIDAGENCY.com";
    render(<PlausibleScript />);
    await waitFor(() => {
      expect((window as unknown as { plausible?: unknown }).plausible).toBeTypeOf("function");
    });
    expect(document.querySelector('script[data-domain]')).toBeNull();
  });

  it("renders nothing when no Plausible URL is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLAUSIBLE_URL", "");
    auth.email = "customer@acme.com";
    const { container } = render(<PlausibleScript />);
    await waitFor(() => {});
    expect(container.querySelector("script")).toBeNull();
  });
});
