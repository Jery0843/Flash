import { ROOM_STATES } from '../lib/constants';
import './StatusIndicator.css';

const STATUS_LABELS = {
  [ROOM_STATES.WAITING]: 'Waiting for receiver',
  [ROOM_STATES.RECEIVER_JOINED]: 'Receiver joined',
  [ROOM_STATES.NEGOTIATING]: 'Establishing secure connection',
  [ROOM_STATES.RELAY_FALLBACK]: 'Trying relay connection',
  [ROOM_STATES.CONNECTED]: 'Secure connection established',
  [ROOM_STATES.TRANSFERRING]: 'Transferring',
  [ROOM_STATES.COMPLETED]: 'Transfer complete',
  [ROOM_STATES.FAILED]: 'Connection failed',
  [ROOM_STATES.EXPIRED]: 'Room expired',
  [ROOM_STATES.CANCELLED]: 'Transfer cancelled',
};

export function StatusIndicator({ status }) {
  return (
    <div className="status-indicator" data-status={status} id="status-indicator">
      <span className="status-dot" />
      <span>{STATUS_LABELS[status] || status}</span>
    </div>
  );
}
