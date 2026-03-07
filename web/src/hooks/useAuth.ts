import { useState, useEffect, useCallback } from "react";
import { getMe, logout as apiLogout, setLoggedIn, type User } from "../lib/api";
import { useNavigate } from "react-router-dom";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => {
        setLoggedIn(false);
        navigate("/", { replace: true });
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  const logout = useCallback(async () => {
    await apiLogout();
    navigate("/", { replace: true });
    window.location.reload();
  }, [navigate]);

  return { user, loading, logout };
}
