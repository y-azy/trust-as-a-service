/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        trust: {
          A: '#22c55e',
          B: '#84cc16',
          C: '#eab308',
          D: '#f97316',
          F: '#ef4444',
        },
      },
    },
  },
  plugins: [],
}