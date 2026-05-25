// Blitz Transfer Diagnostics
// Run this in the browser console to check if your browser can handle large transfers

async function runDiagnostics() {
  console.log('=== Blitz Transfer Diagnostics ===\n');
  
  // 1. Check OPFS support
  const hasOPFS = typeof Worker !== 'undefined' && 
                  navigator.storage && 
                  navigator.storage.getDirectory;
  console.log('✓ OPFS Support:', hasOPFS ? '✅ YES' : '❌ NO (will use IndexedDB fallback)');
  
  // 2. Check storage quota
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    const availableGB = ((estimate.quota - estimate.usage) / 1024 / 1024 / 1024).toFixed(2);
    const usedGB = (estimate.usage / 1024 / 1024 / 1024).toFixed(2);
    const totalGB = (estimate.quota / 1024 / 1024 / 1024).toFixed(2);
    console.log(`✓ Storage: ${usedGB}GB used / ${totalGB}GB total (${availableGB}GB available)`);
    
    if (parseFloat(availableGB) < 5) {
      console.warn('⚠️  Low storage! You may have issues with files larger than', availableGB, 'GB');
    }
  }
  
  // 3. Check persistent storage
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persisted();
    console.log('✓ Persistent Storage:', isPersisted ? '✅ YES' : '⚠️  NO (may be evicted under pressure)');
    
    if (!isPersisted) {
      console.log('  → Request persistence with: await navigator.storage.persist()');
    }
  }
  
  // 4. Check memory
  if (performance.memory) {
    const memMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(0);
    const limitMB = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(0);
    const usagePercent = ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1);
    console.log(`✓ Memory: ${memMB}MB / ${limitMB}MB (${usagePercent}%)`);
    
    if (parseFloat(usagePercent) > 70) {
      console.warn('⚠️  High memory usage! Close other tabs before transferring large files.');
    }
  } else {
    console.log('✓ Memory: Not available (non-Chromium browser)');
  }
  
  // 5. Check IndexedDB
  const hasIndexedDB = 'indexedDB' in window;
  console.log('✓ IndexedDB:', hasIndexedDB ? '✅ YES' : '❌ NO');
  
  // 6. Check WebRTC
  const hasWebRTC = 'RTCPeerConnection' in window;
  console.log('✓ WebRTC:', hasWebRTC ? '✅ YES' : '❌ NO');
  
  // 7. Check Service Worker
  const hasSW = 'serviceWorker' in navigator;
  console.log('✓ Service Worker:', hasSW ? '✅ YES' : '❌ NO');
  
  // 8. Browser info
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Edg')) browser = 'Edge';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  console.log('✓ Browser:', browser);
  
  // 9. Recommendations
  console.log('\n=== Recommendations ===');
  if (!hasOPFS) {
    console.log('⚠️  Your browser does not support OPFS. Large files (>1GB) may fail.');
    console.log('   → Use Chrome, Edge, or Safari 17.2+ for best results.');
  }
  if (hasOPFS && parseFloat(availableGB) > 5) {
    console.log('✅ Your browser is ready for large file transfers!');
  }
  
  console.log('\n=== Test Transfer ===');
  console.log('To test a 3GB transfer:');
  console.log('1. Create a room and select a large file');
  console.log('2. Open console and watch for these logs:');
  console.log('   - "[FileReceiver] OPFS available: true"');
  console.log('   - "[FileReceiver] DiskWorker ready"');
  console.log('   - "[FileReceiver] Memory: XXmb / XXXXmb (X.X%)"');
  console.log('3. Memory usage should stay under 100MB throughout');
}

// Run diagnostics
runDiagnostics();
