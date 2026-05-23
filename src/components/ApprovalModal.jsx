import { formatFileSize, getFileIcon } from '../lib/constants';
import { isDangerousFile, sanitizeFilename } from '../lib/sanitize';
import './ApprovalModal.css';

export function ApprovalModal({ fileMetadata, onAccept, onReject }) {
  if (!fileMetadata) return null;

  // Support both manifest format (multi-file) and legacy single-file
  const isManifest = Array.isArray(fileMetadata.files);
  const files = isManifest
    ? fileMetadata.files.map((f) => ({
        ...f,
        safeName: sanitizeFilename(f.name),
        dangerous: isDangerousFile(f.name),
      }))
    : [{
        ...fileMetadata,
        safeName: sanitizeFilename(fileMetadata.name),
        dangerous: isDangerousFile(fileMetadata.name),
      }];

  const totalSize = isManifest
    ? fileMetadata.totalSize
    : fileMetadata.size;

  const hasDangerous = files.some((f) => f.dangerous);

  return (
    <div className="approval-overlay" id="approval-modal">
      <div className="approval-modal">
        <div className="approval-title">
          {files.length === 1 ? 'Incoming File' : `Incoming Files (${files.length})`}
        </div>
        <div className="approval-subtitle">
          Someone wants to send you {files.length === 1 ? 'a file' : `${files.length} files`}.
          Accept to start the transfer.
        </div>

        <div className="approval-file-list">
          {files.map((file, i) => (
            <div className="approval-file" key={`${file.safeName}-${i}`}>
              <span className="approval-file-icon">
                {getFileIcon(file.type, file.safeName)}
              </span>
              <div>
                <div className="approval-file-name">{file.safeName}</div>
                <div className="approval-file-meta">
                  {formatFileSize(file.size)} · {file.type || 'Unknown type'}
                </div>
              </div>
              {file.dangerous && (
                <span className="approval-file-danger" title="Potentially harmful file type">⚠️</span>
              )}
            </div>
          ))}
        </div>

        {files.length > 1 && (
          <div className="approval-summary">
            {files.length} files · {formatFileSize(totalSize)} total
          </div>
        )}

        {hasDangerous && (
          <div className="approval-warning">
            <span>⚠️</span>
            <span>
              Some file types may be harmful. Only accept files from people you trust.
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
