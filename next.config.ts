import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep pdf-parse and pdfjs-dist as external packages on the server
  serverExternalPackages: ["pdfjs-dist", "pdf-parse"],

  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Client: don't try to bundle Node built-ins
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        http: false,
        https: false,
        url: false,
        canvas: false,
      };
    }

    return config;
  },
};

export default nextConfig;
