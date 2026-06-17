"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { api } from "~/trpc/react";

// ── Icons ──────────────────────────────────────────────────────────────────
const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const HomeIcon = () => <Icon><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></Icon>;
const PlusIcon = () => <Icon><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></Icon>;
const LogOutIcon = () => <Icon><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></Icon>;
const BuildingIcon = () => <Icon><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></Icon>;

type User = { id: string; name?: string | null; email?: string | null; image?: string | null };

function Avatar({ user }: { user: User }) {
  const initials = user.name
    ? user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : (user.email?.[0] ?? "?").toUpperCase();

  return user.image ? (
    <img src={user.image} alt={user.name ?? ""} style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover" }} />
  ) : (
    <div style={{
      width: 30, height: 30, borderRadius: "var(--radius-max)",
      background: "var(--text-primary)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, fontWeight: 700, color: "var(--bg-deep)",
    }}>
      {initials}
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────
function Sidebar({ user, isOpen, onClose }: { user: User; isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { data: orgs } = api.organization.listMine.useQuery();
  const [lightMode, setLightMode] = useState(false);

  useEffect(() => {
    const isLight = document.body.classList.contains("light-mode");
    setLightMode(isLight);
  }, []);

  const toggleTheme = () => {
    const nextMode = !lightMode;
    setLightMode(nextMode);
    if (nextMode) {
      document.body.classList.add("light-mode");
      localStorage.setItem("theme", "light");
    } else {
      document.body.classList.remove("light-mode");
      localStorage.setItem("theme", "dark");
    }
  };

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  return (
    <>
      <nav className={`sidebar ${isOpen ? "open" : ""}`}>
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">SLR</div>
          <span className="sidebar-logo-text">EasySLR</span>
        </div>

        {/* Main nav */}
        <Link href="/dashboard" className={`nav-link ${isActive("/dashboard") ? "active" : ""}`} onClick={onClose}>
          <HomeIcon /> Dashboard
        </Link>

        {/* Organizations */}
        {orgs && orgs.length > 0 && (
          <>
            <div className="sidebar-section-label">Organizations</div>
            {orgs.map((org) => (
              <Link
                key={org.id}
                href={`/org/${org.id}`}
                className={`nav-link ${isActive(`/org/${org.id}`) ? "active" : ""}`}
                onClick={onClose}
              >
                <BuildingIcon />
                <span className="truncate" style={{ maxWidth: 150 }}>{org.name}</span>
              </Link>
            ))}
          </>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="nav-link"
          style={{ color: "var(--text-muted)", cursor: "pointer", marginBottom: 8 }}
        >
          {lightMode ? (
            <>
              <Icon>
                <circle cx="12" cy="12" r="4"/>
                <path d="M12 2v2"/>
                <path d="M12 20v2"/>
                <path d="m4.93 4.93 1.41 1.41"/>
                <path d="m17.66 17.66 1.41 1.41"/>
                <path d="M2 12h2"/>
                <path d="M20 12h2"/>
                <path d="m6.34 17.66-1.41 1.41"/>
                <path d="m19.07 4.93-1.41 1.41"/>
              </Icon>
              Dark Mode
            </>
          ) : (
            <>
              <Icon><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></Icon>
              Light Mode
            </>
          )}
        </button>

        {/* User footer */}
        <div className="separator" />
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
          <Avatar user={user} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="truncate" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
              {user.name ?? user.email?.split("@")[0] ?? "Researcher"}
            </div>
            <div className="truncate" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              {user.email}
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            className="btn-icon btn-ghost"
            title="Sign out"
            style={{ color: "var(--text-muted)", cursor: "pointer", border: "none", background: "none" }}
          >
            <LogOutIcon />
          </button>
        </div>
      </nav>
    </>
  );
}

// ── App Shell ──────────────────────────────────────────────────────────────
export function AppShell({ children, user }: { children: React.ReactNode; user: User }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);
  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="app-shell">
      {/* Mobile Header */}
      <header className="mobile-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={toggleMobileMenu}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-primary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 4,
            }}
            title="Toggle Menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" x2="20" y1="12" y2="12" />
              <line x1="4" x2="20" y1="6" y2="6" />
              <line x1="4" x2="20" y1="18" y2="18" />
            </svg>
          </button>
          <span className="sidebar-logo-text">EasySLR</span>
        </div>
      </header>

      {/* Backdrop for mobile drawer */}
      <div
        className={`sidebar-backdrop ${isMobileMenuOpen ? "open" : ""}`}
        onClick={closeMobileMenu}
      />

      <Sidebar user={user} isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
      <main className="main-content">{children}</main>
    </div>
  );
}
