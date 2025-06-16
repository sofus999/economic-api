/**
 * Database log cleanup utility
 * 
 * This script cleans up old entries in sync_logs table to prevent database bloat.
 * Can be run manually or scheduled with a cron job or task scheduler.
 */
const db = require('../../db');
const logger = require('./logger');

// Default retention period in days
const DEFAULT_RETENTION_DAYS = 90;

/**
 * Clean up old sync log entries
 * @param {number} retentionDays - Number of days to keep logs
 * @returns {Promise<{deletedCount: number, remainingCount: number}>}
 */
async function cleanupSyncLogs(retentionDays = DEFAULT_RETENTION_DAYS) {
  try {
    logger.info(`Starting sync logs database cleanup (retention: ${retentionDays} days)`);
    
    // Try to use the stored procedure if it exists
    try {
      const [results] = await db.query('CALL cleanup_sync_logs(?)', [retentionDays]);
      const remainingCount = results[0].remaining_logs;
      
      logger.info(`Sync logs cleanup completed using stored procedure. Remaining logs: ${remainingCount}`);
      return { 
        deletedCount: -1, // Cannot determine exact count with stored procedure
        remainingCount 
      };
    } catch (procedureError) {
      logger.warn(`Could not use stored procedure: ${procedureError.message}. Falling back to direct query.`);
      
      // Fall back to direct query if stored procedure doesn't exist
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      
      // Get current count
      const [beforeRows] = await db.query('SELECT COUNT(*) AS count FROM sync_logs');
      const beforeCount = beforeRows[0].count;
      
      // Delete old records
      const [deleteResult] = await db.query(
        'DELETE FROM sync_logs WHERE started_at < ?',
        [cutoffDate]
      );
      
      // Get new count
      const [afterRows] = await db.query('SELECT COUNT(*) AS count FROM sync_logs');
      const afterCount = afterRows[0].count;
      
      const deletedCount = deleteResult.affectedRows;
      logger.info(`Sync logs cleanup completed. Deleted ${deletedCount} records. Remaining: ${afterCount}`);
      
      return { deletedCount, remainingCount: afterCount };
    }
  } catch (error) {
    logger.error(`Sync logs cleanup failed: ${error.message}`);
    throw error;
  } finally {
    try {
      // Close database connection
      await db.close();
    } catch (err) {
      logger.error(`Error closing database connection: ${err.message}`);
    }
  }
}

// Run cleanup if called directly
if (require.main === module) {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const retentionDays = args.length > 0 ? parseInt(args[0], 10) : DEFAULT_RETENTION_DAYS;
  
  if (isNaN(retentionDays) || retentionDays <= 0) {
    console.error('Invalid retention period. Please provide a positive number of days.');
    process.exit(1);
  }
  
  cleanupSyncLogs(retentionDays)
    .then(() => {
      logger.info('Database log cleanup script finished');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Database log cleanup script failed:', error);
      process.exit(1);
    });
}

module.exports = cleanupSyncLogs; 