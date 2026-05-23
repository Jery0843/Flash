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
        <div className="home-badge">
          <span>🔒</span>
          <span>End-to-end encrypted · No storage</span>
        </div>

        <h1 className="home-title">
          Transfer files <span className="home-title-accent">instantly</span><br />
          between any devices
        </h1>

        <p className="home-subtitle">
          Flash connects browsers directly using WebRTC for blazing-fast, 
          encrypted peer-to-peer file transfer. No uploads, no servers storing 
          your data — just a secure link between you and your recipient, anywhere in the world.
        </p>

        <div className="home-actions">
          <Link to="/create" className="btn btn-primary btn-lg" id="send-file-btn">
            ⚡ Send a File
          </Link>
          <Link to="/join" className="btn btn-secondary btn-lg" id="receive-file-btn">
            📥 Receive a File
          </Link>
        </div>

        <div className="home-features">
          <div className="home-feature">
            <div className="home-feature-icon">🔐</div>
            <div className="home-feature-label">DTLS Encrypted</div>
          </div>
          <div className="home-feature">
            <div className="home-feature-icon">⚡</div>
            <div className="home-feature-label">P2P Transfer</div>
          </div>
          <div className="home-feature">
            <div className="home-feature-icon">🌍</div>
            <div className="home-feature-label">Works Anywhere</div>
          </div>
        </div>
      </div>
    </div>
  );
}
