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
    
    try {
      logger.info('Starting daily data synchronization (current year only)');
      
      // Daily sync focuses on accounting data for current year
      const result = await accountingYearService.syncCurrentYearOnly();
      
      const endTime = new Date();
      const duration = endTime - startTime;
      
      logger.info(`Daily sync finished in ${duration}ms`);
      
      // Return summary
      res.json({
        status: 'success',
        duration,
        timestamp: new Date(),
        syncType: 'daily',
        accountingYears: {
          count: result.totalCount || 0,
          status: result.status || 'unknown',
          results: result.results
        }
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
}

module.exports = new SyncController();