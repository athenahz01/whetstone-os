import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WYZANT_MESSAGES_URL } from "../lib/adapters/wyzant-messages";
import {
  configuredWyzantLessonTypes,
  collectConfiguredWyzantJobs,
  dedupeWyzantJobs,
  DEFAULT_WYZANT_FEED_URL,
  filterWyzantJobs,
  wyzantFeedUrlForLessonType,
  type WyzantJobSnapshot,
} from "../lib/adapters/wyzant";

const baseJob: WyzantJobSnapshot = {
  nativeId: "job-1",
  author: "Wyzant learner",
  text: "Looking for help with the reading section.",
  subject: "SAT Reading",
  location: "New York, NY",
  url: "https://highered.wyzant.com/tutor/jobs/job-1",
  postedAt: "2026-08-27T12:00:00.000Z",
  lessonType: "in_person",
};

const scope = {
  targetSubjects: [
    "College Counseling",
    "English",
    "Essay Writing",
    "SAT Reading",
  ],
  targetLocations: ["Manhattan", "New York, NY"],
  includeOnlineJobs: true,
};

describe("Wyzant operational hardening", () => {
  it("pins both production defaults to the observed highered host", () => {
    expect(DEFAULT_WYZANT_FEED_URL).toBe(
      "https://highered.wyzant.com/tutor/jobs",
    );
    expect(DEFAULT_WYZANT_MESSAGES_URL).toBe(
      "https://highered.wyzant.com/tutor/messaging",
    );
  });

  it("negative-probes targetSubjects by excluding an unapproved subject", () => {
    expect(
      filterWyzantJobs([{ ...baseJob, subject: "ACT English" }], scope),
    ).toEqual([]);
  });

  it("negative-probes targetLocations by excluding an out-of-area in-person job", () => {
    expect(
      filterWyzantJobs([{ ...baseJob, location: "Boston, MA" }], scope),
    ).toEqual([]);
  });

  it("negative-probes includeOnlineJobs with the same online job", () => {
    const online = {
      ...baseJob,
      location: "Online",
      lessonType: "online",
    } as const;
    expect(filterWyzantJobs([online], scope)).toEqual([online]);
    expect(
      filterWyzantJobs([online], { ...scope, includeOnlineJobs: false }),
    ).toEqual([]);
  });

  it("reads both lesson-type selections when online is enabled", () => {
    expect(configuredWyzantLessonTypes(true)).toEqual(["online", "in_person"]);
    expect(configuredWyzantLessonTypes(false)).toEqual(["in_person"]);
    expect(wyzantFeedUrlForLessonType(DEFAULT_WYZANT_FEED_URL, "online")).toBe(
      "https://highered.wyzant.com/tutor/jobs?subject_id=-1&lesson_type=online",
    );
    expect(
      wyzantFeedUrlForLessonType(DEFAULT_WYZANT_FEED_URL, "in_person"),
    ).toBe(
      "https://highered.wyzant.com/tutor/jobs?subject_id=-1&lesson_type=in_person",
    );
  });

  it("deduplicates inventory shared by the two lesson-type views", () => {
    expect(
      dedupeWyzantJobs([
        { ...baseJob, lessonType: "online" },
        { ...baseJob, lessonType: "in_person" },
      ]),
    ).toHaveLength(1);
  });

  it("wires both scoped views through collection instead of leaving options inert", async () => {
    const readView = vi.fn(
      async (_url: string, lessonType: "online" | "in_person") => [
        { ...baseJob, lessonType },
        { ...baseJob, nativeId: "wrong-subject", subject: "ACT English" },
        { ...baseJob, nativeId: "wrong-location", location: "Boston, MA" },
      ],
    );
    const jobs = await collectConfiguredWyzantJobs(
      { ...scope, feedUrl: DEFAULT_WYZANT_FEED_URL },
      readView,
    );
    expect(readView).toHaveBeenCalledTimes(2);
    expect(jobs.map((job) => job.nativeId)).toEqual(["job-1"]);
  });
});
