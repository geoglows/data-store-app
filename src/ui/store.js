import {useEffect, useState} from "preact/hooks";

/**
 * The smallest store that covers what this app shares between pages: a value, a way to set it, and
 * a hook that re-renders whatever reads it. Three things use it — the theme, the account, and the
 * breadcrumbs a page publishes to the shell.
 */
export function createStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach(fn => fn(value));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}

export function useStore(store) {
  const [value, setValue] = useState(store.get());
  useEffect(() => store.subscribe(setValue), [store]);
  return value;
}
