import { motion, AnimatePresence } from 'framer-motion';
import { Package, Download } from 'lucide-react';
import './DownloadOptionsModal.css';

export function DownloadOptionsModal({ isOpen, onClose, onDownloadZip, onDownloadIndividual, fileCount }) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="download-options-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="download-options-modal"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="download-options-title">
            Download {fileCount} {fileCount === 1 ? 'File' : 'Files'}
          </h2>
          
          <p className="download-options-subtitle">
            Choose how you'd like to download your files
          </p>

          <div className="download-options-buttons">
            <motion.button
              className="download-option-btn download-zip-btn"
              onClick={onDownloadZip}
              whileHover={{ scale: 1.02, boxShadow: '0 0 30px rgba(0, 243, 255, 0.3)' }}
              whileTap={{ scale: 0.98 }}
            >
              <Package size={24} className="btn-icon" />
              <div className="btn-content">
                <span className="btn-title">Download as ZIP</span>
                <span className="btn-desc">All files in a single archive</span>
              </div>
            </motion.button>

            <motion.button
              className="download-option-btn download-individual-btn"
              onClick={onDownloadIndividual}
              whileHover={{ scale: 1.02, boxShadow: '0 0 30px rgba(255, 0, 85, 0.3)' }}
              whileTap={{ scale: 0.98 }}
            >
              <Download size={24} className="btn-icon" />
              <div className="btn-content">
                <span className="btn-title">Download Individually</span>
                <span className="btn-desc">Each file as separate download</span>
              </div>
            </motion.button>
          </div>

          <motion.button
            className="download-options-cancel"
            onClick={onClose}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Cancel
          </motion.button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
