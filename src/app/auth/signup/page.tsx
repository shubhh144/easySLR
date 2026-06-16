"use client";

import { useState } from "react";
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

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [institution, setInstitution] = useState("");
  const [orgName, setOrgName] = useState("");
  
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const registerOwner = api.auth.registerOwner.useMutation({
    onSuccess: () => {
      setSent(true);
      setError("");
    },
    onError: (err) => {
      setError(err.message || "An unexpected registration error occurred.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !orgName) return;
    registerOwner.mutate({
      name: name.trim(),
      email: email.trim(),
      institution: institution.trim() || undefined,
      organizationName: orgName.trim(),
    });
  };

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 460 }}>
        
        {/* Logo */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32, gap: 12 }}>
          <LogoMark />
          <div style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)", letterSpacing: -0.4, margin: 0 }}>
              Register Laboratory
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 4 }}>
              Establish your EasySLR workspace as an Organization Owner
            </p>
          </div>
        </div>

        {sent ? (
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{
              width: 44, height: 44, borderRadius: "var(--radius-max)",
              border: "1.5px solid var(--border-active)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 20px", fontSize: 13, color: "var(--text-primary)",
              fontWeight: 800,
            }}>
              MAIL
            </div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
              Verification Email Sent
            </h2>
            <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
              A verification link has been sent to <strong style={{ color: "var(--text-primary)" }}>{email}</strong>.<br />
              Please click the link in your email to verify and activate your laboratory.
            </p>


            <Link href="/auth/signin" className="btn btn-secondary" style={{ marginTop: 24, width: "100%", textDecoration: "none", display: "flex", justifyContent: "center", alignItems: "center" }}>
              Back to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {error && (
              <div className="alert alert-error" style={{ fontSize: 12.5, padding: "10px 14px" }}>
                {error}
              </div>
            )}

            <div className="field">
              <label className="label">Full Name <span style={{ color: "#FF453A" }}>*</span></label>
              <input
                className="input"
                type="text"
                placeholder="e.g. Dr. Sarah Jenkins"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{ height: 40 }}
              />
            </div>

            <div className="field">
              <label className="label">Work Email <span style={{ color: "#FF453A" }}>*</span></label>
              <input
                className="input"
                type="email"
                placeholder="name@institution.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ height: 40 }}
              />
            </div>

            <div className="field">
              <label className="label">Institution / Affiliation <span style={{ opacity: 0.5 }}>(Optional)</span></label>
              <input
                className="input"
                type="text"
                placeholder="e.g. Johns Hopkins Medicine"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                style={{ height: 40 }}
              />
            </div>

            <div className="field" style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>
              <label className="label">Organization / Lab Name <span style={{ color: "#FF453A" }}>*</span></label>
              <input
                className="input"
                type="text"
                placeholder="e.g. Jenkins Oncology Lab"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
                style={{ height: 40 }}
              />
              <span className="field-hint" style={{ marginTop: 4 }}>
                This will be the root workspace container for your reviews and team members.
              </span>
            </div>

            <button
              type="submit"
              disabled={registerOwner.isPending || !name || !email || !orgName}
              className="btn btn-primary"
              style={{ width: "100%", height: 40, fontSize: 13.5, fontWeight: 600, marginTop: 8 }}
            >
              {registerOwner.isPending ? <span className="spinner" style={{ borderTopColor: "var(--bg-deep)" }} /> : "Register Lab & Verify Email"}
            </button>

            <div style={{ textAlign: "center", marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>
              Already have a workspace or pending invitation?<br />
              <Link href="/auth/signin" style={{ color: "var(--text-primary)", fontWeight: 600, textDecoration: "underline", marginLeft: 4 }}>
                Sign In
              </Link>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
