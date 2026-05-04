import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// `output: "standalone"` es necesario para el Dockerfile multi-stage
// (COPY .next/standalone) en K8s/self-hosted, pero rompe el runtime de
// Vercel ("No entrypoint found"). Detectamos Vercel por su env var y
// desactivamos standalone allí — Vercel usa su propio serverless packaging.
const isVercel = !!process.env.VERCEL

const nextConfig: NextConfig = {
  ...(isVercel ? {} : { output: "standalone" as const }),
};

// `withSentryConfig` añade subida de source-maps y auto-instrumentación
// de Server Components / API routes. Si las env vars de Sentry no están
// presentes, el plugin se comporta como no-op a efectos prácticos (sólo
// emite warnings de "missing org/project/authToken" en build).
//
// Reads:
//   - SENTRY_AUTH_TOKEN  · token con scope `project:write` (CI only)
//   - SENTRY_ORG         · slug de la org
//   - SENTRY_PROJECT     · slug del proyecto
const sentryBuildOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Silencia logs de Sentry CLI durante build local; en CI Vercel los
  // muestra automáticamente vía variable `CI=true`.
  silent: !process.env.CI,
  // Sentry oculta los source maps del bundle público una vez subidos
  // a su CDN, evitando que el código original quede expuesto.
  hideSourceMaps: true,
  // Tunnel de eventos vía la propia app, sortea ad-blockers que bloquean
  // `ingest.sentry.io`. Sentry agrega un rewrite automático `/monitoring`.
  tunnelRoute: "/monitoring",
  // Tree-shake código de Sentry no usado para minimizar el bundle.
  disableLogger: true,
};

export default withSentryConfig(nextConfig, sentryBuildOptions);
