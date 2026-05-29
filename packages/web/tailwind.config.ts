import type { Config } from "tailwindcss";

/**
 * Hybrid styling: the design tokens live as CSS custom properties in
 * app/tokens.css (ported from the THESIS design system). Tailwind references
 * those same vars so utilities and tokens never drift. Layout/spacing is done
 * in Tailwind; the signature effects (grid+glow void, brushed-metal edges,
 * sigil chips) live in component CSS.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: "var(--void)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        border: "var(--border)",
        "border-2": "var(--border-2)",
        "border-hi": "var(--border-hi)",
        text: "var(--text)",
        muted: "var(--muted)",
        dim: "var(--dim)",
        accent: "var(--accent)",
        blue: "var(--blue)",
        green: "var(--green)",
        purple: "var(--purple)",
        red: "var(--red)",
        up: "var(--green)",
        down: "var(--red)",
      },
      fontFamily: {
        sans: "var(--sans)",
        mono: "var(--mono)",
        serif: "var(--serif)",
      },
      borderRadius: {
        xs: "var(--r-xs)",
        sm: "var(--r-sm)",
        md: "var(--r-md)",
        lg: "var(--r-lg)",
        pill: "var(--r-pill)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        primary: "var(--shadow-primary)",
        mark: "var(--glow-mark)",
      },
      maxWidth: {
        shell: "1060px",
      },
      transitionTimingFunction: {
        thesis: "cubic-bezier(0.2, 0.9, 0.3, 1.0)",
        pop: "cubic-bezier(0.2, 0.9, 0.3, 1.3)",
      },
    },
  },
  plugins: [],
};

export default config;
