const app = require('./app');
const config = require('./config');
const db = require('./db');
const logger = require('./modules/core/logger');
const runMigrations = require('./db/run-migrations');

// Timeout for graceful shutdown (ms)
const SHUTDOWN_TIMEOUT = 30000;

// Track shutdown state
let isShuttingDown = false;

// Start the server
async function startServer() {
  try {
    // Run all migrations dynamically
    await runMigrations();
    logger.info('Database migrations completed');
    
    // Start the server
    const server = app.listen(config.server.port, '0.0.0.0', () => {
      logger.info(`Server running on port ${config.server.port} in ${config.server.env} mode`);
      
      // Signal to PM2 that the app is ready (used with wait_ready: true option)
      if (process.send) {
        process.send('ready');
        logger.info('Sent ready signal to process manager');
      }
    });
    
    // Configure server timeouts
    server.timeout = 60000; // 60 seconds
    server.keepAliveTimeout = 65000; // 65 seconds
    
    // Handle graceful shutdown
    setupGracefulShutdown(server);
    
    return server;
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Set up graceful shutdown handlers
function setupGracefulShutdown(server) {
  // Handle process signals
  process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
  
  // Handle PM2 shutdown message
  process.on('message', (msg) => {
    if (msg === 'shutdown') {
      gracefulShutdown(server, 'PM2 shutdown');
    }
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    gracefulShutdown(server, 'Uncaught exception');
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection:', reason);
    gracefulShutdown(server, 'Unhandled promise rejection');
  });
}

// Graceful shutdown function
function gracefulShutdown(server, signal) {
  if (isShuttingDown) {
    logger.info(`Shutdown already in progress (signal: ${signal}), skipping`);
    return;
  }
  
  isShuttingDown = true;
  logger.info(`Received ${signal} signal, shutting down gracefully...`);
  
  // Force shutdown after timeout
  const forceShutdownTimeout = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
  
  // Clean shutdown procedure
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      // Close database connection
      await db.close();
      logger.info('All connections closed');
      
      // Clear the timeout and exit gracefully
      clearTimeout(forceShutdownTimeout);
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
  
  // Stop accepting new connections
  if (server.listening) {
    // Notify existing connections to finish
    logger.info('Stopped accepting new connections, waiting for existing connections to close');
  }
}

// Start the server
if (require.main === module) {
  startServer();
}

module.exports = { startServer };