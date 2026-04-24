import type { NextConfig } from "next";

// `output: "standalone"` es necesario para el Dockerfile multi-stage
// (COPY .next/standalone) en K8s/self-hosted, pero rompe el runtime de
// Vercel ("No entrypoint found"). Detectamos Vercel por su env var y
// desactivamos standalone allí — Vercel usa su propio serverless packaging.
const isVercel = !!process.env.VERCEL

const nextConfig: NextConfig = {
  ...(isVercel ? {} : { output: "standalone" as const }),
};

export default nextConfig;
