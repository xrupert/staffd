import PocketBase from "pocketbase";
import { resolvePocketbasePublicUrl } from "./env";

// PR-Tranche-1.6 — Decision: URL env vars resolve via centralized helper.
// Empty-string env values are caught and fall back to default (the W8
// footgun); missing-scheme values throw at module load.
const pb = new PocketBase(resolvePocketbasePublicUrl());

export default pb;
