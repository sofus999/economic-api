/**
 * Standalone sync utility
 * 
 * This script runs all data syncs without starting the full API server.
 * It can be scheduled with cron or task scheduler for unattended operation.
 */
require('dotenv').config();
const db = require('./db');
const logger = require('./modules/core/logger');
const runMigrations = require('./db/run-migrations');

// Import services
const agreementService = require('./modules/agreements/agreement.service');
const paymentTermsService = require('./modules/payment-terms/payment-terms.service');
const productGroupService = require('./modules/product-groups/product-group.service');
const productService = require('./modules/products/product.service');
const vatAccountService = require('./modules/vat-accounts/vat-account.service');
const invoiceService = require('./modules/invoices/invoice.service');
const supplierGroupService = require('./modules/supplier-groups/supplier-group.service');
const supplierService = require('./modules/suppliers/supplier.service');
const accountingYearService = require('./modules/accounting-years/accounting-year.service');
const accountService = require('./modules/accounts/account.service');
const customerService = require('./modules/customers/customer.service');
const departmentService = require('./modules/departments/department.service');
const departmentalDistributionService = require('./modules/departmental-distributions/departmental-distribution.service');
const journalService = require('./modules/journals/journal.service');

// Store sync results for reporting
const results = {};

// Track completion state
let isCompleted = false;
let hasErrors = false;

/**
 * Run the DAILY sync process with error handling and retry
 * This version only syncs the current (non-closed) accounting year with PDF checking
 */
async function runSync() {
  const startTime = new Date();
  logger.info('Starting DAILY data synchronization (current year only with PDF checking)');
  
  try {
    // Ensure database migrations are up to date
    await runMigrations();
    
    // For daily sync, we focus primarily on current accounting data
    // Other reference data is synced less frequently
    const syncGroups = [
      // Group 1: Essential reference data (quick sync)
      [
        { name: 'paymentTerms', service: paymentTermsService, method: 'syncAllPaymentTerms', label: 'payment terms' },
        { name: 'vatAccounts', service: vatAccountService, method: 'syncAllVatAccounts', label: 'VAT accounts' },
        { name: 'departments', service: departmentService, method: 'syncAllDepartments', label: 'departments' },
      ],
      
      // Group 2: Current year accounting data with PDF checking (main focus)
      [
        { name: 'accountingYears', service: accountingYearService, method: 'syncCurrentYearOnly', label: 'current accounting year (with PDF checking)' },
      ],
      
      // Group 3: Current invoices and journals
      [
        { name: 'invoices', service: invoiceService, method: 'syncAllInvoices', label: 'invoices' },
        { name: 'journals', service: journalService, method: 'syncAllJournals', label: 'journals' }
      ]
    ];
    
    // Process each group in sequence, but services within a group in parallel
    for (let groupIndex = 0; groupIndex < syncGroups.length; groupIndex++) {
      const group = syncGroups[groupIndex];
      logger.info(`Processing daily sync group ${groupIndex + 1} of ${syncGroups.length} with ${group.length} services`);
      
      // Process all services in this group concurrently
      const groupPromises = group.map(async ({ name, service, method, label }) => {
        // Try up to 3 times for each service
        let retries = 3;
        let success = false;
        
        while (!success && retries > 0) {
          try {
            logger.info(`Starting daily sync of ${label}...`);
            results[name] = await service[method]();
            success = true;
            logger.info(`Successfully completed daily sync of ${label}`);
          } catch (error) {
            retries--;
            const retryMessage = retries > 0 ? `, retrying (${retries} attempts left)` : ', giving up';
            logger.error(`Error in daily sync of ${label}: ${error.message}${retryMessage}`);
            
            if (retries > 0) {
              // Wait before retrying
              logger.info(`Waiting 5 seconds before retrying ${label} sync...`);
              await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
              // Record failure
              results[name] = { status: 'error', error: error.message, totalCount: 0 };
              hasErrors = true;
            }
          }
        }
        
        return { name, success };
      });
      
      // Wait for all services in this group to complete
      await Promise.all(groupPromises);
      
      // Brief pause between groups to let the system recover
      if (groupIndex < syncGroups.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    const endTime = new Date();
    const duration = endTime - startTime;
    
    // Build results object for reporting
    const resultsSummary = {};
    syncGroups.flat().forEach(({ name }) => {
      resultsSummary[name] = {
        count: results[name]?.totalCount || 0,
        status: results[name]?.status || 'unknown'
      };
    });
    
    logger.info(`Daily sync finished in ${duration}ms`);
    logger.info(`Daily sync results: ${logger.safeStringify(resultsSummary)}`);
    
    isCompleted = true;
    return resultsSummary;
  } catch (error) {
    logger.error('Fatal error in daily sync process:', error);
    hasErrors = true;
    throw error;
  } finally {
    // Ensure database connection is closed
    try {
      await db.close();
    } catch (error) {
      logger.error('Error closing database connection:', error);
    }
  }
}

// Run sync if called directly
if (require.main === module) {
  runSync()
    .then(() => {
      logger.info('Daily sync completed successfully');
      process.exit(hasErrors ? 1 : 0);
    })
    .catch(error => {
      logger.error('Daily sync failed with fatal error:', error);
      process.exit(1);
    });
}

module.exports = runSync; 