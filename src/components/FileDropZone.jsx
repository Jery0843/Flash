import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, File, X, Plus, FileText, Image, Video, Music, Archive, FileCode } from 'lucide-react';
import { formatFileSize, MAX_FILE_SIZE } from '../lib/constants';
import './FileDropZone.css';

export function FileDropZone({ onFilesSelect, selectedFiles = [], disabled }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const getFileIcon = (type, name) => {
    if (type?.startsWith('image/')) return <Image size={20} className="text-blue-400" />;
    if (type?.startsWith('video/')) return <Video size={20} className="text-purple-400" />;
    if (type?.startsWith('audio/')) return <Music size={20} className="text-pink-400" />;
    if (type === 'application/pdf') return <FileText size={20} className="text-red-400" />;
    if (name?.endsWith('.zip') || name?.endsWith('.rar') || name?.endsWith('.7z') || type?.includes('zip') || type?.includes('compressed')) return <Archive size={20} className="text-yellow-400" />;
    if (type?.startsWith('text/') || name?.endsWith('.txt') || name?.endsWith('.md')) return <FileCode size={20} className="text-green-400" />;
    return <File size={20} className="text-gray-400" />;
  };

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
    <motion.div
      className={className}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={!hasFiles ? handleClick : undefined}
      id="file-dropzone"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      whileHover={!hasFiles ? { scale: 1.01 } : {}}
      whileTap={!hasFiles ? { scale: 0.99 } : {}}
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
          <motion.div 
            className="dropzone-file-summary"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <span className="dropzone-file-summary-icon">
              <motion.div
                animate={{ rotate: [0, 10, -10, 0] }}
                transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 3 }}
              >
                <Archive size={24} className="text-cyan-400" />
              </motion.div>
            </span>
            <span>{selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}</span>
            <span className="dropzone-file-summary-sep">·</span>
            <span>{formatFileSize(totalSize)} total</span>
          </motion.div>
          <div className="dropzone-file-items">
            <AnimatePresence mode="popLayout">
              {selectedFiles.map((file, i) => (
                <motion.div
                  className="dropzone-file-item"
                  key={`${file.name}-${file.size}-${i}`}
                  initial={{ opacity: 0, x: -20, scale: 0.9 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 20, scale: 0.9 }}
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                  layout
                >
                  <span className="dropzone-file-item-icon">{getFileIcon(file.type, file.name)}</span>
                  <div className="dropzone-file-item-info">
                    <div className="dropzone-file-item-name">{file.name}</div>
                    <div className="dropzone-file-item-meta">
                      {formatFileSize(file.size)} · {file.type || 'Unknown'}
                    </div>
                  </div>
                  {!disabled && (
                    <motion.button
                      className="dropzone-remove-btn"
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      title="Remove file"
                      aria-label={`Remove ${file.name}`}
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <X size={16} />
                    </motion.button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        >
          <motion.div
            className="dropzone-icon"
            animate={{ 
              y: [0, -10, 0],
              rotate: [0, 5, -5, 0]
            }}
            transition={{ 
              duration: 2, 
              repeat: Infinity, 
              ease: "easeInOut" 
            }}
          >
            <Upload size={64} className="text-cyan-400" />
          </motion.div>
          <div className="dropzone-title">Drop files here or click to browse</div>
          <div className="dropzone-subtitle">
            Any file type · Multiple files · Max {formatFileSize(MAX_FILE_SIZE)} each
          </div>
        </motion.div>
      )}
      {hasFiles && !disabled && (
        <motion.span 
          className="dropzone-change" 
          onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Plus size={16} className="inline mr-1" />
          Add more files
        </motion.span>
      )}
    </motion.div>
  );
}
