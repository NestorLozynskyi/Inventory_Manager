/** Sign in — screens/sign-in.html (states: default, validation, wrong credentials, too many attempts, demo loading). */
import { Show, createSignal, onMount, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { ApiError } from "../../api/client";
import { Icon } from "../../components/Icon";
import { loadMe, signIn } from "../../lib/auth";
import {
  AuthBrand,
  DEMO_LOADING_TEXT,
  EMAIL_RE,
  ErrorSummary,
  FieldError,
  FormAlert,
  PasswordToggle,
  demoErrorText,
  useStartDemo,
  type SummaryItem,
} from "./authShared";
import "./SignIn.css";

type FieldId = "email" | "password";
type Errors = Partial<Record<FieldId, string>>;
interface Alert {
  title: string;
  body: string;
}

export function emailError(v: string): string {
  const t = v.trim();
  if (!t) return "Enter your email address";
  if (!EMAIL_RE.test(t)) return "Enter a valid email address, like name@example.com";
  return "";
}

export default function SignIn(): JSX.Element {
  const navigate = useNavigate();
  const demo = useStartDemo();
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [showPw, setShowPw] = createSignal(false);
  const [errors, setErrors] = createSignal<Errors>({});
  const [summary, setSummary] = createSignal<SummaryItem[]>([]);
  const [alert, setAlert] = createSignal<Alert | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const touched: Partial<Record<FieldId, boolean>> = {};
  let alertEl: HTMLDivElement | undefined;
  let summaryEl: HTMLDivElement | undefined;

  onMount(() => {
    document.title = "Sign in · Inventory Manager";
  });

  const busy = () => submitting() || demo.pending();
  const rule = (id: FieldId) => (id === "email" ? emailError(email()) : password() ? "" : "Enter your password");
  const setFieldError = (id: FieldId, msg: string) => setErrors((e) => ({ ...e, [id]: msg || undefined }));
  const check = (id: FieldId) => setFieldError(id, rule(id));

  const onInput = (id: FieldId, value: string) => {
    (id === "email" ? setEmail : setPassword)(value);
    touched[id] = true;
    if (errors()[id]) check(id);
  };
  const onBlur = (id: FieldId) => {
    if (touched[id]) check(id);
  };

  const showErrors = (errs: SummaryItem[]) => {
    setErrors(Object.fromEntries(errs.map((e) => [e.id, e.msg])) as Errors);
    setSummary(errs.length >= 2 ? errs : []);
    queueMicrotask(() => {
      if (errs.length >= 2) summaryEl?.focus();
      else if (errs[0]) document.getElementById(errs[0].id)?.focus();
    });
  };

  const showAlert = (a: Alert) => {
    setSummary([]);
    setAlert(a);
    queueMicrotask(() => alertEl?.focus());
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    touched.email = touched.password = true;
    setAlert(null);
    const errs: SummaryItem[] = [];
    for (const id of ["email", "password"] as FieldId[]) {
      const m = rule(id);
      if (m) errs.push({ id, msg: m });
    }
    if (errs.length) {
      showErrors(errs);
      return;
    }
    setErrors({});
    setSummary([]);
    setSubmitting(true);
    try {
      await signIn({ email: email().trim(), password: password() });
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.code === "invalid_credentials") {
        setPassword("");
        showAlert({ title: "Couldn’t sign you in", body: "Email or password is incorrect. Check them and try again." });
      } else if (err instanceof ApiError && err.code === "too_many_attempts") {
        showAlert({ title: "Too many sign-in attempts", body: err.message });
      } else if (err instanceof ApiError && Object.keys(err.fieldErrors()).length) {
        const fe = err.fieldErrors();
        showErrors(
          (["email", "password"] as FieldId[]).filter((id) => fe[id]).map((id) => ({ id, msg: fe[id] })),
        );
      } else {
        showAlert({ title: "Couldn’t sign you in", body: demoErrorText(err) });
      }
      return;
    }
    navigate("/dashboard", { replace: true });
    void loadMe(true).catch(() => undefined);
  };

  const tryDemo = async () => {
    setAlert(null);
    setSummary([]);
    const ok = await demo.start();
    if (!ok && demo.error()) showAlert({ title: "Couldn’t start a demo", body: demo.error()! });
  };

  const fieldClass = (id: FieldId) => `field${errors()[id] ? " is-invalid" : ""}`;

  return (
    <main id="main" class="auth-layout" data-page="sign-in" tabindex="-1">
      <AuthBrand />

      <section class="auth-card" aria-labelledby="auth-title">
        <div class="auth-head">
          <h1 class="auth-title" id="auth-title">
            Sign in
          </h1>
          <p class="auth-sub">Welcome back. Sign in to manage your stock.</p>
        </div>

        <div id="form-messages" aria-live="assertive">
          <Show when={summary().length >= 2}>
            <ErrorSummary
              ref={(el) => (summaryEl = el)}
              title={`There are ${summary().length} problems with your sign-in details`}
              items={summary()}
            />
          </Show>
          <Show when={alert()}>
            {(a) => (
              <FormAlert ref={(el) => (alertEl = el)} id="cred-alert" title={a().title}>
                {a().body}
              </FormAlert>
            )}
          </Show>
        </div>

        <form id="sign-in-form" class="auth-form" novalidate onSubmit={submit}>
          <fieldset id="sign-in-fields" disabled={busy()}>
            <legend class="visually-hidden">Sign in with email and password</legend>

            <div class={fieldClass("email")} id="field-email">
              <label for="email">Email</label>
              <input
                class="input"
                id="email"
                name="email"
                type="email"
                autocomplete="email"
                inputmode="email"
                spellcheck={false}
                aria-describedby="email-error"
                aria-invalid={errors().email ? "true" : undefined}
                value={email()}
                onInput={(e) => onInput("email", e.currentTarget.value)}
                onBlur={() => onBlur("email")}
              />
              <FieldError id="email-error" message={errors().email} />
            </div>

            <div class={fieldClass("password")} id="field-password">
              <label for="password">Password</label>
              <div class="input-group">
                <input
                  class="input"
                  id="password"
                  name="password"
                  type={showPw() ? "text" : "password"}
                  autocomplete="current-password"
                  aria-describedby="password-error"
                  aria-invalid={errors().password ? "true" : undefined}
                  value={password()}
                  onInput={(e) => onInput("password", e.currentTarget.value)}
                  onBlur={() => onBlur("password")}
                />
                <PasswordToggle
                  controls="password"
                  shown={showPw()}
                  onToggle={() => setShowPw((v) => !v)}
                  disabled={busy()}
                />
              </div>
              <FieldError id="password-error" message={errors().password} />
            </div>

            <button
              type="submit"
              class={`btn btn-primary btn-block auth-submit${submitting() ? " is-loading" : ""}`}
              id="sign-in-btn"
              aria-busy={submitting() ? "true" : undefined}
            >
              <span>Sign in</span>
            </button>
          </fieldset>
        </form>

        <p class="auth-footer">
          New to Inventory Manager?{" "}
          <a
            class="link"
            href="/sign-up"
            id="sign-up-link"
            aria-disabled={busy() ? "true" : undefined}
            tabindex={busy() ? -1 : undefined}
            style={busy() ? { "pointer-events": "none" } : undefined}
          >
            Create an account
          </a>
        </p>

        <div class="auth-or" aria-hidden="true">
          or
        </div>

        <div class="demo-note">
          <button
            type="button"
            class={`btn btn-demo btn-block${demo.pending() ? " is-pending" : ""}`}
            id="demo-btn"
            aria-describedby="demo-hint"
            aria-busy={demo.pending() ? "true" : undefined}
            aria-disabled={demo.pending() ? "true" : undefined}
            disabled={submitting()}
            onClick={tryDemo}
          >
            <Show
              when={demo.pending()}
              fallback={
                <>
                  <span>
                    <Icon name="monitor" size={18} />
                  </span>
                  <span class="demo-btn-label">Try demo</span>
                </>
              }
            >
              <span class="spinner" aria-hidden="true" />
              <span>{DEMO_LOADING_TEXT}</span>
            </Show>
          </button>
          <p class="hint" id="demo-hint">
            Explore with sample data — no sign-up. Each demo is a private, fully editable copy that is deleted after 24
            hours or when you sign out.
          </p>
        </div>

        <p class="visually-hidden" role="status" id="status-msg">
          {submitting() ? "Signing in…" : demo.pending() ? DEMO_LOADING_TEXT : ""}
        </p>
      </section>
    </main>
  );
}
