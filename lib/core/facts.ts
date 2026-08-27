/**
 * Reads `docs/FACTS.md` as data.
 *
 * The register is owner-governed and this file must never restate it. What the
 * lint needs from it is derived here: which facts are VERIFIED, which figures
 * those facts actually contain, and which subjects are BLOCKED. If Cole
 * resolves a conflict, the lint follows the document without a code change.
 */

export interface VerifiedFact {
  id: string;
  text: string;
}

export interface FactsRegister {
  verified: VerifiedFact[];
  blockedIds: string[];
  /** Every currency amount, percentage and year a VERIFIED row states. */
  supportedFigures: Set<string>;
  /** Cole's approved Wyzant subjects, from F-005. */
  approvedSubjects: string[];
  /** Subjects F-005 explicitly says he is not approved for. */
  unapprovedSubjects: string[];
  /** True while the credential rows are BLOCKED. */
  credentialsBlocked: boolean;
}

const CURRENCY = /\$\s?\d[\d,]*(?:\.\d{2})?/g;
const PERCENT = /\b\d{1,3}(?:\.\d+)?\s?%/g;
const YEAR = /\b(?:19|20)\d{2}\b/g;

/** Normalizes "$ 5,000" and "$5000" to one comparable token. */
export function normalizeFigure(value: string): string {
  return value.replace(/[\s,]/g, "").toLowerCase();
}

function tableRows(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|"))
    .map((line) => line.trim());
}

function cells(row: string): string[] {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

export function parseFactsRegister(markdown: string): FactsRegister {
  const verified: VerifiedFact[] = [];
  const blockedIds: string[] = [];

  for (const row of tableRows(markdown)) {
    const columns = cells(row);
    const id = columns[0];
    if (/^F-\d+$/.test(id) && columns.includes("VERIFIED")) {
      verified.push({ id, text: columns[1] ?? "" });
    }
    if (/^C-\d+$/.test(id) && columns.includes("BLOCKED")) {
      blockedIds.push(id);
    }
  }

  const corpus = verified.map((fact) => fact.text).join("\n");
  const supportedFigures = new Set(
    [
      ...(corpus.match(CURRENCY) ?? []),
      ...(corpus.match(PERCENT) ?? []),
      ...(corpus.match(YEAR) ?? []),
    ].map(normalizeFigure),
  );

  const subjectRow = verified.find((fact) => fact.id === "F-005");
  const approvedSubjects = readSubjectList(
    subjectRow?.text ?? "",
    /exactly four subjects:\s*([^.]+)\./i,
  );
  const unapprovedSubjects = readSubjectList(
    subjectRow?.text ?? "",
    /not approved for\s*([^.]+)\./i,
  );

  return {
    verified,
    blockedIds,
    supportedFigures,
    approvedSubjects,
    unapprovedSubjects,
    // The credential rows are prose rather than a table row, so this reads the
    // heading and its status line rather than guessing.
    credentialsBlocked:
      /Credential facts requiring owner confirmation[\s\S]*?Status:\s*BLOCKED/i.test(
        markdown,
      ),
  };
}

function readSubjectList(text: string, pattern: RegExp): string[] {
  const match = pattern.exec(text);
  if (!match) return [];
  return match[1]
    .split(/,| or /i)
    .map((part) => part.replace(/^\s*(?:and|any)\s+/i, "").trim())
    .filter(Boolean);
}

/**
 * Every currency amount, percentage and explicit year a draft states. These are
 * the claims a reader could check, so each one has to be in the register.
 */
export function checkableFigures(body: string): string[] {
  return [
    ...(body.match(CURRENCY) ?? []),
    ...(body.match(PERCENT) ?? []),
    ...(body.match(YEAR) ?? []),
  ];
}
