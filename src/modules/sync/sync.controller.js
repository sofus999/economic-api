const logger = require('../core/logger');

// Import all services
const agreementService = require('../agreements/agreement.service');
const paymentTermsService = require('../payment-terms/payment-terms.service');
const productGroupService = require('../product-groups/product-group.service');
const productService = require('../products/product.service');
const vatAccountService = require('../vat-accounts/vat-account.service');
const invoiceService = require('../invoices/invoice.service');
const supplierGroupService = require('../supplier-groups/supplier-group.service');
const supplierService = require('../suppliers/supplier.service');
const accountingYearService = require('../accounting-years/accounting-year.service');
const accountService = require('../accounts/account.service');
const customerService = require('../customers/customer.service');
const departmentService = require('../departments/department.service');
const departmentalDistributionService = require('../departmental-distributions/departmental-distribution.service');
const journalService = require('../journals/journal.service');

class SyncController {
  async syncAll(req, res, next) {
    const startTime = new Date();
    const results = {};
    
    try {
      logger.info('Starting complete data synchronization');
      
      // Define services to sync in logical order (references before dependents)
      const syncServices = [
        { name: 'paymentTerms', service: paymentTermsService, method: 'syncAllPaymentTerms', label: 'payment terms' },
        { name: 'productGroups', service: productGroupService, method: 'syncAllProductGroups', label: 'product groups' },
        { name: 'products', service: productService, method: 'syncAllProducts', label: 'products' },
        { name: 'vatAccounts', service: vatAccountService, method: 'syncAllVatAccounts', label: 'VAT accounts' },
        { name: 'supplierGroups', service: supplierGroupService, method: 'syncAllSupplierGroups', label: 'supplier groups' },
        { name: 'suppliers', service: supplierService, method: 'syncAllSuppliers', label: 'suppliers' },
        { name: 'invoices', service: invoiceService, method: 'syncAllInvoices', label: 'invoices' },
        { name: 'accountingYears', service: accountingYearService, method: 'syncAllAccountingYears', label: 'accounting years' },
        { name: 'accounts', service: accountService, method: 'syncAllAccounts', label: 'accounts' },
        { name: 'customers', service: customerService, method: 'syncAllCustomers', label: 'customers' },
        { name: 'departments', service: departmentService, method: 'syncAllDepartments', label: 'departments' },
        { name: 'departmentalDistributions', service: departmentalDistributionService, method: 'syncAllDistributions', label: 'departmental distributions' },
        { name: 'journals', service: journalService, method: 'syncAllJournals', label: 'journals' }
      ];
      
      // Sync each service in order
      const totalServices = syncServices.length;
      for (let i = 0; i < totalServices; i++) {
        const { name, service, method, label } = syncServices[i];
        logger.info(`${i+1}/${totalServices}: Syncing ${label}...`);
        results[name] = await service[method]();
      }
      
      const endTime = new Date();
      const duration = endTime - startTime;
      
      logger.info(`Complete sync finished in ${duration}ms`);
      
      // Build results object dynamically
      const resultsSummary = {};
      syncServices.forEach(({ name }) => {
        resultsSummary[name] = {
          count: results[name]?.totalCount || 0,
          status: results[name]?.status || 'unknown'
        };
      });
      
      // Return summary of all operations
      res.json({
        status: 'success',
        duration,
        timestamp: new Date(),
        results: resultsSummary
      });
    } catch (error) {
      logger.error('Error in complete sync:', error.message);
      next(error);
    }
  }

  /**
   * Daily sync - only current (non-closed) accounting year with PDF checking
   */
  async syncDaily(req, res, next) {
    const startTime = new Date();
    const results = {};
    
    try {
      logger.info('Starting daily data synchronization (current year + essential reference data)');
      
      // Daily sync should include essential reference data that changes frequently
      // and current year accounting data with PDF checking
      const syncServices = [
        // Group 1: Essential reference data (quick sync)
        { name: 'paymentTerms', service: paymentTermsService, method: 'syncAllPaymentTerms', label: 'payment terms' },
        { name: 'vatAccounts', service: vatAccountService, method: 'syncAllVatAccounts', label: 'VAT accounts' },
        { name: 'accounts', service: accountService, method: 'syncAllAccounts', label: 'accounts' },
        { name: 'customers', service: customerService, method: 'syncAllCustomers', label: 'customers' },
        { name: 'suppliers', service: supplierService, method: 'syncAllSuppliers', label: 'suppliers' },
        { name: 'products', service: productService, method: 'syncAllProducts', label: 'products' },
        
        // Group 2: Current invoices and journals (high frequency data)
        { name: 'invoices', service: invoiceService, method: 'syncAllInvoices', label: 'invoices' },
        { name: 'journals', service: journalService, method: 'syncAllJournals', label: 'journals' }
      ];
      
      // Sync each service
      const totalServices = syncServices.length + 1; // +1 for accounting years
      let completed = 0;
      
      for (const { name, service, method, label } of syncServices) {
        try {
          logger.info(`Starting daily sync of ${label}...`);
          results[name] = await service[method]();
          completed++;
          logger.info(`Completed daily sync of ${label} (${completed}/${totalServices})`);
        } catch (error) {
          logger.error(`Error in daily sync of ${label}:`, error.message);
          results[name] = { status: 'error', error: error.message, totalCount: 0 };
        }
      }
      
      // Sync current year accounting data with PDF checking (main focus)
      try {
        logger.info('Starting daily sync of current accounting year with PDF checking...');
        results.accountingYears = await accountingYearService.syncCurrentYearOnly();
        completed++;
        logger.info(`Completed daily sync of current accounting year (${completed}/${totalServices})`);
      } catch (error) {
        logger.error('Error in daily sync of current accounting year:', error.message);
        results.accountingYears = { status: 'error', error: error.message, totalCount: 0 };
      }
      
      const endTime = new Date();
      const duration = endTime - startTime;
      
      // Calculate total records processed
      const totalCount = Object.values(results).reduce((sum, result) => {
        return sum + (result.totalCount || 0);
      }, 0);
      
      logger.info(`Daily sync finished in ${duration}ms, processed ${totalCount} total records`);
      
      // Return comprehensive summary
      res.json({
        status: 'success',
        duration,
        timestamp: new Date(),
        syncType: 'daily',
        totalCount,
        results
      });
    } catch (error) {
      logger.error('Error in daily sync:', error.message);
      next(error);
    }
  }

