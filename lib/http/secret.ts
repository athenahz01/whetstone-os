import { timingSafeEqual } from "node:crypto";

export function secretMatches(
  received: string | null,
  expected: string | undefined,
): boolean {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
