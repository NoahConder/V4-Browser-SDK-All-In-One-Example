/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        // Phones in landscape (and other very short viewports): layouts switch
        // from a stacked column to side-by-side so nothing overlaps or scrolls.
        short: { raw: '(max-height: 500px)' },
        // Tablets and desktop: room for a word under each header icon. The
        // same condition gives #root its phone-width column in globals.css;
        // landscape phones are excluded by the height clause.
        desk: { raw: '(min-width: 640px) and (min-height: 501px)' },
      },
      // Colors and fonts are the semantic tokens in src/styles/globals.css
      // (@theme), not Tailwind config.
    },
  },
  plugins: [],
}