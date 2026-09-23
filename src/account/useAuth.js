import {useEffect, useState} from "preact/hooks";
import {auth, subscribeAuth} from "./auth.js";

/** The account state, re-rendering whatever reads it when it changes. */
export function useAuth() {
  const [state, setState] = useState(auth.getState());
  useEffect(() => subscribeAuth(setState), []);
  return state;
}
