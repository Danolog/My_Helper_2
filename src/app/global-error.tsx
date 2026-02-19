"use client";

import { useEffect } from "react";

/**
 * Global error boundary - catches errors in the root layout itself.
 * This is the last line of defense for unrecoverable errors.
 * Must include its own <html> and <body> tags since it replaces the root layout.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global application error:", error);
  }, [error]);

  return (
    <html lang="pl">
      <body
        style={{
          margin: 0,
          padding: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          backgroundColor: "#fafafa",
          color: "#171717",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "16px",
          }}
        >
          <div
            style={{
              maxWidth: "480px",
              width: "100%",
              textAlign: "center",
            }}
          >
            {/* Error icon */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: "24px",
              }}
            >
              <div
                style={{
                  width: "80px",
                  height: "80px",
                  borderRadius: "50%",
                  backgroundColor: "#fef2f2",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "40px",
                }}
              >
                ⚠️
              </div>
            </div>

            {/* Error code */}
            <p
              style={{
                fontSize: "64px",
                fontWeight: "bold",
                color: "#a3a3a3",
                margin: "0 0 8px 0",
                lineHeight: 1,
              }}
            >
              500
            </p>

            {/* Title */}
            <h1
              style={{
                fontSize: "24px",
                fontWeight: 600,
                margin: "0 0 12px 0",
              }}
            >
              Blad serwera
            </h1>

            {/* Apology message */}
            <p
              style={{
                fontSize: "16px",
                color: "#737373",
                margin: "0 0 32px 0",
                lineHeight: 1.6,
              }}
            >
              Przepraszamy za niedogodnosc. Wystapil nieoczekiwany blad serwera.
              Nasz zespol zostal powiadomiony. Sprobuj odswiezyc strone lub wroc
              na strone glowna.
            </p>

            {/* Action buttons */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={reset}
                style={{
                  padding: "10px 20px",
                  fontSize: "14px",
                  fontWeight: 500,
                  backgroundColor: "#171717",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                ↻ Sprobuj ponownie
              </button>
              <button
                onClick={() => (window.location.href = "/")}
                style={{
                  padding: "10px 20px",
                  fontSize: "14px",
                  fontWeight: 500,
                  backgroundColor: "#ffffff",
                  color: "#171717",
                  border: "1px solid #e5e5e5",
                  borderRadius: "8px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                🏠 Strona glowna
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
