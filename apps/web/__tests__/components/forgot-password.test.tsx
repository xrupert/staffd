/**
 * /auth/forgot — the login page's "Forgot?" link 404'd because this page
 * never existed. Pins: renders, submits PB requestPasswordReset, and shows
 * the SAME success state whether the email exists or errors (no account
 * enumeration).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

const pbMock = vi.hoisted(() => ({
  requestPasswordReset: vi.fn<(email: string) => Promise<void>>(),
}));

vi.mock("../../lib/pb", () => ({
  default: { collection: () => ({ requestPasswordReset: pbMock.requestPasswordReset }) },
}));

import ForgotPasswordPage from "../../app/auth/forgot/page";

beforeEach(() => {
  pbMock.requestPasswordReset.mockReset();
});

function submit(container: HTMLElement, email: string) {
  const input = container.querySelector("input[type=email]") as HTMLInputElement;
  fireEvent.change(input, { target: { value: email } });
  fireEvent.submit(container.querySelector("form") as HTMLFormElement);
}

describe("/auth/forgot", () => {
  it("renders the request form", () => {
    const { container } = render(<ForgotPasswordPage />);
    expect(container.textContent).toMatch(/Reset your password/);
    expect(container.querySelector("input[type=email]")).toBeTruthy();
  });

  it("submits requestPasswordReset and shows the success state", async () => {
    pbMock.requestPasswordReset.mockResolvedValue(undefined);
    const { container } = render(<ForgotPasswordPage />);
    submit(container, "owner@biz.com");
    await waitFor(() => expect(container.textContent).toMatch(/Check your inbox/));
    expect(pbMock.requestPasswordReset).toHaveBeenCalledWith("owner@biz.com");
  });

  it("shows the identical success state when PB errors (no enumeration)", async () => {
    pbMock.requestPasswordReset.mockRejectedValue(new Error("not found"));
    const { container } = render(<ForgotPasswordPage />);
    submit(container, "nobody@nowhere.com");
    await waitFor(() => expect(container.textContent).toMatch(/Check your inbox/));
  });
});
