import { Link, Outlet } from 'react-router-dom';
import './Layout.css';

export function Layout() {
  return (
    <>
      <header className="layout-header">
        <div className="layout-header-inner">
          <Link to="/" className="layout-logo" id="nav-home">
            <span className="layout-logo-text">BLITZ</span>
          </Link>
        </div>
      </header>
      <main className="layout-main">
        <Outlet />
      </main>
    </>
  );
}
