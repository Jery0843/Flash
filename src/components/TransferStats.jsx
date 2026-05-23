import { formatSpeed, formatETA } from '../lib/constants';
import { CONNECTION_TYPES } from '../lib/constants';
import './TransferStats.css';

const CONNECTION_LABELS = {
  [CONNECTION_TYPES.DIRECT]: '🟢 Direct P2P',
  [CONNECTION_TYPES.RELAY]: '🔵 TURN Relay',
  [CONNECTION_TYPES.WS_RELAY]: '🟡 Server Relay',
};

export function TransferStats({ stats, connectionType }) {
  if (!stats) return null;

  return (
    <div>
      <div className="transfer-stats" id="transfer-stats">
        <div className="stat-item">
          <div className="stat-label">Speed</div>
          <div className="stat-value speed">{formatSpeed(stats.speed)}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">ETA</div>
          <div className="stat-value eta">{formatETA(stats.eta)}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">Elapsed</div>
          <div className="stat-value">{formatETA(stats.elapsed)}</div>
        </div>
      </div>
      {connectionType && (
        <div style={{ textAlign: 'center' }}>
          <span className="connection-type-badge" data-type={connectionType}>
            {CONNECTION_LABELS[connectionType] || connectionType}
          </span>
        </div>
      )}
    </div>
  );
}
