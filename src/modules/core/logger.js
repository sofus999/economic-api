const winston = require('winston');
const { format } = winston;
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const config = require('../../config');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Simple format without redundant metadata
const simpleFormat = format.combine(
  format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  format.errors({ stack: false }), // Don't include stack traces unless explicitly needed
  format.printf(info => {
    return `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`;
  })
);

// Console format with colors (even simpler)
const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({
    format: 'HH:mm:ss'
  }),
  format.printf(info => {
    return `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`;
  })
);

// Common configuration for rotation transports
const rotationConfig = {
  dirname: 'logs',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '30d', // Keep logs for 30 days
  maxSize: '20m', // Rotate when log reaches 20MB
  zippedArchive: true, // Compress rotated logs
};

// Create the logger with transports
const logger = winston.createLogger({
  level: config.server.logLevel || 'info',
  // Removed defaultMeta to eliminate redundant metadata
  transports: [
    // Error logs
    new DailyRotateFile({
      ...rotationConfig,
      level: 'error',
      filename: 'error-%DATE%.log',
      format: simpleFormat
    }),
    
    // Combined logs (all levels)
    new DailyRotateFile({
      ...rotationConfig,
      filename: 'combined-%DATE%.log',
      format: simpleFormat
    }),
    
    // Application logs (info and above)
    new DailyRotateFile({
      ...rotationConfig,
      level: 'info',
      filename: 'app-%DATE%.log',
      format: simpleFormat
    })
  ],
  // Don't exit on uncaught exceptions
  exitOnError: false
});

// Add console transport in non-production environments
if (config.server.env !== 'production') {
  logger.add(new winston.transports.Console({
    level: config.server.logLevel,
    format: consoleFormat
  }));
}

// Add event handlers for transport errors
logger.on('error', (error) => {
  console.error('Logger error:', error);
});

// Add custom log levels if LOG_LEVEL=INFO, treat info as debug
const originalInfo = logger.info;
const originalDebug = logger.debug;

// Override info method to respect LOG_LEVEL setting
logger.info = function(message, ...meta) {
  const logLevel = (config.server.logLevel || 'info').toLowerCase();
  if (logLevel === 'info') {
    // When LOG_LEVEL=info, route info messages to debug level
    return originalDebug.call(this, message, ...meta);
  }
  return originalInfo.call(this, message, ...meta);
};

// Generate a unique request ID for tracing (needed by app.js)
logger.requestId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5).toUpperCase();
};

// Safe JSON stringification with error handling
logger.safeStringify = (obj, replacer = null, space = 0) => {
  try {
    return JSON.stringify(obj, replacer, space);
  } catch (error) {
    // Fallback for circular references or other JSON errors
    try {
      const seen = new Set();
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          // Handle circular references
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }
        return value;
      }, space);
    } catch (fallbackError) {
      return `[Object - JSON stringify failed: ${fallbackError.message}]`;
    }
  }
};

module.exports = logger;
