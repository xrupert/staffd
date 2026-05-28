import type { VaultContext } from "@staffd/agents";

const POCKETBASE_URL = process.env.POCKETBASE_URL ?? process.env.NEXT_PUBLIC_POCKETBASE_URL ?? "";

/**
 * Fetch a user's vault context from PocketBase using their auth token.
 * Returns null if the vault cannot be fetched (degrade gracefully).
 */
export async function fetchVault(
  userId: string,
  pbToken: string
): Promise<VaultContext | null> {
  if (!POCKETBASE_URL || !pbToken || !userId) return null;

  try {
    const res = await fetch(
      `${POCKETBASE_URL}/api/collections/businesses/records?filter=(user='${userId}')&perPage=1`,
      {
        headers: { Authorization: pbToken },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!res.ok) return null;

    const data = (await res.json()) as {
      items?: Record<string, unknown>[];
    };

    return (data.items?.[0] as VaultContext) ?? null;
  } catch {
    return null;
  }
}
