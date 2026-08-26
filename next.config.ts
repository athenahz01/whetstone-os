import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./docs/**/*.md"],
  },
};

export default nextConfig;
