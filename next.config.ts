import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Requerido para la imagen Docker multi-stage (@SRE)
  output: "standalone",
};

export default nextConfig;
