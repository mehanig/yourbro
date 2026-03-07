import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { HowToUsePage } from "./pages/HowToUsePage";
import { OAuthCallback } from "./pages/OAuthCallback";
import { RequireAuth } from "./components/RequireAuth";

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/callback" element={<OAuthCallback />} />
        <Route path="/how-to-use" element={<HowToUsePage />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
