import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Código archivado y artefactos generados (EPIC-001 · @SRE):
    "_legacy/**",
    "coverage/**",
    "playwright-report/**",
    // Scripts operativos fuera del alcance del EPIC-001:
    "seed.js",
    "fix.js",
    "generate_pages.js",
    "test_prisma.js",
    "ast.py",
    "features.py",
    "JSValidarCodigo.py",
    // k6 corre en su propio runtime (Goja), no en Node:
    "tests/perf/**",
  ]),
]);

export default eslintConfig;
