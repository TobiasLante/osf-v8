import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        p1: {
          bg: "#0f172a",
          surface: "#1e293b",
          surface2: "#334155",
          border: "#334155",
          accent: "#06b6d4",
          accentHover: "#22d3ee",
          text: "#f1f5f9",
          muted: "#94a3b8",
          dim: "#64748b",
        },
      },
    },
  },
  plugins: [],
};
export default config;
