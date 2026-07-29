/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: "#1a1a2e",
        secondary: "#16213e",
        accent: "#e94560",
        success: "#4ade80",
        warning: "#fbbf24",
        surface: "#f8fafc",
      },
    },
  },
  plugins: [],
};
