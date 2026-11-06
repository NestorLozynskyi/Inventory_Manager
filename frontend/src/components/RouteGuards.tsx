/**
 * Route guards (layout components):
 *  - <RequireAuth>: app routes; no session → /sign-in, expired demo → /demo-expired.
 *  - <GuestOnly>:  auth pages; a signed-in user → /dashboard (demo users may stay when allowDemo).
 */
import { Match, Switch, createSignal, onMount, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { loadMe, me } from "../lib/auth";
import { ErrorState } from "./ErrorState";

export function RequireAuth(props: { children?: JSX.Element }): JSX.Element {
  const navigate = useNavigate();
  const [failed, setFailed] = createSignal(false);
  const check = () => {
    setFailed(false);
    loadMe().then(
      (status) => {
        if (status === "signed-out") navigate("/sign-in", { replace: true });
        else if (status === "demo-expired") navigate("/demo-expired", { replace: true });
      },
      () => setFailed(true),
    );
  };
  onMount(check);
  return (
    <Switch>
      <Match when={me()}>{props.children}</Match>
      <Match when={failed()}>
        <main class="auth-layout">
          <ErrorState onRetry={check} />
        </main>
      </Match>
    </Switch>
  );
}

export function GuestOnly(props: { children?: JSX.Element; allowDemo?: boolean }): JSX.Element {
  const navigate = useNavigate();
  const [ready, setReady] = createSignal(me() !== undefined);
  const mustLeave = () => {
    const m = me();
    return !!m && !(props.allowDemo && m.is_demo);
  };
  onMount(() => {
    loadMe()
      .catch(() => "signed-out" as const)
      .finally(() => {
        setReady(true);
        if (mustLeave()) navigate("/dashboard", { replace: true });
      });
  });
  return (
    <Switch>
      <Match when={ready() && !mustLeave()}>{props.children}</Match>
    </Switch>
  );
}
