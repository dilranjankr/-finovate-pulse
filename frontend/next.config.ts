import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for Docker/Coolify deployment.
  output: "standalone",
};

export default nextConfig;
