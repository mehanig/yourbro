import { isLoggedIn, setToken } from "./lib/api";
import { renderLogin } from "./pages/login";
import { renderDashboard } from "./pages/dashboard";

const app = document.getElementById("app")!;

function route() {
  const hash = window.location.hash;

  // Handle OAuth callback
  if (hash.startsWith("#/callback")) {
    const params = new URLSearchParams(hash.split("?")[1] || "");
    const token = params.get("token");
    if (token) {
      setToken(token);
      window.location.hash = "#/dashboard";
      return;
    }
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
