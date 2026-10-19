import type { Config } from "tailwindcss";

// Palette taken from fireblocks.com design tokens (colors only, no logos or marks).
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 900: "#131629", DEFAULT: "#212647", 500: "#2C365F", 400: "#3B4877", 300: "#415080", 200: "#7281AA", 100: "#C2C8D8" },
        bandwidth: { DEFAULT: "#678BFF", 500: "#385EF4", 600: "#2F4FCC", 100: "#C4CCFE" },
        teal: { DEFAULT: "#3DDBD1" },
        gold: { DEFAULT: "#FFC64E" },
        pink: { DEFAULT: "#FF648B" },
        genesis: { DEFAULT: "#F9FAFC", 200: "#ECEFF4", 400: "#BCBDBF", 500: "#9D9E9F" },
      },
      fontFamily: {
        sans: ["var(--font-figtree)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
