import { isLoggedIn, setLoggedIn, getMe } from "./lib/api";
import { renderLogin } from "./pages/login";
import { renderDashboard } from "./pages/dashboard";
import { renderHowToUse } from "./pages/how-to-use";

const app = document.getElementById("app")!;

function route() {
  const hash = window.location.hash;

  // Public routes (no auth required)
  if (hash === "#/how-to-use") {
    renderHowToUse(app);
    return;
  }

  // Handle OAuth callback — session is in httpOnly cookie, verify with /api/me
  if (hash.startsWith("#/callback")) {
    getMe()
      .then(() => {
        setLoggedIn(true);
        window.location.hash = "#/dashboard";
      })
      .catch(() => {
        setLoggedIn(false);
        window.location.hash = "#/";
      });
    app.innerHTML = '<p style="text-align:center;padding:2rem;color:#8b949e;">Signing in...</p>';
    return;
  }

  if (!isLoggedIn()) {
    renderLogin(app);
    return;
  }

  if (hash === "#/dashboard" || hash === "" || hash === "#/") {
    renderDashboard(app);
    return;
  }

  // Default
  renderDashboard(app);
}

window.addEventListener("hashchange", route);
route();
