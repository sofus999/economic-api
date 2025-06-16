const db = require('../index');
const logger = require('../../modules/core/logger');

async function up() {
  logger.info('Running migration: 002-sync-logs-cleanup');
  
  try {
    // Add retention_days column to sync_logs if it doesn't exist
    try {
      await db.query(`
        ALTER TABLE sync_logs 
        ADD COLUMN retention_days INT DEFAULT 90 COMMENT 'Number of days to keep this log record'
      `);
    } catch (error) {
      // Column might already exist, check if error is for duplicate column
      if (!error.message.includes('Duplicate column name')) {
        throw error;
      }
      logger.info('retention_days column already exists, skipping...');
    }
    
    // Create stored procedure for cleaning up old sync logs
    await db.query(`
      CREATE PROCEDURE IF NOT EXISTS cleanup_sync_logs(IN days_to_keep INT)
      BEGIN
        SET @cutoff_date = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL days_to_keep DAY);
        
        -- Delete old sync logs
        DELETE FROM sync_logs 
        WHERE started_at < @cutoff_date 
        OR (retention_days IS NOT NULL AND started_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL retention_days DAY));
        
        -- Return number of records left
        SELECT COUNT(*) AS remaining_logs FROM sync_logs;
      END
    `);
    
    // Create an event to run cleanup automatically (if event scheduler is enabled)
    await db.query(`
      CREATE EVENT IF NOT EXISTS daily_sync_logs_cleanup
      ON SCHEDULE EVERY 1 DAY
      STARTS CURRENT_TIMESTAMP + INTERVAL 1 DAY
      DO
      BEGIN
        CALL cleanup_sync_logs(90);
      END
    `);
    
    // Enable event scheduler if possible
    try {
      await db.query(`SET GLOBAL event_scheduler = ON`);
    } catch (err) {
      logger.warn('Could not enable event scheduler. Daily cleanup will require manual execution or privileged user.');
    }
    
    logger.info('Migration 002-sync-logs-cleanup completed successfully');
  } catch (error) {
    logger.error('Error running migration 002-sync-logs-cleanup:', error.message);
    throw error;
  }
}

async function down() {
  logger.info('Reverting migration: 002-sync-logs-cleanup');
  
  try {
    // Drop the stored procedure
    await db.query('DROP PROCEDURE IF EXISTS cleanup_sync_logs');
    
    // Drop the event
    await db.query('DROP EVENT IF EXISTS daily_sync_logs_cleanup');
    
    // Remove the retention_days column
    try {
      await db.query('ALTER TABLE sync_logs DROP COLUMN retention_days');
    } catch (error) {
      if (!error.message.includes("doesn't exist")) {
        throw error;
      }
      logger.info('retention_days column already removed, skipping...');
    }
    
    logger.info('Migration 002-sync-logs-cleanup reverted successfully');
  } catch (error) {
    logger.error('Error reverting migration 002-sync-logs-cleanup:', error.message);
    throw error;
  }
}

module.exports = { up, down }; 