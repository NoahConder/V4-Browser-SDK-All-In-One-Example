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
        // same condition gives #root its tablet-width column in globals.css;
        // landscape phones are excluded by the height clause.
        desk: { raw: '(min-width: 640px) and (min-height: 501px)' },
        // Workbench windows wide enough for four icon-beside-label call
        // controls in a row of the call card (CallToolbar.tsx): the center
        // column is 1224 - 45rem of side panes = 504px from here. Narrower,
        // the controls stack their label under the icon, as on phones.
        wide: { raw: '(min-width: 1224px) and (min-height: 501px)' },
        // Not short, but without the height for the in-call keypad, the
        // meters and both toolbar rows at once (most phones below an iPhone
        // Pro's 844px, and 768-800px desktop windows): opening the keypad
        // trims the toolbar to one row and hides the meters (CallScreen.tsx).
        low: { raw: '(min-height: 501px) and (max-height: 800px)' },
      },
      // Colors and fonts are the semantic tokens in src/styles/globals.css
      // (@theme), not Tailwind config.
    },
  },
  plugins: [],
}