# Troubleshooting: Page Refreshes During Transfer

## Quick Diagnosis

Open browser console and look for these logs:

### ✅ Good Signs (Transfer should work)
```
[FileReceiver] OPFS available: true
[FileReceiver] DiskWorker ready: blitz_temp_...
[FileReceiver] Memory: 45MB / 4096MB (1.1%)
[FileReceiver] Storage: 50.23 GB available, 3.00 GB needed
```

### ❌ Bad Signs (May cause refresh)
```
[FileReceiver] OPFS available: false
[FileReceiver] Memory: 1850MB / 2048MB (90.3%)
[FileReceiver] Insufficient storage: need 3.00 GB but only 0.50 GB available
DiskWorker error: ...
```

## Common Issues & Fixes

### 1. Page Refreshes After ~1.9GB

**Cause**: Browser running out of memory

**Fix**: 
- ✅ All fixes have been applied in the code
- Ensure you're using Chrome, Edge, or Safari 17.2+
- Close other tabs to free memory
- Check console for `OPFS available: true`

**Test**:
```javascript
// Run in console
if (performance.memory) {
  console.log('Memory:', 
    (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(0) + 'MB');
}
```

### 2. "Storage quota exceeded" Error

**Cause**: Not enough disk space or IndexedDB quota

**Fix**:
- Free up disk space (need 2x file size available)
- Clear browser data (Settings → Privacy → Clear browsing data)
- OPFS should bypass this issue

**Test**:
```javascript
// Run in console
navigator.storage.estimate().then(e => {
  console.log('Available:', 
    ((e.quota - e.usage) / 1024 / 1024 / 1024).toFixed(2) + 'GB');
});
```

### 3. Transfer Stalls/Freezes

**Cause**: DataChannel buffer overflow or connection loss

**Fix**:
- Already implemented: backpressure handling
- Check network connection
- Look for `[WebRTC] Connection lost` in console

**Test**:
- Transfer should auto-resume after brief disconnection
- Check for `[WebRTC] Attempting ICE restart` logs

### 4. "DiskWorker error" in Console

**Cause**: OPFS initialization failed

**Fix**:
- Browser may not support OPFS fully
- Try Chrome/Edge (best OPFS support)
- Falls back to IndexedDB automatically

### 5. Memory Keeps Growing

**Cause**: Memory leak (should be fixed now)

**Fix**:
- Check for duplicate `onmessage` handlers
- Verify `receivedChunksSet.clear()` is called
- Monitor with: `performance.memory.usedJSHeapSize`

**Expected**: Memory should stay under 100MB for any file size

## Browser Compatibility

| Browser | OPFS | Max File Size | Notes |
|---------|------|---------------|-------|
| Chrome 102+ | ✅ | 25GB+ | Best performance |
| Edge 102+ | ✅ | 25GB+ | Best performance |
| Safari 17.2+ | ✅ | 25GB+ | Good performance |
| Firefox | ❌ | ~2GB | IndexedDB fallback, quota limits |
| Safari <17.2 | ❌ | ~2GB | IndexedDB fallback |

## Testing Large Transfers

1. **Run diagnostics**:
   ```bash
   # In browser console
   # Copy/paste contents of diagnostics.js
   ```

2. **Monitor memory during transfer**:
   ```javascript
   setInterval(() => {
     if (performance.memory) {
       console.log('Memory:', 
         (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(0) + 'MB');
     }
   }, 5000);
   ```

3. **Check OPFS files** (after transfer):
   ```javascript
   navigator.storage.getDirectory().then(async root => {
     for await (const entry of root.values()) {
       console.log(entry.name, entry.kind);
     }
   });
   ```

## Emergency Recovery

If page refreshes mid-transfer:

1. **Receiver**: 
   - Page will attempt to restore session
   - Look for "Restoring session from storage after refresh"
   - Transfer should resume from last chunk

2. **Sender**:
   - Cannot restore (File objects lost)
   - Must restart transfer
   - Receiver keeps received chunks in IndexedDB

## Performance Tips

1. **Before transfer**:
   - Close unnecessary tabs
   - Clear browser cache
   - Ensure 2x file size available on disk

2. **During transfer**:
   - Keep tab visible (better performance)
   - Don't open DevTools (uses memory)
   - Avoid switching tabs frequently

3. **For 5GB+ files**:
   - Use Chrome/Edge (best OPFS support)
   - Ensure 10GB+ free disk space
   - Close all other tabs

## Still Having Issues?

1. Check browser console for errors
2. Run diagnostics.js
3. Verify OPFS is available
4. Try a smaller test file first (500MB)
5. Update browser to latest version

## Code Changes Summary

All memory fixes have been applied:
- ✅ Zero-copy ArrayBuffer transfers
- ✅ OPFS disk streaming (no RAM storage)
- ✅ Bounded pending chunk queue
- ✅ Aggressive memory cleanup
- ✅ Duplicate handler prevention
- ✅ Persistent storage request
- ✅ Memory monitoring
- ✅ Beforeunload warning
