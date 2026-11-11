import type { NextConfig } from "next";

// The one variable read here (the env module is server-only): the Blob
// store's public host, absent on the disk driver.
const blobHost = process.env.BLOB_PUBLIC_HOST || undefined;

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The island sends at most 900 KB; the default 1 MB counts the multipart overhead.
    serverActions: { bodySizeLimit: "2mb" },
  },
  // One 640 px WebP variant per photo, shared by every screen.
  images: {
    deviceSizes: [640],
    imageSizes: [],
    qualities: [75],
    formats: ["image/webp"],
    minimumCacheTTL: 2678400,
    localPatterns: [{ pathname: "/uploads/items/**" }],
    remotePatterns: blobHost
      ? [{ protocol: "https", hostname: blobHost, pathname: "/items/**" }]
      : [],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
