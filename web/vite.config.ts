import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Long-lived vendor chunks: they only change when dependencies change, so browsers keep them cached
// across app deploys. Everything else is split by Rollup's default chunking: one chunk per page
// (React.lazy routes) plus on-demand chunks (export builders, share codec). Radix is deliberately
// not forced into one chunk: Home would then also download editor-only primitives (Select, Tabs…).
const VENDOR_CHUNKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser)[\\/]/, "vendor-react"],
  [/[\\/]node_modules[\\/]zod[\\/]/, "vendor-zod"],
];

// The app uses a hash router and relative asset/data URLs, so the default base "./" works on
// GitHub Pages project sites (/<repo>/), user sites and custom domains alike.
// Override with VITE_BASE=/<repo>/ if you ever switch to a browser (history) router.
export default defineConfig({
  base: process.env.VITE_BASE || "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    // The largest chunk is vendor-react (~280 kB): warn when anything grows well beyond that.
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        // File names keep the default content hash ([name]-[hash].js).
        manualChunks(id) {
          for (const [pattern, name] of VENDOR_CHUNKS) if (pattern.test(id)) return name;
          return undefined;
        },
      },
    },
  },
});
