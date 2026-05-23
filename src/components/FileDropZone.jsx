import { useState, useRef, useCallback } from 'react';
import { formatFileSize, getFileIcon, MAX_FILE_SIZE } from '../lib/constants';
import './FileDropZone.css';

export function FileDropZone({ onFilesSelect, selectedFiles = [], disabled }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const addFiles = useCallback((newFileList) => {
    const incoming = Array.from(newFileList);
    const rejected = [];

    const sizeFiltered = incoming.filter((f) => {
      if (f.size > MAX_FILE_SIZE) {
        rejected.push(f.name);
        return false;
      }
      return true;
    });

    if (rejected.length > 0) {
      alert(`These files exceed the ${formatFileSize(MAX_FILE_SIZE)} limit and were skipped:\n${rejected.join('\n')}`);
    }

    if (sizeFiltered.length === 0) return;

    // Deduplicate within the incoming list first. Some platforms (e.g. certain
    // Linux file managers / Chromium builds) deliver a dragged archive as both
    // a File entry and a path-derived entry, so dataTransfer.files can contain
    // the same File twice — which previously doubled the displayed total.
    const seen = new Set();
    const incomingUnique = [];
    for (const f of sizeFiltered) {
      const key = `${f.name}::${f.size}::${f.lastModified}`;
      if (seen.has(key)) continue;
      seen.add(key);
      incomingUnique.push(f);
    }

    // Then deduplicate against the latest selectedFiles via a functional
    // update so we don't read stale state across rapid remove→re-drop cycles.
    onFilesSelect((prev) => {
      const prevList = Array.isArray(prev) ? prev : selectedFiles;
      const existing = new Set(prevList.map((f) => `${f.name}::${f.size}::${f.lastModified}`));
      const toAdd = incomingUnique.filter(
        (f) => !existing.has(`${f.name}::${f.size}::${f.lastModified}`)
      );
      return toAdd.length > 0 ? [...prevList, ...toAdd] : prevList;
    });
  }, [selectedFiles, onFilesSelect]);

  const removeFile = useCallback((index) => {
    const next = selectedFiles.filter((_, i) => i !== index);
    onFilesSelect(next);
  }, [selectedFiles, onFilesSelect]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    addFiles(e.dataTransfer.files);
  }, [disabled, addFiles]);

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleInputChange = (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  };

  const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);
  const hasFiles = selectedFiles.length > 0;

  const className = [
    'dropzone',
    dragOver && 'drag-over',
    hasFiles && 'has-file',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={!hasFiles ? handleClick : undefined}
      id="file-dropzone"
    >
      <input
        type="file"
        ref={inputRef}
        onChange={handleInputChange}
        disabled={disabled}
        multiple
      />
      {hasFiles ? (
        <div className="dropzone-file-list">
          <div className="dropzone-file-summary">
            <span className="dropzone-file-summary-icon">🗂️</span>
            <span>{selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}</span>
            <span className="dropzone-file-summary-sep">·</span>
            <span>{formatFileSize(totalSize)} total</span>
          </div>
          <div className="dropzone-file-items">
            {selectedFiles.map((file, i) => (
              <div className="dropzone-file-item" key={`${file.name}-${file.size}-${i}`}>
                <span className="dropzone-file-item-icon">{getFileIcon(file.type, file.name)}</span>
                <div className="dropzone-file-item-info">
                  <div className="dropzone-file-item-name">{file.name}</div>
                  <div className="dropzone-file-item-meta">
                    {formatFileSize(file.size)} · {file.type || 'Unknown'}
                  </div>
                </div>
                {!disabled && (
                  <button
                    className="dropzone-remove-btn"
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    title="Remove file"
                    aria-label={`Remove ${file.name}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <span className="dropzone-icon">📁</span>
          <div className="dropzone-title">Drop files here or click to browse</div>
          <div className="dropzone-subtitle">
            Any file type · Multiple files · Max {formatFileSize(MAX_FILE_SIZE)} each
          </div>
        </>
      )}
      {hasFiles && !disabled && (
        <span className="dropzone-change" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
          + Add more files
        </span>
      )}
    </div>
  );
}
