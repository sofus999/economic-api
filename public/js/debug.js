// Debug helper for economic-api UI

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
  // Inject the debug UI
  const debugDiv = document.createElement('div');
  debugDiv.id = 'debug-panel';
  debugDiv.style.position = 'fixed';
  debugDiv.style.bottom = '0';
  debugDiv.style.right = '0';
  debugDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
  debugDiv.style.color = 'white';
  debugDiv.style.padding = '10px';
  debugDiv.style.maxHeight = '300px';
  debugDiv.style.maxWidth = '600px';
  debugDiv.style.overflow = 'auto';
  debugDiv.style.zIndex = '9999';
  debugDiv.style.fontSize = '12px';
  debugDiv.style.fontFamily = 'monospace';
  debugDiv.innerHTML = '<h3>Debug Panel</h3><div id="debug-log"></div>';
  
  document.body.appendChild(debugDiv);
  
  // Store original fetch
  const originalFetch = window.fetch;
  
  // Override fetch to log API calls
  window.fetch = function() {
    // Log the request
    const url = arguments[0];
    if (url.includes('/api/accounts/')) {
      logDebug(`📤 Fetching: ${url}`);
    }
    
    // Call the original fetch
    return originalFetch.apply(this, arguments)
      .then(response => {
        // Clone the response so we can read it multiple times
        const clone = response.clone();
        
        // Only log API calls related to accounts
        if (url.includes('/api/accounts/')) {
          clone.json().then(data => {
            logDebug(`📥 Response from ${url}:`);
            logDebug(JSON.stringify(data, null, 2).substring(0, 500) + '... (truncated)');
            
            // Check for entries specifically
            if (url.includes('/entries')) {
              logDebug(`👁️ ENTRIES COUNT: ${data.entries?.length || 0}`);
              if (data.entries && data.entries.length > 0) {
                logDebug(`👁️ FIRST ENTRY: ${JSON.stringify(data.entries[0])}`);
              }
            }
            
            // Check for account renderer
            if (window.accountRenderer) {
              logDebug('🎯 Found accountRenderer on window');
            } else {
              logDebug('❌ No accountRenderer found on window');
            }
            
            // Check for showAccountDetails function
            if (window.showAccountDetails) {
              logDebug('🎯 Found showAccountDetails function');
            } else {
              logDebug('❌ No showAccountDetails function found');
            }
          }).catch(e => {
            logDebug(`❌ Error parsing JSON: ${e.message}`);
          });
        }
        
        return response;
      })
      .catch(error => {
        if (url.includes('/api/accounts/')) {
          logDebug(`❌ Fetch error: ${error.message}`);
        }
        throw error;
      });
  };
  
  // Patch window.console.log to capture output
  const originalConsoleLog = console.log;
  console.log = function() {
    // Call the original console.log
    originalConsoleLog.apply(console, arguments);
    
    // Check if this is related to our app
    const args = Array.from(arguments);
    const message = args.join(' ');
    
    if (message.includes('account') || 
        message.includes('invoice') || 
        message.includes('balance') ||
        message.includes('entries')) {
      logDebug(`📝 Console log: ${message}`);
    }
  };
  
  // Log to debug panel
  function logDebug(message) {
    const log = document.getElementById('debug-log');
    if (log) {
      const entry = document.createElement('div');
      entry.textContent = message;
      entry.style.borderBottom = '1px solid rgba(255,255,255,0.2)';
      entry.style.paddingBottom = '3px';
      entry.style.marginBottom = '3px';
      log.appendChild(entry);
      
      // Scroll to bottom
      log.scrollTop = log.scrollHeight;
    }
  }
  
  // Expose function globally
  window.logDebug = logDebug;
  
  // Toggle debug panel
  const toggleButton = document.createElement('button');
  toggleButton.textContent = 'Toggle Debug';
  toggleButton.style.position = 'fixed';
  toggleButton.style.bottom = '10px';
  toggleButton.style.right = '10px';
  toggleButton.style.zIndex = '10000';
  toggleButton.addEventListener('click', function() {
    if (debugDiv.style.display === 'none') {
      debugDiv.style.display = 'block';
    } else {
      debugDiv.style.display = 'none';
    }
  });
  document.body.appendChild(toggleButton);
  
  // Add a trigger button to requery data
  const reqQueryButton = document.createElement('button');
  reqQueryButton.textContent = 'Requery Data';
  reqQueryButton.style.position = 'fixed';
  reqQueryButton.style.bottom = '10px';
  reqQueryButton.style.right = '120px';
  reqQueryButton.style.zIndex = '10000';
  reqQueryButton.addEventListener('click', function() {
    const agreementNumber = window.location.pathname.split('/')[2];
    const accountNumber = window.location.pathname.split('/')[3];
    
    if (agreementNumber && accountNumber) {
      fetch(`/api/accounts/${agreementNumber}/${accountNumber}/entries?page=1&limit=50`);
      fetch(`/api/accounts/${agreementNumber}/${accountNumber}/monthly-balances`);
      fetch(`/api/accounts/${agreementNumber}/${accountNumber}/invoices?page=1&limit=20`);
      
      logDebug(`🔄 Requerying data for agreement ${agreementNumber}, account ${accountNumber}`);
    }
  });
  document.body.appendChild(reqQueryButton);
  
  logDebug('Debug tools initialized');
}); 