import { useState, useEffect, useCallback } from "react";
import {
  listTokens,
  createToken as apiCreateToken,
  deleteToken as apiDeleteToken,
  type Token,
  type CreateTokenResponse,
} from "../lib/api";

export function useTokens() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [newlyCreated, setNewlyCreated] = useState<CreateTokenResponse | null>(
    null
  );

  useEffect(() => {
    listTokens()
      .then((t) => setTokens(t || []))
      .finally(() => setLoading(false));
  }, []);

  const createToken = useCallback(
    async (name: string, scopes: string[] = ["manage:keys"]) => {
      const resp = await apiCreateToken(name, scopes);
      setNewlyCreated(resp);
      // Refresh list
      const updated = await listTokens();
      setTokens(updated || []);
      return resp;
    },
    []
  );

  const deleteToken = useCallback(async (id: number) => {
    await apiDeleteToken(id);
    setTokens((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { tokens, loading, newlyCreated, createToken, deleteToken };
}
