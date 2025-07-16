/**
 * PM2 Ecosystem Configuration
 * Production deployment configuration with automatic restart
 */
module.exports = {
  apps: [
    {
      name: 'economic-api',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      },
      // Restart app if it exceeds memory limits
      max_memory_restart: '1G',
      // Error recovery settings
      exp_backoff_restart_delay: 100,
      // Combine outputs into a single file
      combine_logs: true,
      // Keep the app alive
      kill_timeout: 3000,
      // Restart on file changes
      watch: false,
      // Setup periodic restart to ensure fresh app state
      cron_restart: '0 2 * * *', // Restart at 2 AM every day
      // Ensure startup scripts complete before considering app "ready"
      wait_ready: true,
      // Set up app logging
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      // Merge logs with application logs
      merge_logs: true,
    },
    {
      name: 'economic-sync-api',
      script: 'venv/bin/python',
      args: 'sync_api.py',
      instances: 1,
      autorestart: true,
      watch: false,
      interpreter: 'none',
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      },
      // Restart app if it exceeds memory limits
      max_memory_restart: '512M',
      // Error recovery settings
      exp_backoff_restart_delay: 100,
      // Combine outputs into a single file
      combine_logs: true,
      // Keep the app alive
      kill_timeout: 3000,
      // Set up app logging
      out_file: 'logs/sync-api-out.log',
      error_file: 'logs/sync-api-error.log',
      // Merge logs with application logs
      merge_logs: true,
    },
    {
      name: 'economic-log-cleanup',
      script: 'src/modules/core/log-cleanup.js',
      instances: 1,
      autorestart: false,
      watch: false,
      cron_restart: '0 1 * * *', // Run at 1 AM every day
      env_production: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'economic-daily-sync',
      script: './scripts/trigger_daily_sync.sh',
      instances: 1,
      autorestart: false,
      watch: false,
      interpreter: 'bash',
      // Run daily at 3 AM
      cron_restart: '0 3 * * *',
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      // Auto restart on error with exponential backoff
      exp_backoff_restart_delay: 1000,
      // Set timeout higher for sync process (3 hours)
      kill_timeout: 10800000, // 3 hours in milliseconds
      // Logs
      out_file: 'logs/sync-out.log',
      error_file: 'logs/sync-error.log',
      merge_logs: true,
    },
    {
      name: 'economic-db-log-cleanup',
      script: 'src/modules/core/db-log-cleanup.js',
      instances: 1,
      autorestart: false,
      watch: false,
      // Run daily at 4 AM, after sync process completes
      cron_restart: '0 4 * * *',
      args: "90", // Keep 90 days of logs
      env_production: {
        NODE_ENV: 'production',
      },
      // Logs
      out_file: 'logs/db-log-cleanup-out.log',
      error_file: 'logs/db-log-cleanup-error.log',
      merge_logs: true,
    }
  ],
}; 