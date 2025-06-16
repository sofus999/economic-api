#!/usr/bin/env node

// Simple startup script with error handling
console.log('Starting Economic API Application...');
console.log('Node version:', process.version);
console.log('Working directory:', process.cwd());
console.log('Environment:', process.env.NODE_ENV || 'development');

// Load environment variables
require('dotenv').config();

console.log('Environment loaded. Starting server...');

try {
  const { startServer } = require('./src/server');
  startServer()
    .then(() => {
      console.log('✅ Server started successfully!');
    })
    .catch((error) => {
      console.error('❌ Server startup failed:', error);
      process.exit(1);
    });
} catch (error) {
  console.error('❌ Failed to load server module:', error);
  process.exit(1);
} 