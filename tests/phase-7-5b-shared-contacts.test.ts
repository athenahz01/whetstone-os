import { describe, expect, it } from "vitest";
import { buildContactIndex, lookupContact } from "../lib/crm/contacts";

/**
 * The audit of `c78c7cf` ran the contact index against the live export.
 *
 * 39 of 69 leads hold no usable contact detail and are correctly
 * `unmonitorable`. Two more - U017 and U018 - hold exactly one usable detail
 * each, and it is the same parent phone. Every message from that parent is
 * ambiguous, so neither lead can ever be credited a touch, and neither appeared
 * in any count: they have contact details, so `unmonitorable` did not cover
 * them. U018 is a live lead. U013 and U024 share a parent email and phone, and
 * U024 is Active with one unshared cell, so her record looks partly alive while
 * every parent contact is invisible.
 *
 * Siblings are the ordinary cause and the sheet already holds Liu x2, Wu x2 and
 * Wang x3, so this grows rather than shrinks.
 */

const lead = (
  identity: string,
  leadRef: string,
  values: Record<string, string>,
) =>
  ({
    identity,
    leadRef,
    tab: "ug_sales",
    values,
    disputedFields: [],
  }) as never;

describe("a lead whose contacts are shared, not missing", () => {
  const siblings = () =>
    buildContactIndex([
      lead("i17", "U017", { parent1Phone: "(914) 555-0101" }),
      lead("i18", "U018", { parent1Phone: "+1 914 555 0101" }),
    ]);

  it("is not unmonitorable, because it has a contact detail", () => {
    expect(siblings().unmonitorable).toHaveLength(0);
  });

  it("is reported as wholly unattributable rather than passing silently", () => {
    const flagged = siblings().unattributable;
    expect(flagged.map((l) => l.leadRef).sort()).toEqual(["U017", "U018"]);
    expect(flagged.every((l) => l.wholly)).toBe(true);
  });

  it("names the fields that are shared, so the reason travels with the lead", () => {
    expect(siblings().unattributable[0]!.sharedFields).toEqual([
      "parent1Phone",
    ]);
  });

  it("still refuses to attribute the message to either one", () => {
    const result = lookupContact(siblings(), "phone", "+19145550101");
    expect(result.outcome).toBe("ambiguous");
  });
});

describe("a lead sharing some contacts but not all", () => {
  const index = () =>
    buildContactIndex([
      lead("i13", "U013", {
        parent1Email: "parent@example.com",
        studentEmail: "jayden@example.com",
      }),
      lead("i24", "U024", {
        parent1Email: "parent@example.com",
        studentEmail: "natalie@example.com",
      }),
    ]);

  it("is flagged, but not as wholly unattributable", () => {
    const flagged = index().unattributable;
    expect(flagged).toHaveLength(2);
    expect(flagged.every((l) => l.wholly)).toBe(false);
    expect(flagged[0]!.sharedFields).toEqual(["parent1Email"]);
    expect(flagged[0]!.usableFields).toBe(2);
  });

  it("still matches on the unshared cell", () => {
    const result = lookupContact(index(), "email", "Natalie@Example.com");
    expect(result.outcome).toBe("matched");
    expect(result.outcome === "matched" && result.entry.leadRef).toBe("U024");
  });

  it("goes ambiguous on the shared one", () => {
    expect(lookupContact(index(), "email", "parent@example.com").outcome).toBe(
      "ambiguous",
    );
  });
});

describe("the three states stay distinct", () => {
  it("nothing to match on, shared, and unshared are not conflated", () => {
    const index = buildContactIndex([
      lead("none", "U005", {}),
      lead("shared-a", "U017", { parent1Phone: "(914) 555-0101" }),
      lead("shared-b", "U018", { parent1Phone: "(914) 555-0101" }),
      lead("clean", "U042", { studentEmail: "rafi@example.com" }),
    ]);
    expect(index.unmonitorable.map((l) => l.leadRef)).toEqual(["U005"]);
    expect(index.unattributable.map((l) => l.leadRef).sort()).toEqual([
      "U017",
      "U018",
    ]);
    expect(index.unattributable.some((l) => l.leadRef === "U042")).toBe(false);
  });

  it("a lead with a usable, unshared contact is in none of them", () => {
    const index = buildContactIndex([
      lead("clean", "U042", { studentEmail: "rafi@example.com" }),
    ]);
    expect(index.unmonitorable).toHaveLength(0);
    expect(index.unattributable).toHaveLength(0);
    expect(index.disputedContacts).toHaveLength(0);
  });

  it("two cells on one lead holding the same address is not sharing", () => {
    // The same address in the student and parent column is one lead, not two.
    const index = buildContactIndex([
      lead("one", "U001", {
        studentEmail: "same@example.com",
        parent1Email: "same@example.com",
      }),
    ]);
    expect(index.unattributable).toHaveLength(0);
    expect(lookupContact(index, "email", "same@example.com").outcome).toBe(
      "matched",
    );
  });
});
