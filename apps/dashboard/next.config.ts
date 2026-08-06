import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // @drift/core is consumed as TypeScript source, not as a built package.
  transpilePackages: ["@drift/core"],
}

export default nextConfig
