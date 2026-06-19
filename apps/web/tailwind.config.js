/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0c0d10",
        panel: "#16181d",
        border: "#262a31",
        muted: "#9aa0a6",
        accent: "#10a37f",
        danger: "#e5484d",
        userbubble: "#1f6feb",
      },
    },
  },
  plugins: [],
};
