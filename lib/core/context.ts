import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const AGENT_CONTEXT_FILES = [
  "ICP.md",
  "VOICE.md",
  "FACTS.md",
  "BASELINES.md",
] as const;

type ContextFileName = (typeof AGENT_CONTEXT_FILES)[number];

export interface AgentContext {
  hash: string;
  documents: Record<ContextFileName, string>;
  promptText: string;
}

export async function loadAgentContext(): Promise<AgentContext> {
  const contents = await Promise.all([
    readFile(new URL("../../docs/ICP.md", import.meta.url), "utf8"),
    readFile(new URL("../../docs/VOICE.md", import.meta.url), "utf8"),
    readFile(new URL("../../docs/FACTS.md", import.meta.url), "utf8"),
    readFile(new URL("../../docs/BASELINES.md", import.meta.url), "utf8"),
  ]);
  const entries = AGENT_CONTEXT_FILES.map((name, index) => {
    const document = contents[index];
    if (!document.trim()) throw new Error(`Agent context is empty: ${name}`);
    return [name, document] as const;
  });
  const documents = Object.fromEntries(entries) as AgentContext["documents"];
  const promptText = entries
    .map(([name, contents]) => `# ${name}\n\n${contents.trim()}`)
    .join("\n\n");
  const hash = createHash("sha256").update(promptText).digest("hex");

  return { hash, documents, promptText };
}
