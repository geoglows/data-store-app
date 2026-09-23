/**
 * Accounts, shaped like @geoglows/geoglows-auth's bootstrap so the real one can be dropped in.
 *
 * TODO: this is a stand-in. Pressing Sign in signs you straight in as a demo user and remembers the
 * terms acceptance for the tab. The real wiring is
 *
 *   import {bootstrapAuth} from "@geoglows/geoglows-auth/bootstrap";
 *   import "@geoglows/geoglows-auth/core/sign-in.css";
 *   export const auth = bootstrapAuth({supabaseUrl, supabasePublishableKey, portalUrl, onAuthChange});
 *
 * with terms acceptance stored on the user's profile rather than in sessionStorage.
 */

const TERMS_KEY = "rfs-data-store:terms";
const USER_KEY = "rfs-data-store:user";

const read = (key) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch { /* private mode — holds for this page only */ }
};

let state = {
  user: read(USER_KEY) ? JSON.parse(read(USER_KEY)) : null,
  termsAccepted: read(TERMS_KEY) === "yes"
};
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn(state));

export const auth = {
  getState: () => state,
  async signIn() {
    const user = {sub: "demo-user", email: "demo@geoglows.org", name: "Demo User"};
    write(USER_KEY, JSON.stringify(user));
    state = {...state, user};
    emit();
    return user;
  },
  async signOut() {
    write(USER_KEY, null);
    write(TERMS_KEY, null);
    state = {user: null, termsAccepted: false};
    emit();
  },
  async acceptTerms() {
    if (!state.user) await auth.signIn();
    write(TERMS_KEY, "yes");
    state = {...state, termsAccepted: true};
    emit();
  }
};

/** Called now with the current state and again on every change. Returns the unsubscribe. */
export const subscribeAuth = (fn) => {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
};
