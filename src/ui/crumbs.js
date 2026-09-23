import {useEffect} from "preact/hooks";
import {createStore} from "./store.js";

/**
 * The breadcrumb trail, published by whichever page is on screen and drawn by the shell. A page
 * says where it sits; the bar itself belongs to the frame, which is why this is a store rather
 * than markup each page repeats.
 */
export const crumbStore = createStore([]);

export function useCrumbs(items) {
  const key = JSON.stringify(items);
  useEffect(() => {
    crumbStore.set(items);
    document.title = [items.length > 1 ? items[items.length - 1].label : null, import.meta.env.VITE_APP_TITLE]
      .filter(Boolean).join(" · ");
  }, [key]);
}