  /**
   * Full sync - all data including PDF availability checking for accounting entries
   */
  async syncFull(req, res, next) {
    const startTime = new Date();
    const results = {};
    
    try {
      logger.info('Starting full data synchronization with PDF checking');
      
      // Define services to sync in logical order (references before dependents)
      // For full sync, we include PDF checking for accounting years
      const syncServices = [
        { name: 'paymentTerms', service: paymentTermsService, method: 'syncAllPaymentTerms', label: 'payment terms' },
        { name: 'productGroups', service: productGroupService, method: 'syncAllProductGroups', label: 'product groups' },
        { name: 'products', service: productService, method: 'syncAllProducts', label: 'products' },
        { name: 'vatAccounts', service: vatAccountService, method: 'syncAllVatAccounts', label: 'VAT accounts' },
        { name: 'supplierGroups', service: supplierGroupService, method: 'syncAllSupplierGroups', label: 'supplier groups' },
        { name: 'suppliers', service: supplierService, method: 'syncAllSuppliers', label: 'suppliers' },
        { name: 'invoices', service: invoiceService, method: 'syncAllInvoices', label: 'invoices' },
        { name: 'accounts', service: accountService, method: 'syncAllAccounts', label: 'accounts' },
        { name: 'customers', service: customerService, method: 'syncAllCustomers', label: 'customers' },
        { name: 'departments', service: departmentService, method: 'syncAllDepartments', label: 'departments' },
        { name: 'departmentalDistributions', service: departmentalDistributionService, method: 'syncAllDistributions', label: 'departmental distributions' },
        { name: 'journals', service: journalService, method: 'syncAllJournals', label: 'journals' }
      ];
      
      // Sync each service in order
      const totalServices = syncServices.length + 1; // +1 for accounting years with PDF checking
      
      for (let i = 0; i < syncServices.length; i++) {
        const { name, service, method, label } = syncServices[i];
        logger.info(`${i+1}/${totalServices}: Syncing ${label}...`);
        results[name] = await service[method]();
      }
      
      // Sync accounting years with PDF checking as the last step
      logger.info(`${totalServices}/${totalServices}: Syncing accounting years with PDF checking...`);
      results['accountingYears'] = await accountingYearService.syncAllAccountingYears(true); // true = check PDF availability
      
      const endTime = new Date();
      const duration = endTime - startTime;
      
      logger.info(`Full sync with PDF checking finished in ${duration}ms`);
      
      // Build results object dynamically
      const resultsSummary = {};
      [...syncServices, { name: 'accountingYears' }].forEach(({ name }) => {
        resultsSummary[name] = {
          count: results[name]?.totalCount || 0,
          status: results[name]?.status || 'unknown'
        };
      });
      
      // Return summary of all operations
      res.json({
        status: 'success',
        duration,
        timestamp: new Date(),
        syncType: 'full',
        results: resultsSummary
      });
    } catch (error) {
      logger.error('Error in full sync:', error.message);
      next(error);
    }
  }

  /**
   * Get sync status and recent logs
   */
  async getSyncStatus(req, res, next) {
    try {
      const db = require('../../db');
      
      // Get recent sync logs for all entities
      const recentLogs = await db.query(`
        SELECT entity, operation, status, record_count, error_message, 
               started_at, completed_at, duration_ms
        FROM sync_logs 
        WHERE started_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        ORDER BY started_at DESC 
        LIMIT 50
      `);
      
      // Get latest status for each entity
      const latestStatus = await db.query(`
        SELECT DISTINCT 
          entity,
          FIRST_VALUE(status) OVER (PARTITION BY entity ORDER BY started_at DESC) as latest_status,
          FIRST_VALUE(started_at) OVER (PARTITION BY entity ORDER BY started_at DESC) as last_sync,
          FIRST_VALUE(record_count) OVER (PARTITION BY entity ORDER BY started_at DESC) as last_record_count,
          FIRST_VALUE(error_message) OVER (PARTITION BY entity ORDER BY started_at DESC) as last_error
        FROM sync_logs 
        WHERE started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `);
      
      // Check for currently running syncs
      const runningSyncs = await db.query(`
        SELECT entity, operation, started_at, record_count
        FROM sync_logs 
        WHERE status = 'running'
        ORDER BY started_at DESC
      `);
      
      res.json({
        status: 'success',
        timestamp: new Date(),
        running_syncs: runningSyncs,
        entity_status: latestStatus,
        recent_logs: recentLogs,
        summary: {
          total_entities: latestStatus.length,
          currently_running: runningSyncs.length,
          last_24h_syncs: recentLogs.filter(log => 
            new Date(log.started_at) > new Date(Date.now() - 24 * 60 * 60 * 1000)
          ).length
        }
      });
    } catch (error) {
      logger.error('Error getting sync status:', error.message);
      next(error);
    }
  }
}

module.exports = new SyncController();