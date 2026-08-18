/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: "#3730A3",
        secondary: "#1e1b4b",
        accent: "#4338CA",
        success: "#4ade80",
        warning: "#fbbf24",
        surface: "#f0f2ff",
      },
    },
  },
  plugins: [],
};
