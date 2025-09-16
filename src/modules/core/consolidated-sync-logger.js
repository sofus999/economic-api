const db = require('../core/database');
const logger = require('./logger');

/**
 * Consolidated Sync Logger - Batches sync operations and creates summary logs
 * Instead of creating 100+ individual sync logs, creates one summary per module per sync
 */
class ConsolidatedSyncLogger {
  constructor() {
    this.syncBatches = new Map(); // Store sync data by module
    this.syncStartTime = new Date();
  }

  /**
   * Add a sync operation to the batch
   * @param {string} moduleType - e.g., 'accounts', 'journals', 'products'
   * @param {string} agreementNumber - Agreement number
   * @param {number} recordCount - Number of records processed
   * @param {string|null} errorMessage - Error message if any
   */
  addToSyncBatch(moduleType, agreementNumber, recordCount = 0, errorMessage = null) {
    const key = `${moduleType}_${agreementNumber}`;
    
    if (!this.syncBatches.has(key)) {
      this.syncBatches.set(key, {
        moduleType,
        agreementNumber,
        totalRecords: 0,
        successCount: 0,
        errorCount: 0,
        errors: [],
        firstStartTime: new Date()
      });
    }
    
    const batch = this.syncBatches.get(key);
    batch.totalRecords += recordCount;
    
    if (errorMessage) {
      batch.errorCount++;
      batch.errors.push(errorMessage);
    } else {
      batch.successCount++;
    }
  }

  /**
   * Flush all batched sync operations to the database as summary logs
   */
  async flushSyncBatches() {
    try {
      const completedAt = new Date();
      
      for (const [key, batch] of this.syncBatches) {
        const status = batch.errorCount > 0 ? 
          (batch.successCount > 0 ? 'partial' : 'error') : 'success';
        
        const errorMessage = batch.errors.length > 0 ? 
          `${batch.errorCount} errors: ${batch.errors.slice(0, 3).join('; ')}${batch.errors.length > 3 ? '...' : ''}` : 
          null;
        
        const durationMs = completedAt.getTime() - batch.firstStartTime.getTime();
        
        // Create summary log entry
        await db.query(
          `INSERT INTO sync_logs (
            entity, operation, record_count, status, 
            error_message, started_at, completed_at, duration_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `${batch.moduleType}_${batch.agreementNumber}`,
            'sync_summary',
            batch.totalRecords,
            status,
            errorMessage,
            batch.firstStartTime,
            completedAt,
            durationMs
          ]
        );
        
        logger.info(`📊 Consolidated sync log: ${batch.moduleType} (${batch.agreementNumber}) - ${batch.totalRecords} records, ${batch.successCount} success, ${batch.errorCount} errors`);
      }
      
      logger.info(`✅ Flushed ${this.syncBatches.size} consolidated sync summaries`);
      
      // Clear the batches
      this.syncBatches.clear();
      
    } catch (error) {
      logger.error('Error flushing sync batches:', error.message);
    }
  }

  /**
   * Get summary of current batch
   */
  getSyncSummary() {
    const summary = {
      totalModules: this.syncBatches.size,
      totalRecords: 0,
      totalSuccess: 0,
      totalErrors: 0
    };
    
    for (const batch of this.syncBatches.values()) {
      summary.totalRecords += batch.totalRecords;
      summary.totalSuccess += batch.successCount;
      summary.totalErrors += batch.errorCount;
    }
    
    return summary;
  }
}

module.exports = ConsolidatedSyncLogger;
