/**
 * Enable Consolidated Logging
 * 
 * This module patches all model classes to use consolidated sync logging
 * instead of creating individual log entries for each sync operation.
 */

const SyncLoggerPatch = require('./sync-logger-patch');
const logger = require('./logger');

// Import all models that have recordSyncLog methods
const AccountModel = require('../accounts/account.model');
const JournalModel = require('../journals/journal.model');
const ProductModel = require('../products/product.model');
const VatAccountModel = require('../vat-accounts/vat-account.model');
const CustomerModel = require('../customers/customer.model');
const SupplierModel = require('../suppliers/supplier.model');
const DepartmentModel = require('../departments/department.model');
const ProductGroupModel = require('../product-groups/product-group.model');
const DepartmentalDistributionModel = require('../departmental-distributions/departmental-distribution.model');
const AccountingYearModel = require('../accounting-years/accounting-year.model');
const AccountingPeriodModel = require('../accounting-years/accounting-period.model');
const AccountingEntryModel = require('../accounting-years/accounting-entry.model');
const AccountingTotalModel = require('../accounting-years/accounting-total.model');
const InvoiceModel = require('../invoices/invoice.model');

/**
 * Apply consolidated logging to all models
 */
function enableConsolidatedLogging() {
  const models = [
    { model: AccountModel, name: 'AccountModel' },
    { model: JournalModel, name: 'JournalModel' },
    { model: ProductModel, name: 'ProductModel' },
    { model: VatAccountModel, name: 'VatAccountModel' },
    { model: CustomerModel, name: 'CustomerModel' },
    { model: SupplierModel, name: 'SupplierModel' },
    { model: DepartmentModel, name: 'DepartmentModel' },
    { model: ProductGroupModel, name: 'ProductGroupModel' },
    { model: DepartmentalDistributionModel, name: 'DepartmentalDistributionModel' },
    { model: AccountingYearModel, name: 'AccountingYearModel' },
    { model: AccountingPeriodModel, name: 'AccountingPeriodModel' },
    { model: AccountingEntryModel, name: 'AccountingEntryModel' },
    { model: AccountingTotalModel, name: 'AccountingTotalModel' },
    { model: InvoiceModel, name: 'InvoiceModel' }
  ];

  let patchedCount = 0;

  models.forEach(({ model, name }) => {
    if (model && typeof model.recordSyncLog === 'function') {
      // Store original method (in case we need to restore)
      model._originalRecordSyncLog = model.recordSyncLog;
      
      // Replace with consolidated version
      model.recordSyncLog = function(...args) {
        // Extract entity type from model name (e.g., 'AccountModel' -> 'accounts')
        const entityType = name.toLowerCase().replace('model', '').replace(/([A-Z])/g, '_$1').replace(/^_/, '');
        
        // Call consolidated logger
        return SyncLoggerPatch.recordSyncLog(entityType, ...args);
      };
      
      patchedCount++;
      logger.info(`📋 Patched ${name} to use consolidated logging`);
    }
  });

  logger.info(`✅ Enabled consolidated logging for ${patchedCount} models`);
  
  // Set up cleanup on process exit
  process.on('exit', () => {
    SyncLoggerPatch.forceFlush();
  });
  
  process.on('SIGINT', async () => {
    logger.info('🧹 Flushing consolidated logs before exit...');
    await SyncLoggerPatch.forceFlush();
    process.exit(0);
  });

  return patchedCount;
}

/**
 * Disable consolidated logging and restore original methods
 */
function disableConsolidatedLogging() {
  const models = [
    AccountModel, JournalModel, ProductModel, VatAccountModel,
    CustomerModel, SupplierModel, DepartmentModel, ProductGroupModel,
    DepartmentalDistributionModel, AccountingYearModel, AccountingPeriodModel,
    AccountingEntryModel, AccountingTotalModel, InvoiceModel
  ];

  let restoredCount = 0;

  models.forEach((model) => {
    if (model && model._originalRecordSyncLog) {
      model.recordSyncLog = model._originalRecordSyncLog;
      delete model._originalRecordSyncLog;
      restoredCount++;
    }
  });

  logger.info(`�� Restored original logging for ${restoredCount} models`);
  return restoredCount;
}

module.exports = {
  enableConsolidatedLogging,
  disableConsolidatedLogging,
  SyncLoggerPatch
};
