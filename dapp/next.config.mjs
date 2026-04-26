/** @type {import('next').NextConfig} */
import nextra from "nextra";
import path from "node:path";
import { fileURLToPath } from "node:url";

const withNextra = nextra({
  contentDirBasePath: "/docs",
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

export default withNextra({
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    // Ignore pino-pretty in browser builds (it's Node.js only)
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        "pino-pretty": false,
      };
    }
    return config;
  },
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      "next-mdx-import-source-file": "./mdx-components.ts",
    },
  },
});
