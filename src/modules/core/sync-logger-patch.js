/**
 * Sync Logger Patch - Replaces individual sync logs with consolidated ones
 * 
 * This module patches the recordSyncLog methods across all models to use
 * consolidated logging instead of creating individual log entries.
 */

const db = require('../../db');
const logger = require('./logger');

class SyncLoggerPatch {
  static syncBatches = new Map();
  static batchTimeout = null;
  static BATCH_FLUSH_DELAY = 5000; // 5 seconds after last sync operation

  /**
   * Replacement for individual recordSyncLog methods
   */
  static async recordSyncLog(entityType, agreementNumber, recordCount = 0, errorMessage = null, startTime = null) {
    try {
      // Create batch key
      const batchKey = `${entityType}_${agreementNumber}`;
      
      // Initialize batch if it doesn't exist
      if (!this.syncBatches.has(batchKey)) {
        this.syncBatches.set(batchKey, {
          entityType,
          agreementNumber,
          totalRecords: 0,
          operations: 0,
          successCount: 0,
          errorCount: 0,
          errors: [],
          firstStartTime: startTime || new Date(),
          lastUpdateTime: new Date()
        });
      }
      
      // Update batch
      const batch = this.syncBatches.get(batchKey);
      batch.totalRecords += recordCount;
      batch.operations++;
      batch.lastUpdateTime = new Date();
      
      if (errorMessage) {
        batch.errorCount++;
        batch.errors.push(errorMessage);
      } else {
        batch.successCount++;
      }
      
      // Schedule batch flush (debounced)
      this.scheduleBatchFlush();
      
      // Return format similar to original
      return {
        entity: entityType,
        operation: 'sync_batched',
        status: errorMessage ? 'error' : 'success',
        recordCount,
        durationMs: 0 // Will be calculated on flush
      };
      
    } catch (error) {
      logger.error('Error in batched sync logging:', error.message);
      return null;
    }
  }

  /**
   * Schedule batch flush with debouncing
   */
  static scheduleBatchFlush() {
    // Clear existing timeout
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    
    // Schedule new flush
    this.batchTimeout = setTimeout(() => {
      this.flushAllBatches();
    }, this.BATCH_FLUSH_DELAY);
  }

  /**
   * Flush all batches to database as consolidated logs
   */
  static async flushAllBatches() {
    if (this.syncBatches.size === 0) return;
    
    try {
      const completedAt = new Date();
      const batches = Array.from(this.syncBatches.values());
      
      for (const batch of batches) {
        const status = batch.errorCount > 0 ? 
          (batch.successCount > 0 ? 'partial' : 'error') : 'success';
        
        const errorMessage = batch.errors.length > 0 ? 
          `${batch.errorCount}/${batch.operations} operations failed` : 
          null;
        
        const durationMs = completedAt.getTime() - batch.firstStartTime.getTime();
        
        // Create consolidated log entry
        await db.query(
          `INSERT INTO sync_logs (
            entity, operation, record_count, status, 
            error_message, started_at, completed_at, duration_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            batch.entityType,
            'sync_consolidated',
            batch.totalRecords,
            status,
            errorMessage,
            batch.firstStartTime,
            completedAt,
            durationMs
          ]
        );
        
        logger.info(`📊 Consolidated sync: ${batch.entityType} - ${batch.totalRecords} records (${batch.operations} operations), Status: ${status}`);
      }
      
      logger.info(`✅ Flushed ${this.syncBatches.size} consolidated sync logs`);
      
      // Clear batches
      this.syncBatches.clear();
      this.batchTimeout = null;
      
    } catch (error) {
      logger.error('Error flushing sync batches:', error.message);
    }
  }

  /**
   * Force flush all pending batches (useful for testing or shutdown)
   */
  static async forceFlush() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    await this.flushAllBatches();
  }

  /**
   * Get current batch summary
   */
  static getBatchSummary() {
    const summary = {
      activeBatches: this.syncBatches.size,
      totalRecords: 0,
      totalOperations: 0
    };
    
    for (const batch of this.syncBatches.values()) {
      summary.totalRecords += batch.totalRecords;
      summary.totalOperations += batch.operations;
    }
    
    return summary;
  }
}

module.exports = SyncLoggerPatch;
