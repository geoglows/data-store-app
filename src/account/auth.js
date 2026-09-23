/**
 * Accounts.
 *
 * Signing in is @geoglows/geoglows-auth, the same as every portal app: it owns the Supabase client,
 * the sign-in modal and the account menu in the top bar. Downloading needs an account; agreeing to
 * the terms is asked on every download and is not recorded here.
 *
 * Must be imported before anything renders: bootstrapAuth registers the auth listener and reads the
 * recovery URL before Supabase consumes it.
 */
import {bootstrapAuth} from "@geoglows/geoglows-auth/bootstrap";
import "@geoglows/geoglows-auth/core/sign-in.css";

const env = import.meta.env;
const configured = !!(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
if (!configured) console.warn("[auth] VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set; sign in is unavailable");

// The library renders the account menu into this element; the top bar places it once it mounts.
export const authSlot = document.createElement("div");
authSlot.id = "auth-action";

// Statuses in which the session is still being worked out, and who is signed in is not yet known.
const SETTLING = new Set(["bootstrapping", "processing_callback", "authenticated", "loading_profile", "loading_account"]);

let state = {user: null, ready: !configured};
const listeners = new Set();

const handle = configured ? bootstrapAuth({
  supabaseUrl: env.VITE_SUPABASE_URL,
  supabasePublishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
  portalUrl: env.VITE_PORTAL_URL,
  slot: authSlot,
  connect: {attempts: 2, timeoutMs: 10_000, giveUpMs: 60_000, recheckAfterMs: 300_000},
  onAuthChange: (s) => {
    state = {user: s.user ?? null, ready: !SETTLING.has(s.status)};
    listeners.forEach(fn => fn(state));
  }
}) : null;

export const auth = {
  getState: () => state,
  configured,
  signIn() {
    handle?.openSignIn();
  },
  signOut() {
    return handle?.signOut();
  }
};

/** Called now with the current state and again on every change. Returns the unsubscribe. */
export const subscribeAuth = (fn) => {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
};
