import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getMe, setLoggedIn } from "../lib/api";

export function OAuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    getMe()
      .then(() => {
        setLoggedIn(true);
        navigate("/dashboard", { replace: true });
      })
      .catch(() => {
        setLoggedIn(false);
        navigate("/", { replace: true });
      });
  }, [navigate]);

  return (
    <p style={{ textAlign: "center", padding: "2rem", color: "#8b949e" }}>
      Signing in...
    </p>
  );
}
