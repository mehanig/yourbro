export function renderLogin(container: HTMLElement) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;gap:2rem;">
      <h1 style="font-size:3rem;font-weight:800;letter-spacing:-0.02em;">yourbro</h1>
      <p style="color:#8b949e;font-size:1.1rem;text-align:center;max-width:400px;">
        AI-published pages with scoped storage. Let your agents build and share web pages.
      </p>
      <a href="#/how-to-use" style="color:#58a6ff;text-decoration:none;font-size:0.95rem;">How to Use</a>
      <a href="/auth/google"
         style="display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 1.5rem;background:#e6edf3;color:#0d1117;border-radius:8px;text-decoration:none;font-weight:600;font-size:1rem;transition:opacity 0.2s;"
         onmouseover="this.style.opacity='0.85'"
         onmouseout="this.style.opacity='1'">
        Sign in with Google
      </a>
    </div>
  `;
}
