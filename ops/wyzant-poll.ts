import { createWyzantAdapterFromEnv } from "../lib/adapters/wyzant";
import { createWyzantMessagesAdapterFromEnv } from "../lib/adapters/wyzant-messages";
import { WYZANT_POLL_HEARTBEAT } from "../lib/core/heartbeat";
import type { ChannelAdapter, Lead } from "../lib/core/types";

const ingestUrl = process.env.INGEST_URL?.trim();
const ingestSecret = process.env.INGEST_SECRET?.trim();
if (!ingestUrl || !ingestSecret) {
  throw new Error("INGEST_URL and INGEST_SECRET are required.");
}

const adapters: ChannelAdapter[] = [
  createWyzantMessagesAdapterFromEnv(),
  createWyzantAdapterFromEnv(),
];
const leads: Lead[] = [];
const failedAdapters: string[] = [];
for (const adapter of adapters) {
  try {
    leads.push(...(await adapter.poll()));
  } catch {
    failedAdapters.push(adapter.name);
  }
}
const heartbeat =
  failedAdapters.length === 0
    ? { source: WYZANT_POLL_HEARTBEAT, ranAt: new Date().toISOString() }
    : undefined;
const response = await fetch(ingestUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-ingest-secret": ingestSecret,
  },
  body: JSON.stringify({ leads, heartbeat }),
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok)
  throw new Error(`Ingest failed with HTTP ${response.status}.`);
if (failedAdapters.length > 0) {
  throw new Error(
    `Wyzant poll failed for adapter(s): ${failedAdapters.join(", ")}.`,
  );
}
const result = (await response.json()) as {
  polled?: number;
  inserted?: number;
  deduped?: number;
};
console.info("[wyzant-poll:complete]", {
  fetched: leads.length,
  polled: result.polled ?? 0,
  inserted: result.inserted ?? 0,
  deduped: result.deduped ?? 0,
  heartbeat: "recorded",
});
