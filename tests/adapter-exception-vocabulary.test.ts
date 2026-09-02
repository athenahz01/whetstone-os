import { describe, expect, it } from "vitest";
import { attestedSubjectLabels } from "../lib/adapters/wyzant";
import {
  isWyzantExtractionReason,
  narrowWyzantExtractionReason,
  WYZANT_EXTRACTION_REASONS,
} from "../lib/adapters/wyzant-reasons";
import {
  ADAPTER_EXCEPTION_REGISTRY,
  isTransportableAdapterException,
} from "../lib/core/adapter-exceptions";

const malformed = (message: string) => ({
  kind: "WyzantJobMalformed" as const,
  severity: "warning" as const,
  message,
});

/**
 * The audit of 6e38c32 changed one line in the adapter —
 *   throw new Error(`job description is missing for ${job.author}`)
 * — and a learner's name crossed the runner boundary into the exceptions
 * table with all 419 tests still passing. These are the assertions that were
 * missing. Each one fails if the vocabulary is loosened back to a shape.
 */
describe("the malformed-job reason is a closed vocabulary, not a shape", () => {
  it.each([
    [
      "a learner's name appended to a real reason",
      "JOB-1: job description is missing for Sri Ramanathan",
    ],
    ["prose about a learner", "JOB-1: Sri needs help with his Fulbright essay"],
    ["a parent's name", "JOB-1: parent is Xiang Gao, dad"],
    ["a phone number", "JOB-1: call 9144093253 today"],
    [
      "an address with the at-sign removed",
      "JOB-1: contact max.z.gao gmail.com",
    ],
    ["an unregistered reason", "JOB-1: something else went wrong"],
    ["a reason with trailing text", "JOB-1: job URL is invalid, see the board"],
  ])("refuses %s", (_label, message) => {
    expect(isTransportableAdapterException(malformed(message))).toBe(false);
  });

  it.each(WYZANT_EXTRACTION_REASONS)(
    "still carries the real reason %s",
    (reason) => {
      expect(
        isTransportableAdapterException(malformed(`JOB-1042: ${reason}`)),
      ).toBe(true);
    },
  );

  it("escapes the alternation, so a reason ending in a period is literal", () => {
    // "Wyzant job is missing a recognizable posted time." ends in a period.
    // Unescaped, that "." would match any character in this position.
    expect(
      isTransportableAdapterException(
        malformed("JOB-1: Wyzant job is missing a recognizable posted timeX"),
      ),
    ).toBe(false);
    expect(
      isTransportableAdapterException(
        malformed("JOB-1: Wyzant job is missing a recognizable posted time."),
      ),
    ).toBe(true);
  });

  it("still refuses a learner name in the native-id half", () => {
    expect(
      isTransportableAdapterException(
        malformed("Jordan Lee: job description is missing"),
      ),
    ).toBe(false);
  });

  it("pins the registry regex to the vocabulary, so adding a reason cannot be forgotten", () => {
    for (const reason of WYZANT_EXTRACTION_REASONS) {
      expect(
        ADAPTER_EXCEPTION_REGISTRY.WyzantJobMalformed.message.test(
          `J1: ${reason}`,
        ),
      ).toBe(true);
    }
  });
});

describe("narrowing at the source, so the boundary is not the only guard", () => {
  it("passes a recognised reason through unchanged", () => {
    expect(narrowWyzantExtractionReason("job subject is missing")).toBe(
      "job subject is missing",
    );
  });

  it.each([
    "job description is missing for Sri Ramanathan",
    "Timeout 30000ms exceeded while loading https://wyzant.com/j/1",
    "",
    undefined,
    null,
    { message: "job URL is invalid" },
  ])("turns %s into the fallback rather than letting it travel", (value) => {
    expect(narrowWyzantExtractionReason(value)).toBe(
      "job could not be normalized",
    );
  });

  it("recognises exactly the registered reasons and nothing else", () => {
    // Pinned deliberately. Every entry here is a literal thrown inside the
    // extraction try block, including one from a callee. Adding a reason means
    // adding it here, which is the review moment this count exists to force.
    expect([...WYZANT_EXTRACTION_REASONS]).toEqual([
      "job URL is invalid",
      "job subject is missing",
      "job description is missing",
      "Wyzant job is missing a recognizable posted time.",
      "job could not be normalized",
    ]);
    expect(isWyzantExtractionReason("job could not be normalized")).toBe(true);
    expect(isWyzantExtractionReason("job could not be normalised")).toBe(false);
  });
});

/**
 * The subject-label slot, raised by the executor after the first fix pass.
 *
 * The audit gave the malformed-job reason a closed vocabulary and left this
 * slot alone, on the grounds that labels come from `job.subject` and the board
 * controls that field. That is the same "safe today, pinned by nothing"
 * argument the reason slot was fixed for, applied leniently one slot over. The
 * executor was right to call it.
 *
 * A vocabulary cannot work here: the message exists to carry labels the board
 * shows and we do not recognise, so its legitimate contents are unknown by
 * definition. The source is pinned instead - a label must be a subject read off
 * a card in the same run.
 */
describe("rejected subject labels are attested against the cards", () => {
  const cards = (...subjects: string[]) =>
    subjects.map((subject) => ({ subject }));

  it("keeps a label that a card carried", () => {
    expect(
      attestedSubjectLabels(
        ["Elementary Math"],
        cards("Elementary Math", "Algebra"),
      ),
    ).toEqual(["Elementary Math"]);
  });

  it("drops a learner name that no card carried", () => {
    expect(
      attestedSubjectLabels(["Sri Ramanathan"], cards("Elementary Math")),
    ).toEqual([]);
  });

  it("drops an inquiry fragment that no card carried", () => {
    expect(
      attestedSubjectLabels(
        ["applying for Fulbright this year"],
        cards("College Essays"),
      ),
    ).toEqual([]);
  });

  it("keeps every real label and drops only the unattested one", () => {
    expect(
      attestedSubjectLabels(
        ["Writing", "Sri Ramanathan", "Elementary Math"],
        cards("Writing", "Elementary Math"),
      ),
    ).toEqual(["Elementary Math", "Writing"]);
  });

  it("matches across surrounding whitespace rather than dropping a real label", () => {
    expect(attestedSubjectLabels(["  Writing  "], cards("Writing"))).toEqual([
      "  Writing  ",
    ]);
  });

  it("drops everything when no card carried a subject at all", () => {
    expect(attestedSubjectLabels(["Writing"], cards())).toEqual([]);
  });
});
