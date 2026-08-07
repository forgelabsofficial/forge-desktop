/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        forge: {
          bg: "#0b0e14",
          panel: "#12161f",
          border: "#1f2733",
          text: "#e6e9ef",
          muted: "#8b94a3",
          accent: "#f97316",
          accentDim: "#9a4a12",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
