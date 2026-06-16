"use client";

import { useState, useEffect, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "~/trpc/react";

// ── Icons (Pure SVG) ───────────────────────────────────────────────────────
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

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="currentColor"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="currentColor" style={{ opacity: 0.8 }}/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="currentColor" style={{ opacity: 0.6 }}/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="currentColor" style={{ opacity: 0.9 }}/>
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2"/>
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
    </svg>
  );
}

function getErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "CredentialsSignin":
    case "AccessDenied":
    case "CallbackRouteError":
      return "No active workspace invitation found. Please contact your Lab Owner.";
    case "Verification":
      return "The sign-in link is invalid or has expired. Please request a new link.";
    case "Configuration":
      return "There is a server configuration issue. Please check your environment settings.";
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthCreateAccount":
    case "EmailSignin":
      return "Authentication failed. Please check your credentials or configuration.";
    default:
      return "Authentication failed. Please check your credentials.";
  }
}

function SignInContent() {
  const searchParams = useSearchParams();
  const verified = searchParams.get("verified") === "true";
  const verifiedEmail = searchParams.get("email");
  const nextAuthError = searchParams.get("error");

  const [email, setEmail]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [sent, setSent]           = useState(false);
  const [error, setError]         = useState("");

  // Handle errors from NextAuth (e.g. uninvited user blocked by signIn callback or adapter createUser block)
  useEffect(() => {
    if (nextAuthError) {
      setError(getErrorMessage(nextAuthError));
    }
  }, [nextAuthError]);

  // Check if Google OAuth is configured and active in NextAuth
  useEffect(() => {
    fetch("/api/auth/providers")
      .then((res) => res.json())
      .then((providers) => {
        if (providers && providers.google) {
          setGoogleEnabled(true);
        }
      })
      .catch((e) => console.error("Failed to query providers:", e));
  }, []);

  // Pre-fill email if redirected from verification page
  useEffect(() => {
    if (verified && verifiedEmail) {
      setEmail(verifiedEmail);
    }
  }, [verified, verifiedEmail]);

  const checkEmail = api.auth.checkEmailRegistered.useMutation();

  // Email magic link / Dev Login
  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError("");
    try {
      // 1. Run tRPC query first to see if user exists and has org memberships
      const checkRes = await checkEmail.mutateAsync({ email: email.trim() });
      if (!checkRes.registered) {
        setError("This email is not registered. Please register your laboratory first.");
        setLoading(false);
        return;
      }

      // 2. Proceed to NextAuth sign in only if registered
      const res = await signIn("email", {
        email,
        redirect: false,
        callbackUrl: "/dashboard",
      });
      if (res?.error) {
        setError("Could not send magic link. Verify SMTP connection settings.");
      } else {
        setSent(true);
      }
    } catch (e: any) {
      setError(e?.message || "An unexpected authentication error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    await signIn("google", { callbackUrl: "/dashboard" });
  };

  return (
    <div className="auth-card">

      {/* Logo */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32, gap: 12 }}>
        <LogoMark />
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)", letterSpacing: -0.4, margin: 0 }}>
            EasySLR
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 4 }}>
            Systematic Literature Review Workspace
          </p>
        </div>
      </div>

      {verified && (
        <div className="alert alert-success" style={{ marginBottom: 20, fontSize: 13, padding: "10px 14px", border: "1px solid var(--border-active)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}>
          <strong style={{ display: "block", marginBottom: 2 }}>Workspace Activated!</strong>
          Your account is verified. Sign in below to enter your laboratory workspace.
        </div>
      )}

      {sent ? (
        /* ── Email sent ── */
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={{
            width: 44, height: 44, borderRadius: "var(--radius-max)",
            border: "1.5px solid var(--border-active)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px", fontSize: 13, color: "var(--text-primary)",
            fontWeight: 800,
          }}>
            LINK
          </div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Verification link sent</h2>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
            A magic link has been sent to{" "}
            <strong style={{ color: "var(--text-primary)" }}>{email}</strong>.<br />
            Open the link to authenticate.
          </p>
          <button
            onClick={() => { setSent(false); setEmail(""); }}
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 24, width: "100%" }}
          >
            Use another email
          </button>
        </div>
      ) : (
        <>
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 16, fontSize: 12.5, padding: "8px 12px" }}>
              {error}
            </div>
          )}

          {/* Google */}
          {googleEnabled && (
            <button
              onClick={handleGoogleSignIn}
              disabled={googleLoading || loading}
              className="btn btn-secondary"
              style={{ width: "100%", marginBottom: 12, gap: 10, height: 40, fontSize: 13.5 }}
            >
              {googleLoading ? (
                <span className="spinner" />
              ) : (
                <GoogleIcon />
              )}
              Continue with Google
            </button>
          )}

          {googleEnabled && <div className="divider" style={{ marginBottom: 20 }}>Or authenticate via email</div>}

          {/* Email magic link */}
          <form onSubmit={handleEmailSignIn} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field">
              <label className="label">Work Email <span style={{ color: "#FF453A" }}>*</span></label>
              <input
                className="input"
                type="email"
                placeholder="name@institution.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                style={{ height: 40 }}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email}
              className="btn btn-primary"
              style={{ width: "100%", gap: 8, height: 40, fontSize: 13.5 }}
            >
              {loading ? (
                <span className="spinner" style={{ borderTopColor: "var(--bg-deep)" }} />
              ) : (
                <MailIcon />
              )}
              Send Magic Link
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>
            Are you a Principal Investigator setting up a new lab?<br />
            <Link href="/auth/signup" style={{ color: "var(--text-primary)", fontWeight: 600, textDecoration: "underline", marginLeft: 4 }}>
              Register Laboratory
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="auth-page">
      <Suspense fallback={
        <div className="auth-card" style={{ textAlign: "center", padding: "48px 0" }}>
          <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3, borderTopColor: "var(--text-primary)", margin: "0 auto" }} />
        </div>
      }>
        <SignInContent />
      </Suspense>
    </div>
  );
}
