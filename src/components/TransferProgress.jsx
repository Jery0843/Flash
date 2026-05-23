import { formatFileSize } from '../lib/constants';
import './TransferProgress.css';

export function TransferProgress({ stats }) {
  if (!stats) return null;

  const { percentage, bytesTransferred, totalBytes } = stats;
  const isComplete = percentage >= 100;

  return (
    <div className="progress-wrapper" id="transfer-progress">
      <div className="progress-bar-outer">
        <div
          className={`progress-bar-inner ${isComplete ? 'complete' : ''}`}
          style={{ width: `${Math.max(percentage, 1)}%` }}
        />
      </div>
      <div className="progress-labels">
        <span className="progress-percentage">{percentage}%</span>
        <span>{formatFileSize(bytesTransferred)} / {formatFileSize(totalBytes)}</span>
      </div>
    </div>
  );
}
