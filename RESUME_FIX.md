# File Transfer Resume Fix - v2

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

### 5. **Sender Pump Not Restarting**
After reconnection, even when the sender received a resume request, the internal pump mechanism wasn't restarting, so no chunks were being sent.

### 6. **No Retry Mechanism**
If the resume request was lost or the sender didn't respond, there was no retry mechanism to request chunks again.

## Fixes Applied (v2 - Enhanced)

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
  
  // SENDER SIDE
  if (isSender && senderFiles?.length > 0) {
    if (!fileTransfer.senderRef?.current) {
      // First connection
      fileTransfer.startSending(senderFiles, manager.dataChannel);
    } else {
      // Reconnection - rewire the data channel
      const sender = fileTransfer.senderRef.current;
      sender.transport = createTransport(manager.dataChannel);
      
      // CRITICAL: Restart the pump if we were in the middle of sending
      if (sender._currentPumpFile && !sender.cancelled) {
        sender._sending = false;
        sender._clearResumeTimer();
        sender._doPump();
      }
    }
  }
  
  // RECEIVER SIDE
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

### 4. **Added Public Resume Method with Retry** (`src/lib/fileTransfer.js`)
```javascript
/**
 * Public method to trigger resume (called after reconnection)
 */
async triggerResume() {
  if (this.currentFileId && this.currentFileMeta) {
    console.log('[FileReceiver] Manually triggering resume after reconnection');
    await this._tryResume();
    
    // Set a timeout to retry if no chunks arrive
    if (this._resumeTimeout) {
      clearTimeout(this._resumeTimeout);
    }
    
    const lastChunkCount = this.receivedChunkCount;
    this._resumeTimeout = setTimeout(() => {
      // If we haven't received any new chunks in 5 seconds, try again
      if (this.receivedChunkCount === lastChunkCount && 
          this.receivedChunkCount < this.currentFileMeta.totalChunks) {
        console.log('[FileReceiver] No chunks received after resume, retrying...');
        this._tryResume();
      }
    }, 5000);
  }
}
```

### 5. **Enhanced Sender Resume Position Handler** (`src/lib/fileTransfer.js`)
```javascript
setResumePosition(fileIndex, resumeFromChunk) {
  console.log(`[FileSender] setResumePosition called for file ${fileIndex} from chunk ${resumeFromChunk}`);
  
  if (fileIndex === this.currentFileIndex) {
    this.currentChunk = resumeFromChunk;
    
    // CRITICAL: Restart the pump regardless of current state
    this._sending = false;
    this._clearResumeTimer();
    
    // If we have an active pump promise, restart it
    if (this._currentPumpFile) {
      console.log('[FileSender] Restarting pump after resume request');
      this._doPump();
    }
  } else {
    this._pendingResume = { fileIndex, resumeFromChunk };
  }
  
  // Always send ACK back to receiver
  this._sendControl({
    ctrl: MSG.FILE_RESUME_ACK,
    fileIndex,
    resumeFromChunk,
  });
}
```

### 6. **Clear Resume Timeout on Chunk Receipt** (`src/lib/fileTransfer.js`)
```javascript
async _handleChunk(buffer) {
  // ... existing validation ...
  
  // Clear resume timeout since we're receiving chunks
  if (this._resumeTimeout) {
    clearTimeout(this._resumeTimeout);
    this._resumeTimeout = null;
  }
  
  // ... rest of chunk handling ...
}
```

### 7. **Added Import for createTransport** (`src/pages/TransferRoom.jsx`)
```javascript
import { createTransport } from '../lib/fileTransfer';
```

### 8. **Enhanced WebRTC Channel Events** (`src/lib/webrtc.js`)
```javascript
channel.onopen = () => {
  this._emit('channel-open');
  this._emit('channel-reopen', channel); // Emit with channel reference for rewiring
  this._startKeepalive();
};
```

## How It Works Now

### Normal Flow (First Connection)
1. Receiver joins room
2. WebRTC connection established
3. Data channel opens
4. File transfer starts
5. Chunks are received and saved to IndexedDB

### Reconnection Flow (After Network Interruption) - ENHANCED

#### Phase 1: Connection Loss
1. **Network interruption occurs** → WebRTC connection state changes to 'disconnected'
2. **Sender pump stops** → No more chunks being sent
3. **Receiver waits** → IndexedDB has all chunks received so far

#### Phase 2: Reconnection
4. **WebRTC attempts ICE restart** → `_attemptReconnection()` is called
5. **ICE restart creates new offer** → Sent via signaling to peer
6. **Connection re-established** → ICE state becomes 'connected'
7. **Data channel reopens** → `channel-open` event fires on both sides

#### Phase 3: Sender Rewiring
8. **Sender detects reconnection** → Checks if `senderRef.current` exists
9. **Transport recreated** → New transport wrapper for data channel
10. **Pump restarted** → `_doPump()` called to resume sending from current chunk

#### Phase 4: Receiver Rewiring & Resume Request
11. **Receiver detects reconnection** → Checks if `receiverRef.current` exists
12. **Data channel rewired** → `onmessage` handler reconnected to FileReceiver
13. **Resume triggered** → `receiver.triggerResume()` called
14. **Chunks loaded from IndexedDB** → Restores received chunks into memory
15. **Resume request sent** → Via signaling: `FILE_RESUME_REQUEST` with fileIndex and resumeFromChunk
16. **Retry timer set** → 5-second timeout to retry if no chunks arrive

#### Phase 5: Sender Response
17. **Sender receives request** → Via signaling listener in TransferRoom
18. **Sender updates position** → `sender.setResumePosition(fileIndex, resumeFromChunk)` called
19. **Sender pump restarted** → `_doPump()` called again to ensure sending
20. **ACK sent back** → `FILE_RESUME_ACK` via data channel

#### Phase 6: Transfer Resumes
21. **Sender resumes from chunk** → Starts sending from the requested chunk position
22. **Receiver gets first chunk** → Clears retry timeout
23. **Transfer continues** → Receives remaining chunks and completes transfer

### Retry Mechanism
- If no chunks arrive within 5 seconds after resume request, receiver automatically retries
- This handles cases where the resume request or ACK was lost
- Retry continues until chunks start arriving or transfer completes

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
   - Open DevTools → Application → IndexedDB → blitz-transfers
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
