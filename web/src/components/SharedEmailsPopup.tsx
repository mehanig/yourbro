import { useEffect, useRef } from "react";

export function SharedEmailsPopup({
  emails,
  onClose,
}: {
  emails: string[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="list"
      aria-label="Shared email addresses"
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 0,
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 8,
        padding: "12px 14px",
        zIndex: 100,
        minWidth: 240,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div
        style={{
          color: "#8b949e",
          fontSize: "0.75rem",
          marginBottom: 8,
          lineHeight: 1.6,
        }}
      >
        You can only manage this list using your OpenClaw
      </div>
      {emails.map((email) => (
        <div
          key={email}
          role="listitem"
          style={{
            color: "#d2a8ff",
            fontSize: "0.8rem",
            padding: "3px 0",
          }}
        >
          {email}
        </div>
      ))}
    </div>
  );
}
