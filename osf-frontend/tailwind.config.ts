import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        bg: {
          DEFAULT: "#050507",
          surface: "#111114",
          "surface-2": "#1a1a1f",
          "surface-3": "#242429",
        },
        text: {
          DEFAULT: "#fafafa",
          muted: "#a1a1aa",
          dim: "#71717a",
        },
        accent: {
          DEFAULT: "#ff9500",
          hover: "#ff5722",
        },
        border: {
          DEFAULT: "rgba(255,255,255,0.06)",
          hover: "rgba(255,255,255,0.12)",
        },
      },
      borderRadius: {
        sm: "8px",
        md: "14px",
        lg: "22px",
        xl: "32px",
      },
      backgroundImage: {
        "accent-gradient": "linear-gradient(135deg, #ff9500, #ff5722)",
      },
      animation: {
        "orb-1": "orb1 20s ease-in-out infinite",
        "orb-2": "orb2 25s ease-in-out infinite",
        "orb-3": "orb3 30s ease-in-out infinite",
        "fade-in": "fadeIn 0.6s ease-out forwards",
        "slide-up": "slideUp 0.6s ease-out forwards",
        marquee: "marquee 20s linear infinite",
      },
      keyframes: {
        orb1: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(30px, -50px) scale(1.1)" },
          "66%": { transform: "translate(-20px, 20px) scale(0.9)" },
        },
        orb2: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(-40px, 30px) scale(1.15)" },
          "66%": { transform: "translate(25px, -40px) scale(0.85)" },
        },
        orb3: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(20px, 40px) scale(0.95)" },
          "66%": { transform: "translate(-30px, -20px) scale(1.05)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-33.333%)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
