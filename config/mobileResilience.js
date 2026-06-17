/**
 * MOBILE + LOW NETWORK RESILIENCE
 * ================================
 * Handles slow 3G, offline recovery, token expiration during inactivity
 * Ensures app stays stable on poor connections
 */

/**
 * Mobile network conditions to test
 * Set in Chrome DevTools > Network > Throttling
 */
const NETWORK_CONDITIONS = {
  // Slow 3G: 400kb/s down, 100kb/s up, 400ms latency
  SLOW_3G: {
    name: 'Slow 3G',
    downloadThroughput: 400 * 1024 / 8, // 400 kbps
    uploadThroughput: 100 * 1024 / 8,   // 100 kbps
    latency: 400
  },
  
  // Fast 3G: 1.6mb/s down, 750kb/s up, 100ms latency
  FAST_3G: {
    name: 'Fast 3G',
    downloadThroughput: 1600 * 1024 / 8,
    uploadThroughput: 750 * 1024 / 8,
    latency: 100
  },
  
  // LTE: 4mb/s down, 3mb/s up, 50ms latency
  LTE: {
    name: 'LTE',
    downloadThroughput: 4 * 1024 * 1024 / 8,
    uploadThroughput: 3 * 1024 * 1024 / 8,
    latency: 50
  },
  
  // WiFi: 30mb/s down, 15mb/s up, 2ms latency
  WIFI: {
    name: 'WiFi',
    downloadThroughput: 30 * 1024 * 1024 / 8,
    uploadThroughput: 15 * 1024 * 1024 / 8,
    latency: 2
  }
};

/**
 * FRONTEND MOBILE RESILIENCE CHECKLIST
 * 
 * ✅ App backgrounding recovery:
 * - Store auth tokens in localStorage
 * - Detect app focus with window.addEventListener('focus')
 * - On focus, check token expiration
 * - If expired, refresh before user sees anything
 * - Show loading screen while refreshing
 * 
 * ✅ Offline detection:
 * - Monitor navigator.onLine
 * - Show "offline" indicator
 * - Queue requests while offline
 * - Retry when online
 * - Use service workers if available
 * 
 * ✅ Slow network handling:
 * - Increase timeout on slow connections
 * - Show skeletons while loading
 * - Paginate results (not all at once)
 * - Compress images
 * - Lazy-load non-critical components
 * 
 * ✅ Socket reconnection:
 * - Exponential backoff
 * - Max 10 reconnection attempts
 * - Clear old listeners before reconnecting
 * - Don't duplicate message events
 * 
 * ✅ Token expiration during inactivity:
 * - Refresh token 5 minutes before expiry
 * - On app focus, check token age
 * - If > 1 hour old, force refresh
 * - Handle refresh failures gracefully
 */

/**
 * Simulate network conditions for testing
 * Usage in Chrome DevTools:
 * 
 * 1. Open DevTools
 * 2. Go to Network tab
 * 3. Find Throttling dropdown (top-left)
 * 4. Select "Slow 3G" or "Fast 3G"
 * 5. Reload page and test
 */

/**
 * CLIENT-SIDE OFFLINE QUEUE
 * =========================
 * Queue API calls while offline, retry when online
 */
class OfflineQueue {
  constructor() {
    this.queue = [];
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());
    }
  }

  handleOnline() {
    this.isOnline = true;
    this.processQueue();
  }

  handleOffline() {
    this.isOnline = false;
  }

  async add(request) {
    this.queue.push(request);
    if (this.isOnline) {
      return this.processQueue();
    }
    return { queued: true };
  }

  async processQueue() {
    const results = [];
    while (this.queue.length > 0) {
      const request = this.queue.shift();
      try {
        const result = await request();
        results.push(result);
      } catch (error) {
        // Re-queue on failure
        this.queue.unshift(request);
        break;
      }
    }
    return results;
  }
}

/**
 * TOKEN REFRESH STRATEGY FOR MOBILE
 * ==================================
 */
