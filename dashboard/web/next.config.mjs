import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Dashboard is localhost-only; no image optimization / telemetry needs.
  eslint: { ignoreDuringBuilds: true },
  // Pin file-tracing to this app (the repo root also has a lockfile, which Next
  // would otherwise infer as the workspace root).
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
