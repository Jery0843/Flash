import { Link } from 'react-router-dom';
import './Home.css';

export function Home() {
  return (
    <div className="home-page">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg-orb" />
        <div className="home-bg-orb" />
        <div className="home-bg-orb" />
      </div>

      <div className="home-hero">
        <h1 className="home-title" data-text="FLASH">
          FLASH
        </h1>

        <div className="home-actions">
          <Link to="/create" className="btn btn-primary btn-lg" id="send-file-btn">
            Send
          </Link>
          <Link to="/join" className="btn btn-secondary btn-lg" id="receive-file-btn">
            Receive
          </Link>
        </div>
      </div>

      <div className="home-copyright">
        © 0xJerry
      </div>
    </div>
  );
}
