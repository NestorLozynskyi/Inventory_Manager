/**
 * Session store against /api/auth/* (docs/api.md → Auth).
 *
 *   me()        undefined = not loaded yet · null = signed out · Me = signed in
 *   loadMe()    GET /api/auth/me (deduplicated); resolves to the resulting status
 *   signIn / signUp / startDemo / signOut
 *
 * Route guards live in components/RouteGuards.tsx.
 */
import { createSignal } from "solid-js";
import { ApiError, api } from "../api/client";

export interface Me {
  id: number | string;
  email: string;
  is_demo: boolean;
  demo_expires_at: string | null;
  currency: string;
  created_at: string;
}

export type SessionStatus = "signed-in" | "signed-out" | "demo-expired";

const [me, setMeSignal] = createSignal<Me | null | undefined>(undefined);
const [loadError, setLoadError] = createSignal<ApiError | null>(null);

export { me, loadError };

/** Replace the session (e.g. after a 401 elsewhere: setMe(null)). */
export function setMe(value: Me | null | undefined): void {
  setMeSignal(() => value);
}

export function isDemo(): boolean {
  return !!me()?.is_demo;
}

/** Avatar letter: "D" for demo, else first letter of the email, upper-cased. */
export function avatarLetter(m: Me | null | undefined = me()): string {
  if (!m) return "";
  if (m.is_demo) return "D";
  return (m.email.trim()[0] ?? "").toUpperCase();
}

let inflight: Promise<SessionStatus> | null = null;

/**
 * Load the current session. Resolves "signed-in" | "signed-out" | "demo-expired";
 * rejects with ApiError for network / server errors (loadError() is set as well).
 * Pass `force` to refetch even when already loaded.
 */
export function loadMe(force = false): Promise<SessionStatus> {
  const current = me();
  if (!force && current !== undefined) return Promise.resolve(current ? "signed-in" : "signed-out");
  if (inflight) return inflight;
  setLoadError(null);
  inflight = api
    .get<Me>("/api/auth/me")
    .then((m): SessionStatus => {
      setMe(m);
      return "signed-in";
    })
    .catch((err: unknown): SessionStatus => {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        return err.code === "demo_expired" ? "demo-expired" : "signed-out";
      }
      if (err instanceof ApiError) setLoadError(err);
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export interface Credentials {
  email: string;
  password: string;
}

export async function signIn(c: Credentials): Promise<Me> {
  const m = await api.post<Me>("/api/auth/sign-in", c);
  setMe(m);
  return m;
}

export async function signUp(c: Credentials): Promise<Me> {
  const m = await api.post<Me>("/api/auth/sign-up", c);
  setMe(m);
  return m;
}

export async function startDemo(): Promise<Me> {
  const m = await api.post<Me>("/api/auth/demo");
  setMe(m);
  return m;
}

/** Sign out (a demo account is deleted server-side). Resolves `was_demo`. */
export async function signOut(): Promise<{ was_demo: boolean }> {
  const wasDemo = isDemo();
  try {
    const res = await api.post<{ was_demo: boolean }>("/api/auth/sign-out");
    setMe(null);
    return res ?? { was_demo: wasDemo };
  } catch (err) {
    // Session already gone → treat as signed out.
    if (err instanceof ApiError && err.status === 401) {
      setMe(null);
      return { was_demo: wasDemo };
    }
    throw err;
  }
}
