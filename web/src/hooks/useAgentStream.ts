import { useState, useEffect, useRef } from "react";
import { API_BASE, listAgents, type Agent } from "../lib/api";

export function useAgentStream() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [connected, setConnected] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const sse = new EventSource(`${API_BASE}/api/agents/stream`, {
      withCredentials: true,
    });
    sseRef.current = sse;

    sse.onopen = () => setConnected(true);

    sse.onmessage = (event) => {
      try {
        const data: Agent[] = JSON.parse(event.data);
        setAgents(data);
      } catch {
        /* ignore parse errors */
      }
    };

    sse.onerror = () => {
      sse.close();
      setConnected(false);
      // Fallback to REST
      listAgents()
        .then((a) => setAgents(a || []))
        .catch(() => {});
    };

    return () => {
      sse.close();
      sseRef.current = null;
    };
  }, []);

  return { agents, connected };
}
