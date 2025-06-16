/**
 * Log cleanup utility
 * 
 * This script removes log files older than the configured retention period.
 * Can be run manually or scheduled with a cron job.
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Configuration
const LOGS_DIR = path.join(process.cwd(), 'logs');
const RETENTION_DAYS = 30; // Keep logs for 30 days

/**
 * Delete logs older than retention period
 */
async function cleanupLogs() {
  try {
    logger.info('Starting log cleanup');
    
    // Get all files in logs directory
    const files = await fs.promises.readdir(LOGS_DIR);
    
    // Calculate cutoff date (current time - retention period)
    const now = new Date();
    const cutoffTime = now.getTime() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    let deletedCount = 0;
    let errorCount = 0;
    
    // Process each file
    for (const file of files) {
      try {
        // Skip directories or non-log files
        if (!file.endsWith('.log') && !file.endsWith('.gz')) {
          continue;
        }
        
        const filePath = path.join(LOGS_DIR, file);
        const stats = await fs.promises.stat(filePath);
        
        // Check if file is older than cutoff date
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.promises.unlink(filePath);
          deletedCount++;
          logger.debug(`Deleted old log file: ${file}`);
        }
      } catch (fileError) {
        logger.error(`Error processing file ${file}: ${fileError.message}`);
        errorCount++;
      }
    }
    
    logger.info(`Log cleanup completed. Deleted ${deletedCount} files. Errors: ${errorCount}.`);
    return { deletedCount, errorCount };
  } catch (error) {
    logger.error(`Log cleanup failed: ${error.message}`);
    throw error;
  }
}

// Run cleanup if called directly
if (require.main === module) {
  cleanupLogs()
    .then(() => {
      logger.info('Log cleanup script finished');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Log cleanup script failed:', error);
      process.exit(1);
    });
}

module.exports = cleanupLogs; 