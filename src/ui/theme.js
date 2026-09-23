import {createStore, useStore} from "./store.js";

const KEY = "rfs-data-store:theme";

const stored = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

const themeStore = createStore(import.meta.env.VITE_PREFERENCES_DEFAULT_THEME || "dark");

/** The map reads the theme imperatively, outside the component tree. */
export const currentTheme = () => themeStore.get();
export const onThemeChange = fn => themeStore.subscribe(fn);

function apply(theme) {
  themeStore.set(theme);
  if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
}

export function initTheme() {
  apply(stored() || themeStore.get());
}

export function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(KEY, next);
  } catch { /* not remembered */ }
  apply(next);
}

export const useTheme = () => useStore(themeStore);
