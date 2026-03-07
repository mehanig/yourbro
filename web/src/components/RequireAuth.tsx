import { Navigate } from "react-router-dom";
import { isLoggedIn } from "../lib/api";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/" replace />;
  return <>{children}</>;
}