const tokenRefreshStrategy = {
  /**
   * Token check interval (check every 1 minute)
   */
  checkInterval: 60000,
  
  /**
   * Refresh token when it has < 5 minutes left
   */
  refreshThreshold: 5 * 60 * 1000,
  
  /**
   * Force refresh if token is > 1 hour old (even if not expired)
   */
  forceRefreshAge: 60 * 60 * 1000,
  
  /**
   * Actions on app focus
   */
  onAppFocus: {
    // Check token immediately
    checkToken: true,
    
    // Force refresh if older than 1 hour
    forceRefreshIfOld: true,
    
    // Refresh data (dashboard, wallet, etc.)
    refreshData: true
  }
};

/**
 * SOCKET.IO MOBILE OPTIMIZATIONS
 * ==============================
 */
const socketMobileConfig = {
  // Reduce heartbeat interval to detect disconnects faster
  pingInterval: 25000,
  pingTimeout: 10000,
  
  // Exponential backoff for reconnection
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 10,
  
  // Use both transports
  transports: ['websocket', 'polling'],
  
  // Upgrade to websocket if available
  upgradeInsecure: true,
  
  // Message buffering for offline periods
  sync: {
    // Store up to 100 messages locally
    maxMessages: 100,
    
    // Max 5 minutes of offline buffer
    maxAge: 5 * 60 * 1000
  }
};

/**
 * COMPRESSION FOR SLOW NETWORKS
 * =============================
 */
const compressionConfig = {
  // Enable gzip for responses
  gzip: true,
  
  // Compression level (1-9, higher = more compression)
  level: 6,
  
  // Only compress if response is > 1KB
  threshold: 1024,
  
  // Enable for these MIME types
  types: ['application/json', 'text/plain', 'text/html', 'application/javascript'],
  
  // Exclude these from compression
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    if (res.getHeader('x-no-compression')) return false;
    return true;
  }
};

/**
 * TESTING CHECKLIST FOR MOBILE + LOW NETWORK
 * ===========================================
 */
const mobileTestingChecklist = `
✅ SLOW 3G TESTING
  - Enable "Slow 3G" throttling in Chrome DevTools
  - Navigate to dashboard: Should load within 5-10 seconds
  - Marketplace search: Should show skeletons immediately
  - Chat: Should reconnect within 35 seconds of disconnect
  - Wallet: Should load transactions with pagination
  - Payments: Should complete even with 400ms+ latency

✅ OFFLINE RECOVERY
  - Disconnect WiFi/Mobile
  - App should show "offline" indicator
  - Queue any API calls
  - Reconnect WiFi/Mobile
  - App should automatically retry queued calls
  - No errors shown to user

✅ APP BACKGROUNDING (iOS/Android)
  - Open app and login
  - Navigate to dashboard
  - Background app for 2+ hours
  - Token expires (< 1 hour expiry)
  - Bring app to foreground
  - App should automatically refresh token
  - No white screen or "not authenticated" error

✅ SOCKET RECONNECTION
  - Open chat page
  - Disable WiFi (or use DevTools to disconnect)
  - Should see "reconnecting..." status
  - Enable WiFi after 30-60 seconds
  - Should reconnect and load unread messages
  - No duplicate messages

✅ LONG INACTIVITY
  - Login and set token expiry to short duration (5 min in dev)
  - Don't interact for > 5 minutes
  - Click dashboard button
  - Should refresh token silently
  - Dashboard should load normally
  - No authentication errors

✅ MOBILE VIEWPORT
  - View on iPhone SE (375px width)
  - View on iPad (768px width)
  - View on Android (360px, 480px, 720px)
  - All components should be responsive
  - No horizontal scrolling
  - Buttons clickable on touch (44px+ height)
`;

module.exports = {
  NETWORK_CONDITIONS,
  OfflineQueue,
  tokenRefreshStrategy,
  socketMobileConfig,
  compressionConfig,
  mobileTestingChecklist
};
