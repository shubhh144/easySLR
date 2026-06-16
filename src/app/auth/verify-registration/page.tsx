"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "~/trpc/react";

function LogoMark() {
  return (
    <div style={{
      width: 44, height: 44, borderRadius: "var(--radius-max)",
      background: "var(--text-primary)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 16, fontWeight: 800, color: "var(--bg-deep)",
      letterSpacing: -1,
      boxShadow: "0 0 20px rgba(255,255,255,0.08)",
      border: "1px solid var(--border-subtle)",
    }}>
      SLR
    </div>
  );
}

function VerifyRegistrationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [redirectEmail, setRedirectEmail] = useState("");
  const [countdown, setCountdown] = useState(3);
  
  const verifyCallTriggered = useRef(false);

  const verifyRegistration = api.auth.verifyRegistration.useMutation({
    onSuccess: (data) => {
      setStatus("success");
      setRedirectEmail(data.email);
    },
    onError: (err) => {
      setStatus("error");
      setErrorMsg(err.message || "Invalid or expired verification token.");
    },
  });

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("Verification token is missing.");
      return;
    }

    if (verifyCallTriggered.current) return;
    verifyCallTriggered.current = true;

    verifyRegistration.mutate({ token });
  }, [token]);

  // Handle countdown decrement on success
  useEffect(() => {
    if (status !== "success") return;

    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [status]);

  // Navigate when countdown reaches 0
  useEffect(() => {
    if (status === "success" && countdown === 0) {
      router.push(`/auth/signin?verified=true&email=${encodeURIComponent(redirectEmail)}`);
    }
  }, [status, countdown, redirectEmail, router]);

  return (
    <div className="auth-card" style={{ maxWidth: 460, textAlign: "center" }}>
      {/* Logo */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32, gap: 12 }}>
        <LogoMark />
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)", letterSpacing: -0.4, margin: 0 }}>
            Activation
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 4 }}>
            Activating your Systematic Literature Review Workspace
          </p>
        </div>
      </div>

      {status === "loading" && (
        <div style={{ padding: "32px 0" }}>
          <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3, borderTopColor: "var(--text-primary)", margin: "0 auto 16px" }} />
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
            Verifying Token...
          </h2>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Confirming registration and provisioning your laboratory database and owner records. Please hold.
          </p>
        </div>
      )}

      {status === "success" && (
        <div style={{ padding: "8px 0" }}>
          <div style={{
            width: 44, height: 44, borderRadius: "var(--radius-max)",
            border: "1.5px solid var(--border-active)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px", fontSize: 13, color: "var(--text-primary)",
            fontWeight: 800,
          }}>
            DONE
          </div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
            Workspace Activated!
          </h2>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Your account and organization have been created successfully.<br />
            Redirecting you to login in <strong style={{ color: "var(--text-primary)" }}>{countdown}</strong> seconds...
          </p>
          <Link
            href={`/auth/signin?verified=true&email=${encodeURIComponent(redirectEmail)}`}
            className="btn btn-primary"
            style={{ marginTop: 24, width: "100%", textDecoration: "none", display: "flex", justifyContent: "center", alignItems: "center" }}
          >
            Sign In Now
          </Link>
        </div>
      )}

      {status === "error" && (
        <div style={{ padding: "8px 0" }}>
          <div style={{
            width: 44, height: 44, borderRadius: "var(--radius-max)",
            border: "1.5px solid #FF453A",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px", fontSize: 13, color: "#FF453A",
            fontWeight: 800,
          }}>
            FAIL
          </div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
            Verification Failed
          </h2>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 24 }}>
            {errorMsg}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Link
              href="/auth/signup"
              className="btn btn-primary"
              style={{ width: "100%", textDecoration: "none", display: "flex", justifyContent: "center", alignItems: "center" }}
            >
              Restart Registration
            </Link>
            <Link
              href="/auth/signin"
              className="btn btn-secondary"
              style={{ width: "100%", textDecoration: "none", display: "flex", justifyContent: "center", alignItems: "center" }}
            >
              Back to Sign In
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VerifyRegistrationPage() {
  return (
    <div className="auth-page">
      <Suspense fallback={
        <div className="auth-card" style={{ maxWidth: 460, textAlign: "center", padding: "48px 0" }}>
          <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3, borderTopColor: "var(--text-primary)", margin: "0 auto" }} />
        </div>
      }>
        <VerifyRegistrationContent />
      </Suspense>
    </div>
  );
}
