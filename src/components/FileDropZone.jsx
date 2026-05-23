import { useState, useRef, useCallback } from 'react';
import { formatFileSize, getFileIcon, MAX_FILE_SIZE } from '../lib/constants';
import './FileDropZone.css';

export function FileDropZone({ onFileSelect, selectedFile, disabled }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      alert(`File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`);
      return;
    }
    onFileSelect(file);
  }, [onFileSelect]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }, [disabled, handleFile]);

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleInputChange = (e) => {
    handleFile(e.target.files[0]);
    e.target.value = '';
  };

  const className = [
    'dropzone',
    dragOver && 'drag-over',
    selectedFile && 'has-file',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={!selectedFile ? handleClick : undefined}
      id="file-dropzone"
    >
      <input
        type="file"
        ref={inputRef}
        onChange={handleInputChange}
        disabled={disabled}
      />
      {selectedFile ? (
        <div className="dropzone-file">
          <span className="dropzone-file-icon">{getFileIcon(selectedFile.type, selectedFile.name)}</span>
          <div className="dropzone-file-info">
            <div className="dropzone-file-name">{selectedFile.name}</div>
            <div className="dropzone-file-meta">
              {formatFileSize(selectedFile.size)} · {selectedFile.type || 'Unknown type'}
            </div>
          </div>
        </div>
      ) : (
        <>
          <span className="dropzone-icon">📁</span>
          <div className="dropzone-title">Drop a file here or click to browse</div>
          <div className="dropzone-subtitle">
            Any file type · Max {formatFileSize(MAX_FILE_SIZE)}
          </div>
        </>
      )}
      {selectedFile && !disabled && (
        <span className="dropzone-change" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
          Change file
        </span>
      )}
    </div>
  );
}
