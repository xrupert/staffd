"use client";

import pb from "../pb";

/** Clears session state and navigates to home. */
export function signOut(): void {
  localStorage.removeItem("staffd_view_as_plan");
  pb.authStore.clear();
  window.location.href = "/";
}
