import { formatFileSize, formatSpeed, formatETA } from '../lib/constants';
import './ReceiverList.css';

const STATUS_LABEL = {
  'pending-approval': 'Waiting for approval',
  connecting: 'Connecting…',
  transferring: 'Transferring',
  completed: 'Completed',
  failed: 'Failed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  disconnected: 'Disconnected',
};

function shortId(peerId) {
  if (!peerId) return '?';
  return peerId.slice(0, 6).toUpperCase();
}

export function ReceiverList({ peers, onApprove, onReject, onCancel }) {
  if (!peers || peers.length === 0) {
    return (
      <div className="receiver-list-empty">
        Waiting for receivers to join…
      </div>
    );
  }

  return (
    <div className="receiver-list">
      {peers.map((p) => {
        const isPending = p.status === 'pending-approval';
        const isActive = p.status === 'connecting' || p.status === 'transferring';
        const pct = p.progress?.percentage ?? 0;

        return (
          <div className={`receiver-card status-${p.status}`} key={p.peerId}>
            <div className="receiver-card-row">
              <div className="receiver-card-id">
                <span className="receiver-card-avatar">👤</span>
                <span className="receiver-card-code">Receiver {shortId(p.peerId)}</span>
                {p.connectionType && (
                  <span className="receiver-card-conn">{p.connectionType}</span>
                )}
              </div>
              <div className={`receiver-card-status status-pill-${p.status}`}>
                {STATUS_LABEL[p.status] || p.status}
              </div>
            </div>

            {(isActive || p.status === 'completed') && p.progress && (
              <>
                <div className="receiver-progress-bar">
                  <div className="receiver-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="receiver-progress-meta">
                  <span>{pct}%</span>
                  <span>
                    {formatFileSize(p.progress.bytesTransferred)} /{' '}
                    {formatFileSize(p.progress.totalBytes)}
                  </span>
                  {p.status === 'transferring' && (
                    <>
                      <span>{formatSpeed(p.progress.speed || 0)}</span>
                      <span>ETA {formatETA(p.progress.eta)}</span>
                    </>
                  )}
                </div>
              </>
            )}

            {p.error && (
              <div className="receiver-card-error">{p.error}</div>
            )}

            <div className="receiver-card-actions">
              {isPending && (
                <>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => onApprove?.(p.peerId)}
                  >
                    ✓ Approve
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => onReject?.(p.peerId)}
                  >
                    ✕ Reject
                  </button>
                </>
              )}
              {isActive && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => onCancel?.(p.peerId)}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
