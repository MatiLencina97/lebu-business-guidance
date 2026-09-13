export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'lebu.appearance.v1';
export const LIGHT_THEME_COLOR = '#f7f8f4';
export const DARK_THEME_COLOR = '#08171a';

export function normalizeThemePreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyThemePreference(preference: ThemePreference) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;

  const themeColor = resolved === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = themeColor;
  });
}

export function saveThemePreference(preference: ThemePreference) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // La apariencia no debe bloquear el uso de Lebu si el storage está restringido.
  }
  applyThemePreference(preference);
}
