import { formatFileSize, getFileIcon } from '../lib/constants';
import { isDangerousFile, sanitizeFilename } from '../lib/sanitize';
import './ApprovalModal.css';

export function ApprovalModal({ fileMetadata, onAccept, onReject }) {
  if (!fileMetadata) return null;

  const safeName = sanitizeFilename(fileMetadata.name);
  const dangerous = isDangerousFile(safeName);

  return (
    <div className="approval-overlay" id="approval-modal">
      <div className="approval-modal">
        <div className="approval-title">Incoming File</div>
        <div className="approval-subtitle">
          Someone wants to send you a file. Accept to start the transfer.
        </div>

        <div className="approval-file">
          <span className="approval-file-icon">
            {getFileIcon(fileMetadata.type, safeName)}
          </span>
          <div>
            <div className="approval-file-name">{safeName}</div>
            <div className="approval-file-meta">
              {formatFileSize(fileMetadata.size)} · {fileMetadata.type || 'Unknown type'}
            </div>
          </div>
        </div>

        {dangerous && (
          <div className="approval-warning">
            <span>⚠️</span>
            <span>
              This file type may be harmful. Only accept files from people you trust.
            </span>
          </div>
        )}

        <div className="approval-actions">
          <button className="btn btn-danger" onClick={onReject} id="reject-transfer-btn">
            Reject
          </button>
          <button className="btn btn-primary" onClick={onAccept} id="accept-transfer-btn">
            Accept Transfer
          </button>
        </div>
      </div>
    </div>
  );
}
