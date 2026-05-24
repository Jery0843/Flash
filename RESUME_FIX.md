# File Transfer Resume Fix

## Problem
When the receiver experiences a network interruption and reconnects after ~20 seconds, the file transfer was not auto-resuming. The transfer would get stuck even though:
- IndexedDB had the received chunks persisted
- WebRTC connection was re-established via ICE restart
- The receiver had resume logic implemented

## Root Causes

### 1. **Missing Signaling Listener for Resume Requests**
The sender (TransferRoom.jsx) was not listening for `MSG.FILE_RESUME_REQUEST` messages from the signaling server. When the receiver sent a resume request, the sender never received it.

### 2. **Data Channel Not Rewired After Reconnection**
When the WebRTC connection was re-established via ICE restart, the data channel's `onmessage` handler was not being rewired to the FileReceiver, so incoming chunks were not being processed.

### 3. **Resume Not Triggered on Reconnection**
After the data channel reopened, the receiver was not automatically triggering the resume logic to request missing chunks from the sender.

### 4. **Sender Refs Not Exposed**
The `useFileTransfer` hook was not exposing `senderRef` and `receiverRef`, making it impossible to access the FileSender/FileReceiver instances for reconnection handling.

## Fixes Applied

### 1. **Added Resume Request Handler in TransferRoom** (`src/pages/TransferRoom.jsx`)
```javascript
// Handle resume requests from receiver (sender only)
if (isSender) {
  signaling.on(MSG.FILE_RESUME_REQUEST, (data) => {
    console.log('[TransferRoom] Received resume request:', data);
    const { fileIndex, resumeFromChunk } = data;
    // Forward to the file sender
    const sender = fileTransfer.senderRef?.current;
    if (sender && sender.setResumePosition) {
      sender.setResumePosition(fileIndex, resumeFromChunk);
    }
  });
}
```

### 2. **Rewire Data Channel on Reconnection** (`src/pages/TransferRoom.jsx`)
```javascript
manager.on('channel-open', () => {
  // ... existing code ...
  
  if (!isSender && initialMetadata) {
    if (!fileTransfer.receiverRef?.current) {
      // First connection
      fileTransfer.startReceiving(initialMetadata, manager.dataChannel, signaling.client, roomCode, peerId);
    } else {
      // Reconnection - rewire the data channel
      const receiver = fileTransfer.receiverRef.current;
      manager.dataChannel.onmessage = (event) => {
        receiver.handleMessage(event.data);
      };
      
      // Trigger resume if transfer was in progress
      if (receiver.currentFileMeta && receiver.currentFileId) {
        receiver.triggerResume();
      }
    }
  }
  
  if (isSender && senderFiles?.length > 0) {
    if (!fileTransfer.senderRef?.current) {
      // First connection
      fileTransfer.startSending(senderFiles, manager.dataChannel);
    } else {
      // Reconnection - rewire transport
      const sender = fileTransfer.senderRef.current;
      sender.transport = createTransport(manager.dataChannel);
    }
  }
});
```

### 3. **Exposed Sender/Receiver Refs** (`src/hooks/useFileTransfer.js`)
```javascript
return {
  // ... existing exports ...
  senderRef,
  receiverRef,
};
```

### 4. **Added Public Resume Method** (`src/lib/fileTransfer.js`)
```javascript
/**
 * Public method to trigger resume (called after reconnection)
 */
async triggerResume() {
  if (this.currentFileId && this.currentFileMeta) {
    console.log('[FileReceiver] Manually triggering resume after reconnection');
    await this._tryResume();
  }
}
```

### 5. **Added Import for createTransport** (`src/pages/TransferRoom.jsx`)
```javascript
import { createTransport } from '../lib/fileTransfer';
```

## How It Works Now

### Normal Flow (First Connection)
1. Receiver joins room
2. WebRTC connection established
3. Data channel opens
4. File transfer starts
5. Chunks are received and saved to IndexedDB

### Reconnection Flow (After Network Interruption)
1. **Network interruption occurs** → WebRTC connection state changes to 'disconnected'
2. **WebRTC attempts ICE restart** → `_attemptReconnection()` is called
3. **ICE restart creates new offer** → Sent via signaling to peer
4. **Connection re-established** → ICE state becomes 'connected'
5. **Data channel reopens** → `channel-open` event fires
6. **Receiver detects reconnection** → Checks if `receiverRef.current` exists
7. **Data channel rewired** → `onmessage` handler reconnected to FileReceiver
8. **Resume triggered** → `receiver.triggerResume()` called
9. **Resume request sent** → Via signaling: `FILE_RESUME_REQUEST` with fileIndex and resumeFromChunk
10. **Sender receives request** → Via signaling listener in TransferRoom
11. **Sender updates position** → `sender.setResumePosition(fileIndex, resumeFromChunk)` called
12. **Sender resumes from chunk** → Starts sending from the requested chunk
13. **Receiver continues** → Receives remaining chunks and completes transfer

## Testing Recommendations

1. **Simulate Network Interruption**
   - Start a large file transfer (>100MB)
   - Disable network for 20-30 seconds
   - Re-enable network
   - Verify transfer resumes automatically

2. **Check Console Logs**
   - Look for: `[FileReceiver] Manually triggering resume after reconnection`
   - Look for: `[TransferRoom] Received resume request`
   - Look for: `[FileSender] Resume request for file X from chunk Y`

3. **Verify IndexedDB**
   - Open DevTools → Application → IndexedDB → flash-transfers
   - Check that chunks are being saved during transfer
   - After reconnection, verify chunks are loaded and transfer continues

4. **Test Edge Cases**
   - Multiple network interruptions
   - Very short interruptions (<5 seconds)
   - Long interruptions (>60 seconds)
   - Interruption during multi-file transfers

## Additional Notes

- The WebRTC manager now allows up to 20 reconnection attempts (increased from 3)
- Each reconnection attempt uses exponential backoff
- The receiver is more aggressive with reconnection (10s timeout vs 30s for sender)
- All resume logic uses IndexedDB for persistence across page reloads
- Resume requests are sent via signaling (WebSocket), not data channel, to work even when data channel is down
