import { createHash } from "node:crypto";

export function stableLeadId(channel: string, nativeId: string): string {
  return createHash("sha256")
    .update(`${channel.trim().toLowerCase()}:${nativeId.trim()}`)
    .digest("hex");
}
