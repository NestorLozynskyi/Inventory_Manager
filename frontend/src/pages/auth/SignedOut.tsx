/** Signed out — screens/signed-out.html (regular; ?demo=1 → "You left the demo"). */
import { Show, createEffect, type JSX } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { Icon } from "../../components/Icon";
import { AuthBrand, DEMO_LOADING_TEXT, FormAlert, useStartDemo } from "./authShared";
import "./SignedOut.css";

export default function SignedOut(): JSX.Element {
  const [params] = useSearchParams();
  const demo = useStartDemo();
  const leftDemo = () => {
    const v = params.demo;
    return v === "1" || v === "true";
  };

  createEffect(() => {
    document.title = leftDemo() ? "You left the demo · Inventory Manager" : "Signed out · Inventory Manager";
  });

  const startDemo = (e: MouseEvent) => {
    e.preventDefault();
    void demo.start();
  };

  return (
    <main id="main" class="auth-layout" data-page="signed-out" tabindex="-1">
      <AuthBrand />

      <section class="auth-card is-centered" aria-labelledby="auth-title">
        <span class="empty-state-icon">
          <Icon name="check-circle" size={24} />
        </span>
        <div class="auth-head">
          <h1 class="auth-title" id="auth-title">
            {leftDemo() ? "You left the demo" : "You’ve been signed out"}
          </h1>
          <p class="auth-sub" id="auth-sub">
            {leftDemo()
              ? "Your demo workspace and all its data have been deleted. Start a new demo anytime — each one is a fresh copy with sample data."
              : "Sign in again to get back to your inventory."}
          </p>
        </div>

        <Show when={demo.error()}>
          {(msg) => <FormAlert title="Couldn’t start a demo">{msg()}</FormAlert>}
        </Show>

        <div class="auth-actions" id="actions">
          <Show
            when={leftDemo()}
            fallback={
              <a class="btn btn-primary btn-block" href="/sign-in">
                <span>
                  <Icon name="log-in" size={18} />
                </span>
                <span>Sign in</span>
              </a>
            }
          >
            <a
              class="btn btn-primary btn-block"
              href="/dashboard"
              id="demo-link"
              aria-busy={demo.pending() ? "true" : undefined}
              onClick={startDemo}
            >
              <Icon name="refresh-cw" size={18} />
              <span>{demo.pending() ? DEMO_LOADING_TEXT : "Start a new demo"}</span>
            </a>
            <a class="btn btn-secondary btn-block" href="/sign-up">
              <Icon name="user" size={18} />
              <span>Create an account</span>
            </a>
          </Show>
        </div>

        <Show
          when={leftDemo()}
          fallback={
            <p class="auth-footer" id="footer">
              Want to look around first?{" "}
              <a
                class="link"
                href="/dashboard"
                id="demo-link"
                aria-busy={demo.pending() ? "true" : undefined}
                onClick={startDemo}
              >
                {demo.pending() ? DEMO_LOADING_TEXT : "Try demo"}
              </a>
            </p>
          }
        >
          <p class="auth-footer" id="footer">
            Already have an account?{" "}
            <a class="link" href="/sign-in">
              Sign in
            </a>
          </p>
        </Show>
        <p class="visually-hidden" role="status" id="status-msg">
          {demo.pending() ? DEMO_LOADING_TEXT : ""}
        </p>
      </section>
    </main>
  );
}
