import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".corepack/**",
    ".next/**",
    // The auditor's scratch notes and probes. Not the executor's to police,
    // for the same reason they are in .prettierignore.
    ".audit/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
]);
