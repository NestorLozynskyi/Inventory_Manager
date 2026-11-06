/** 404 — screens/404.html. */
import { useNavigate } from "@solidjs/router";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/Icon";
import "./NotFound.css";

export default function NotFound() {
  const navigate = useNavigate();
  const back = () => {
    if (window.history.length > 1) window.history.back();
    else navigate("/dashboard");
  };
  return (
    <AppShell active={null} title="Page not found">
      <section class="card nf-card" aria-labelledby="nf-title">
        <div class="empty-state">
          <span class="empty-state-icon" aria-hidden="true">
            <Icon name="file-text" size={24} />
          </span>
          <p class="nf-code">Error 404</p>
          <h1 class="empty-state-title" id="nf-title">
            Page not found
          </h1>
          <p class="empty-state-text">The page or document you’re looking for doesn’t exist or was removed.</p>
          <div class="empty-state-actions">
            <a class="btn btn-primary" href="/dashboard">
              <span aria-hidden="true">
                <Icon name="dashboard" size={18} />
              </span>
              <span>Go to dashboard</span>
            </a>
            <button type="button" class="btn btn-secondary" id="back-btn" onClick={back}>
              <span aria-hidden="true">
                <Icon name="arrow-left" size={18} />
              </span>
              <span>Back</span>
            </button>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
