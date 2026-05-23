import { Link } from 'react-router-dom';
import './ErrorPage.css';

export function ErrorPage() {
  return (
    <div className="error-page">
      <div className="error-icon">🔍</div>
      <h1 className="error-title">Page Not Found</h1>
      <p className="error-message">
        The page you're looking for doesn't exist or the room may have expired.
      </p>
      <div className="error-actions">
        <Link to="/" className="btn btn-primary" id="error-home-btn">
          ← Back to Home
        </Link>
      </div>
    </div>
  );
}
