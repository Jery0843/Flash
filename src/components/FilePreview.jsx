import { useState, useEffect } from 'react';
import { PREVIEWABLE_IMAGE_TYPES, PREVIEWABLE_VIDEO_TYPES, getFileIcon } from '../lib/constants';
import './FilePreview.css';

export function FilePreview({ blob, name, type }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (blob) {
      const objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
  }, [blob]);

  if (!blob || !url) return null;

  const isImage = PREVIEWABLE_IMAGE_TYPES.includes(type);
  const isVideo = PREVIEWABLE_VIDEO_TYPES.includes(type);

  return (
    <div className="file-preview" id="file-preview">
      {isImage && <img src={url} alt={name} loading="lazy" />}
      {isVideo && <video src={url} controls playsInline />}
      {!isImage && !isVideo && (
        <div className="file-preview-generic">
          <span className="file-preview-generic-icon">{getFileIcon(type, name)}</span>
          <span className="file-preview-generic-name">{name}</span>
          <span className="file-preview-generic-type">{type || 'Unknown type'}</span>
        </div>
      )}
    </div>
  );
}
