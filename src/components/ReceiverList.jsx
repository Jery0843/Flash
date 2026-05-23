import { motion, AnimatePresence } from 'framer-motion';
import { User, Check, X, Wifi, WifiOff, AlertCircle, Clock, Loader2, Download, Ban } from 'lucide-react';
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
      <motion.div 
        className="receiver-list-empty"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <motion.div
          animate={{ 
            y: [0, -5, 0],
            opacity: [0.5, 1, 0.5]
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <Clock size={24} className="inline mr-2 text-cyan-400" />
          Waiting for receivers to join…
        </motion.div>
      </motion.div>
    );
  }

  return (
    <div className="receiver-list">
      <AnimatePresence mode="popLayout">
        {peers.map((p, index) => {
          const isPending = p.status === 'pending-approval';
          const isActive = p.status === 'connecting' || p.status === 'transferring';
          const pct = p.progress?.percentage ?? 0;

          const getStatusIcon = () => {
            switch (p.status) {
              case 'pending-approval': return <Clock size={16} className="inline mr-1" />;
              case 'connecting': return <Loader2 size={16} className="inline mr-1 animate-spin" />;
              case 'transferring': return <Download size={16} className="inline mr-1" />;
              case 'completed': return <Check size={16} className="inline mr-1" />;
              case 'rejected': return <Ban size={16} className="inline mr-1" />;
              case 'failed': return <AlertCircle size={16} className="inline mr-1" />;
              case 'disconnected': return <WifiOff size={16} className="inline mr-1" />;
              default: return <Wifi size={16} className="inline mr-1" />;
            }
          };

          return (
            <motion.div
              className={`receiver-card status-${p.status}`}
              key={p.peerId}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: -100, scale: 0.9 }}
              transition={{ duration: 0.3, delay: index * 0.05, ease: [0.4, 0, 0.2, 1] }}
              layout
            >
              <div className="receiver-card-row">
                <div className="receiver-card-id">
                  <motion.div 
                    className="receiver-card-avatar"
                    animate={{ rotate: [0, 5, -5, 0] }}
                    transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                  >
                    <User size={20} className="text-cyan-400" />
                  </motion.div>
                  <span className="receiver-card-code">Receiver {shortId(p.peerId)}</span>
                  {p.connectionType && (
                    <motion.span 
                      className="receiver-card-conn"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                    >
                      {p.connectionType === 'direct' ? <Wifi size={12} /> : <WifiOff size={12} />}
                    </motion.span>
                  )}
                </div>
                <motion.div 
                  className={`receiver-card-status status-pill-${p.status}`}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  {getStatusIcon()}
                  {STATUS_LABEL[p.status] || p.status}
                </motion.div>
              </div>

              <AnimatePresence>
                {(isActive || p.status === 'completed') && p.progress && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="receiver-progress-bar">
                      <motion.div 
                        className="receiver-progress-fill"
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                      />
                    </div>
                    <div className="receiver-progress-meta">
                      <motion.span 
                        key={pct}
                        initial={{ scale: 1.2 }}
                        animate={{ scale: 1 }}
                      >
                        {pct}%
                      </motion.span>
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
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {p.error && (
                  <motion.div
                    className="receiver-card-error"
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                  >
                    <AlertCircle size={14} className="inline mr-1" />
                    {p.error}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="receiver-card-actions">
                <AnimatePresence mode="wait">
                  {isPending && (
                    <motion.div 
                      className="action-buttons"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      key="pending"
                    >
                      <motion.button
                        className="btn btn-primary btn-sm"
                        onClick={() => onApprove?.(p.peerId)}
                        whileHover={{ scale: 1.05, boxShadow: '0 0 20px var(--accent-glow)' }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <Check size={14} className="mr-1" />
                        Approve
                      </motion.button>
                      <motion.button
                        className="btn btn-secondary btn-sm"
                        onClick={() => onReject?.(p.peerId)}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <X size={14} className="mr-1" />
                        Reject
                      </motion.button>
                    </motion.div>
                  )}
                  {isActive && (
                    <motion.button
                      className="btn btn-danger btn-sm"
                      onClick={() => onCancel?.(p.peerId)}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      whileHover={{ scale: 1.05, boxShadow: '0 0 20px rgba(248, 113, 113, 0.3)' }}
                      whileTap={{ scale: 0.95 }}
                      key="active"
                    >
                      <X size={14} className="mr-1" />
                      Cancel
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
