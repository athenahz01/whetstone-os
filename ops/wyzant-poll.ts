import { createWyzantAdapterFromEnv } from "../lib/adapters/wyzant";

const ingestUrl = process.env.INGEST_URL?.trim();
const ingestSecret = process.env.INGEST_SECRET?.trim();
if (!ingestUrl || !ingestSecret) {
  throw new Error("INGEST_URL and INGEST_SECRET are required.");
}

const adapter = createWyzantAdapterFromEnv();
const leads = await adapter.poll();
const response = await fetch(ingestUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-ingest-secret": ingestSecret,
  },
  body: JSON.stringify({ leads }),
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok)
  throw new Error(`Ingest failed with HTTP ${response.status}.`);
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
});
