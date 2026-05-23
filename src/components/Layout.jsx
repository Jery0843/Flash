import { Link, Outlet } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import './Layout.css';

export function Layout() {
  return (
    <>
      <header className="layout-header">
        <div className="layout-header-inner">
          <Link to="/" className="layout-logo" id="nav-home">
            <div className="layout-logo-icon">⚡</div>
            <span className="layout-logo-text">Flash</span>
          </Link>
          <div className="layout-header-actions">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="layout-main">
        <Outlet />
      </main>
      <footer className="layout-footer">
        <div className="layout-footer-inner">
          <span>Flash — Secure P2P file transfer</span>
          <div className="layout-footer-links">
            <span>No storage · No tracking · Encrypted</span>
          </div>
        </div>
      </footer>
    </>
  );
}
