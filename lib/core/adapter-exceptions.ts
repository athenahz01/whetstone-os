import type { AdapterException } from "./types";

/**
 * The wire contract for adapter exceptions crossing from the GitHub runner to
 * the app.
 *
 * The Wyzant adapter builds these on the runner, `drainExceptions()` hands them
 * out, and until now the only caller ran on Vercel against a BatchAdapter that
 * has nothing to drain. So the inventory-mismatch exception that names both
 * counts, and the rejected-subject labels that answer which subjects the board
 * actually serves, were created on the runner and discarded when the job ended.
 * Every piece was tested. The seam between them was not.
 *
 * The registry below is the single definition of what may cross. The adapter,
 * the validator and the tests all read it, so a new kind cannot be sent without
 * being described here first.
 *
 * G5 lives here too. These messages carry counts, hashed source refs and
 * subject labels. Each kind declares the exact shape its message may take, so
 * a job URL, a message body or an over-long string is refused rather than
 * trusted, and a kind nobody registered is refused outright.
 */
export const ADAPTER_EXCEPTION_REGISTRY = {
  WyzantBoardInventoryMismatch: {
    severity: "critical",
    /** "online view: Wyzant board reported 17 jobs but 10 distinct cards were extracted." */
    message:
      /^(?:online|in_person) view: Wyzant board (?:reported \d{1,5} jobs but \d{1,5} distinct cards were extracted|count was unavailable; \d{1,5} distinct cards were extracted)\.$/,
  },
  WyzantSubjectsRejected: {
    severity: "warning",
    /** "Rejected Wyzant subject labels: Elementary Math | Writing" */
    message: /^Rejected Wyzant subject labels: [A-Za-z0-9 ,.'&()+/|-]{1,240}$/,
    /**
     * A shape alone would admit prose, because a sentence is made of the same
     * characters a subject label is. Labels are short and there are not many,
     * so both are bounded: that is what refuses an inquiry body pasted into
     * the slot while still carrying "Elementary Math" and "College Essays".
     */
    refine: (message: string) => {
      const labels = message
        .replace(/^Rejected Wyzant subject labels: /, "")
        .split(" | ");
      return (
        labels.length <= 12 &&
        labels.every(
          (label) =>
            label.trim().length > 0 &&
            label.length <= 60 &&
            label.trim().split(/\s+/).length <= 6,
        )
      );
    },
  },
  WyzantJobMalformed: {
    severity: "warning",
    /** "JOB-1042: job description is missing" */
    message: /^[A-Za-z0-9_-]{1,64}: [A-Za-z][A-Za-z0-9 ,.'-]{1,160}$/,
  },
  AdapterPollFailed: {
    severity: "warning",
    /** "wyzant: TimeoutError" */
    message: /^[a-z0-9-]{1,40}: [A-Za-z]{1,60}$/,
  },
} as const satisfies Record<
  string,
  {
    severity: AdapterException["severity"];
    message: RegExp;
    refine?: (message: string) => boolean;
  }
>;

export type AdapterExceptionKind = keyof typeof ADAPTER_EXCEPTION_REGISTRY;

export const ADAPTER_EXCEPTION_KINDS = Object.keys(
  ADAPTER_EXCEPTION_REGISTRY,
) as AdapterExceptionKind[];

/** One poll cannot report more than this many problems. */
export const MAX_ADAPTER_EXCEPTIONS = 50;

/**
 * An outer bound, not the working limit.
 *
 * Every kind registered above caps its own message well below this through its
 * shape, so no message a current kind can build reaches it. It is here for the
 * kind somebody adds later with a looser shape, and a probe that removes it
 * changes nothing today. That is stated rather than left to be discovered.
 */
export const MAX_ADAPTER_EXCEPTION_MESSAGE = 300;

/**
 * Text that must never appear in any message, whatever its kind.
 *
 * A job URL identifies a family's posting. A newline is how a message body
 * arrives. An at-sign is how an address does.
 */
const FORBIDDEN_IN_MESSAGE = /https?:\/\/|www\.|@|[\r\n\t]|<|>/;

export function isAdapterExceptionKind(
  value: unknown,
): value is AdapterExceptionKind {
  return (
    typeof value === "string" &&
    Object.hasOwn(ADAPTER_EXCEPTION_REGISTRY, value)
  );
}

/**
 * True when this exception may cross the wire.
 *
 * Fails closed: an unregistered kind, a severity the kind does not use, an
 * over-long message, anything carrying a URL or an address or a line break, and
 * anything whose message does not match the shape its kind declares.
 */
export function isTransportableAdapterException(
  value: unknown,
): value is AdapterException {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (!isAdapterExceptionKind(candidate.kind)) return false;
  const registered = ADAPTER_EXCEPTION_REGISTRY[candidate.kind];
  if (candidate.severity !== registered.severity) return false;
  const message = candidate.message;
  if (typeof message !== "string") return false;
  if (message.length === 0 || message.length > MAX_ADAPTER_EXCEPTION_MESSAGE) {
    return false;
  }
  if (FORBIDDEN_IN_MESSAGE.test(message)) return false;
  if (!registered.message.test(message)) return false;
  const refine = (registered as { refine?: (value: string) => boolean }).refine;
  return refine ? refine(message) : true;
}

/**
 * Validates the exceptions on an ingest body.
 *
 * Returns undefined when the field is absent, and null when it is present but
 * malformed, so the route can reject the request rather than silently drop the
 * observability it was sent.
 */
export function parseAdapterExceptions(
  value: unknown,
): AdapterException[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_ADAPTER_EXCEPTIONS) return null;
  if (!value.every(isTransportableAdapterException)) return null;
  return value as AdapterException[];
}
