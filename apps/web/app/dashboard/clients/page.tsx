/**
 * /dashboard/clients — HIDDEN (W95.7.1).
 *
 * The agency multi-client management surface is hidden pending the W94 Operator
 * Access System redesign (post-V1). The route returns 404 so the direct URL is
 * not reachable; the `clients` collection + /api/clients routes are untouched
 * (operator/admin + W94 future use). The previous client-management UI lives in
 * git history (pre-W95.7.1) and will be reworked under W94.
 */

import { notFound } from "next/navigation";

export default function ClientsPage(): never {
  notFound();
}
