import { createWyzantAdapterFromEnv } from "../lib/adapters/wyzant";
import { createWyzantMessagesAdapterFromEnv } from "../lib/adapters/wyzant-messages";
import { isTransportableAdapterException } from "../lib/core/adapter-exceptions";
import { WYZANT_POLL_HEARTBEAT } from "../lib/core/heartbeat";
import type { AdapterException, ChannelAdapter, Lead } from "../lib/core/types";

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
const exceptions: AdapterException[] = [];
const failedAdapters: string[] = [];

for (const adapter of adapters) {
  try {
    leads.push(...(await adapter.poll()));
  } catch (error) {
    failedAdapters.push(adapter.name);
    exceptions.push({
      kind: "AdapterPollFailed",
      severity: "warning",
      // The error name only. A thrown message can carry a URL or a page body.
      message: `${adapter.name}: ${error instanceof Error ? error.name : "UnknownError"}`,
    });
  } finally {
    // Drained in `finally` on purpose. A poll that dies part way through is
    // exactly when the exceptions it already raised matter most, and before
    // this they died with the runner.
    exceptions.push(...(adapter.drainExceptions?.() ?? []));
  }
}

// The route rejects a malformed batch rather than dropping it, so anything
// that would not survive validation is dropped here, where it can be counted,
// instead of costing the whole POST.
const transportable = exceptions.filter(isTransportableAdapterException);
const untransportable = exceptions.length - transportable.length;

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
  body: JSON.stringify({ leads, heartbeat, exceptions: transportable }),
  signal: AbortSignal.timeout(60_000),
});
// Reported before either throw below.
//
// A poll that loses an adapter is the run these counts matter most on — it is
// the case the `finally` drain above exists for — and it was the one run that
// never printed them, because the throw came first. An operator reading the
// Actions log on a failed poll now sees what crossed and what did not.
if (!response.ok) {
  console.error("[wyzant-poll:ingest-failed]", {
    status: response.status,
    fetched: leads.length,
    exceptionsSent: transportable.length,
    exceptionsDropped: untransportable,
    failedAdapters,
  });
  throw new Error(`Ingest failed with HTTP ${response.status}.`);
}
const result = (await response.json()) as {
  polled?: number;
  inserted?: number;
  deduped?: number;
  exceptionsRecorded?: number;
};
console.info("[wyzant-poll:complete]", {
  fetched: leads.length,
  polled: result.polled ?? 0,
  inserted: result.inserted ?? 0,
  deduped: result.deduped ?? 0,
  exceptionsSent: transportable.length,
  // From the ingest route's row count, so a mismatch with exceptionsSent means
  // the rows did not land — not that nothing was sent.
  exceptionsRecorded: result.exceptionsRecorded ?? 0,
  exceptionsDropped: untransportable,
  // Stated, not assumed. A poll with a failed adapter withholds the heartbeat.
  heartbeat: heartbeat ? "recorded" : "withheld",
  failedAdapters,
});
if (failedAdapters.length > 0) {
  throw new Error(
    `Wyzant poll failed for adapter(s): ${failedAdapters.join(", ")}.`,
  );
}
