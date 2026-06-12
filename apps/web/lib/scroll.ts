/**
 * W68 — THE scroll pattern STAFFD uses, in one named place.
 *
 * STAFFD generates finished work products, not chat messages — so the
 * platform never auto-follows a stream. The only automatic scroll allowed
 * is a single instant anchor that brings the TOP of a new response into
 * view when (and only when) it starts below the viewport. Already-visible
 * responses and users reading history above are left exactly where they
 * are. After this one anchor, scroll position belongs to the user.
 *
 * Locked decisions (W68): anchor top of new response, uniformly;
 * `behavior:"auto"` (instant — smooth animation amplifies the "page moving
 * under me" disorientation); zero scrolls during streaming or on
 * completion.
 */
export function anchorTopIfBelowViewport(el: HTMLElement | null): void {
  if (!el || typeof window === "undefined") return;
  try {
    const top = el.getBoundingClientRect().top;
    // Below the viewport → bring its top into view. Visible or above
    // (user is reading history) → never touch their position.
    if (top >= window.innerHeight) {
      el.scrollIntoView({ behavior: "auto", block: "start" });
    }
  } catch {
    /* layout APIs unavailable (SSR edge) — never throw over a scroll */
  }
}
