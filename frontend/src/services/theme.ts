// Light/dark theme for the SignalWire docs look (see globals.css's token
// layer): resolves the Appearance setting to `data-theme` on <html>, which is
// what the `[data-theme='dark']` token overrides key off, and keeps the
// browser-chrome color in step. Called from main.tsx before the first render
// (no flash of the wrong theme) and from the Appearance setting on change.
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

type ResolvedTheme = 'light' | 'dark';

// The docs site's canvas colors; also the two theme-color metas in index.html
// and the manifest's theme_color.
const THEME_COLOR: Record<ResolvedTheme, string> = { light: '#fafbfc', dark: '#0e0e18' };

const DARK_QUERY = '(prefers-color-scheme: dark)';

let systemListener: (() => void) | null = null;

const resolve = (preference: ThemePreference): ResolvedTheme =>
  preference === 'system' ? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light') : preference;

const setResolved = (theme: ResolvedTheme) => {
  document.documentElement.dataset.theme = theme;
  // The media-scoped metas cover the System case; this one is what the
  // browser reads when the setting overrides the system.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = THEME_COLOR[theme];
  }
};

export function applyTheme(preference: ThemePreference): void {
  const mql = window.matchMedia(DARK_QUERY);
  if (systemListener) {
    mql.removeEventListener('change', systemListener);
    systemListener = null;
  }
  setResolved(resolve(preference));
  if (preference === 'system') {
    // Follow the OS live while on System.
    systemListener = () => setResolved(resolve('system'));
    mql.addEventListener('change', systemListener);
  }
}

export const currentTheme = (): ResolvedTheme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
