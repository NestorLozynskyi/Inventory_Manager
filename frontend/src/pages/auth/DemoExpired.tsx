/** Demo expired — screens/demo-expired.html. */
import { Show, onMount, type JSX } from "solid-js";
import { Icon } from "../../components/Icon";
import { AuthBrand, DEMO_LOADING_TEXT, FormAlert, useStartDemo } from "./authShared";
import "./DemoExpired.css";

export default function DemoExpired(): JSX.Element {
  const demo = useStartDemo();
  onMount(() => {
    document.title = "Demo session ended · Inventory Manager";
  });

  return (
    <main id="main" class="auth-layout" data-page="demo-expired" tabindex="-1">
      <AuthBrand />

      <section class="auth-card is-centered" aria-labelledby="auth-title">
        <span class="empty-state-icon">
          <Icon name="clock" size={24} />
        </span>
        <div class="auth-head">
          <h1 class="auth-title" id="auth-title">
            Your demo session has ended
          </h1>
          <p class="auth-sub">This demo lasted 24 hours and has expired. All of its data has been deleted.</p>
        </div>

        <ul class="facts" aria-label="What this means">
          <li>
            <span>
              <Icon name="trash" size={16} />
            </span>
            <span>Products, documents and history from this demo are gone for good.</span>
          </li>
          <li>
            <span>
              <Icon name="refresh-cw" size={16} />
            </span>
            <span>A new demo starts with fresh sample data and lasts another 24 hours.</span>
          </li>
          <li>
            <span>
              <Icon name="info" size={16} />
            </span>
            <span>A new account starts with an empty workspace — demo data isn’t transferred.</span>
          </li>
        </ul>

        <Show when={demo.error()}>
          {(msg) => <FormAlert title="Couldn’t start a demo">{msg()}</FormAlert>}
        </Show>

        <div class="auth-actions">
          <button
            type="button"
            class={`btn btn-primary btn-block${demo.pending() ? " is-pending" : ""}`}
            id="new-demo-btn"
            aria-busy={demo.pending() ? "true" : undefined}
            onClick={() => void demo.start()}
          >
            <Show
              when={demo.pending()}
              fallback={
                <>
                  <span>
                    <Icon name="refresh-cw" size={18} />
                  </span>
                  <span>Start a new demo</span>
                </>
              }
            >
              <span class="spinner" aria-hidden="true" />
              <span>{DEMO_LOADING_TEXT}</span>
            </Show>
          </button>
          <a class="btn btn-secondary btn-block" href="/sign-up">
            Create an account
          </a>
        </div>

        <p class="auth-footer">
          Already have an account?{" "}
          <a class="link" href="/sign-in">
            Sign in
          </a>
        </p>
        <p class="visually-hidden" role="status" id="status-msg">
          {demo.pending() ? DEMO_LOADING_TEXT : ""}
        </p>
      </section>
    </main>
  );
}
