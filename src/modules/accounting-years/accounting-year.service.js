// src/modules/accounting-years/accounting-year.service.js
const ApiClient = require('../../api/client');
const endpoints = require('../../api/endpoints');
const AccountingYearModel = require('./accounting-year.model');
const AccountingPeriodModel = require('./accounting-period.model');
const AccountingEntryModel = require('./accounting-entry.model');
const AccountingTotalModel = require('./accounting-total.model');
const AgreementModel = require('../agreements/agreement.model');
const logger = require('../core/logger');
const axios = require('axios');
const config = require('../../config');

class AccountingYearService {
  /**
   * Get client for a specific agreement
   */
  getClientForAgreement(agreementToken) {
    return ApiClient.forAgreement(agreementToken);
  }

  /**
   * Get current (non-closed) accounting years for all agreements
   */
  async getCurrentAccountingYears() {
    try { 
      const currentYears = new Map();
      const agreements = await AgreementModel.getAll(true);
      
      for (const agreement of agreements) {
        try {
          const client = this.getClientForAgreement(agreement.agreement_grant_token);
          const accountingYears = await client.getPaginated('/accounting-years');
          
          // Find the first non-closed year (should be the current year)
          const currentYear = accountingYears.find(year => !year.closed);
          if (currentYear) {
            currentYears.set(agreement.agreement_number, currentYear.year);
            logger.info(`Current year for agreement ${agreement.agreement_number}: ${currentYear.year}`);
          }
        } catch (error) {
          logger.error(`Error getting current year for agreement ${agreement.agreement_number}:`, error.message);
        }
      }
      
      return currentYears;
    } catch (error) {
      logger.error('Error getting current accounting years:', error.message);
      throw error;
    }
  }

  /**
   * Check if voucher has PDF document available
   */
  async checkVoucherPdfAvailability(voucherNumber, agreementNumber, agreementToken) {
    try {
      if (!voucherNumber || !agreementNumber || !agreementToken) {
        return false;
      }

      const documentsApiUrl = `https://apis.e-conomic.com/documentsapi/v2.1.0/AttachedDocuments?filter=voucherNumber$eq:${voucherNumber}`;
      
      const response = await axios({
        method: 'GET',
        url: documentsApiUrl,
        headers: {
          'X-AppSecretToken': config.api.appSecretToken,
          'X-AgreementGrantToken': agreementToken,
          'Content-Type': 'application/json'
        },
        timeout: 10000, // 10 second timeout
        validateStatus: function (status) {
          return status < 500; // Accept all status codes below 500
        }
      });
      
      if (response.status === 200 && response.data.items && response.data.items.length > 0) {
        logger.debug(`PDF available for voucher ${voucherNumber} in agreement ${agreementNumber}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.debug(`No PDF available for voucher ${voucherNumber} in agreement ${agreementNumber}: ${error.message}`);
      return false;
    }
  }

  /**
   * Update accounting entries with PDF availability information
   */
  async updateEntriesWithPdfAvailability(entries, agreementNumber, agreementToken) {
    try {
      const updatedEntries = [];
      const batchSize = 50; // Process in smaller batches to avoid overwhelming the API
      
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        const batchPromises = batch.map(async (entry) => {
          let hasPdf = false;
          
          // Customer invoices ALWAYS have PDFs available via the invoice API
          if (entry.entry_type === 'customerInvoice') {
            hasPdf = true;
          }
          // Only check for PDF availability for voucher types that might have PDFs
          else if (entry.voucher_number && ['financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder'].includes(entry.entry_type)) {
            hasPdf = await this.checkVoucherPdfAvailability(entry.voucher_number, agreementNumber, agreementToken);
          }
          
          return {
            ...entry,
            has_pdf_document: hasPdf
          };
        });
        
        const batchResults = await Promise.all(batchPromises);
        updatedEntries.push(...batchResults);
        
        // Small delay between batches to be nice to the API
        if (i + batchSize < entries.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      return updatedEntries;
    } catch (error) {
      logger.error('Error updating entries with PDF availability:', error.message);
      return entries; // Return original entries if PDF checking fails
    }
  }

  /**
   * Transform API accounting year data to our database model
   */
  transformAccountingYearData(year, agreementNumber) {
    return {
      year_id: year.year,
      agreement_number: agreementNumber,
      start_date: year.fromDate,
      end_date: year.toDate,
      closed: year.closed || false,
      self_url: year.self
    };
  }

  /**
   * Normalize period number to be within 0-12 range
   * 0 = annual, 1-12 = monthly
   */
  normalizePeriodNumber(apiPeriodNumber) {
    if (apiPeriodNumber === 0) return 0; // Annual total
    
    // Normalize to 1-12 by taking modulo 12, handling the special case where period is multiple of 12
    const normalizedPeriod = apiPeriodNumber % 12;
    return normalizedPeriod === 0 ? 12 : normalizedPeriod;
  }

  /**
   * Transform API accounting period data to our database model with normalized period numbers
   */
  transformAccountingPeriodData(period, yearId, agreementNumber) {
    const normalizedPeriodNumber = this.normalizePeriodNumber(period.periodNumber);
    
    return {
      period_number: normalizedPeriodNumber,
      year_id: yearId,
      agreement_number: agreementNumber,
      from_date: period.fromDate,
      to_date: period.toDate,
      barred: period.barred || false,
      self_url: period.self
    };
  }

  /**
   * Transform API accounting entry data to our database model with normalized period numbers
   */
  transformAccountingEntryData(entry, yearId, apiPeriodNumber, agreementNumber) {
    const normalizedPeriodNumber = this.normalizePeriodNumber(apiPeriodNumber);
    
    return {
      entry_number: entry.entryNumber,
      year_id: yearId,
      period_number: normalizedPeriodNumber,
      agreement_number: agreementNumber,
      account_number: entry.account.accountNumber,
      amount: entry.amount,
      amount_in_base_currency: entry.amountInBaseCurrency,
      currency: entry.currency,
      entry_date: entry.date,
      entry_text: entry.text,
      entry_type: entry.entryType || null,
      voucher_number: entry.voucherNumber || null,
      self_url: entry.self
    };
  }

  /**
   * Transform API accounting total data to our database model with normalized period numbers
   */
  transformAccountingTotalData(total, yearId, apiPeriodNumber, agreementNumber) {
    // For year totals, API period may be null, set to 0
    const normalizedPeriodNumber = apiPeriodNumber === null ? 0 : this.normalizePeriodNumber(apiPeriodNumber);
    
    return {
      account_number: total.account.accountNumber,
      year_id: yearId,
      period_number: normalizedPeriodNumber,
      agreement_number: agreementNumber,
      total_in_base_currency: total.totalInBaseCurrency,
      from_date: total.fromDate,
      to_date: total.toDate
    };
  }

  /**
   * Ensure period exists before trying to add entries or totals
   */
  async ensurePeriodExists(periodNumber, yearId, agreementNumber, fromDate, toDate) {
    try {
      const existing = await AccountingPeriodModel.findByNumberYearAndAgreement(
        periodNumber, yearId, agreementNumber
      );
      
      if (!existing) {
        logger.info(`Creating missing period ${periodNumber} for year ${yearId}, agreement ${agreementNumber}`);
        
        // Create default period
        await AccountingPeriodModel.upsert({
          period_number: periodNumber,
          year_id: yearId,
          agreement_number: agreementNumber,
          from_date: fromDate || new Date(`${yearId}-01-01`),
          to_date: toDate || new Date(`${yearId}-12-31`),
          barred: false,
          self_url: null
        });
        
        return true;
      }
      
      return true;
    } catch (error) {
      logger.error(`Error ensuring period exists: ${error.message}`);
      return false;
    }
  }

  /**
   * Sync accounting years for a specific agreement
   */
  async syncAccountingYearsForAgreement(agreement, checkPdfAvailability = false) {
    const startTime = new Date();
    let recordCount = 0;
    
    try {
      logger.info(`Starting accounting years sync for agreement ${agreement.name} (${agreement.agreement_number}) with PDF check: ${checkPdfAvailability}`);
      
      const client = this.getClientForAgreement(agreement.agreement_grant_token);
      const agreementInfo = await client.getAgreementInfo();
      const agreementNumber = agreementInfo.agreementNumber;
      
      const accountingYears = await client.getPaginated('/accounting-years');
      logger.info(`Found ${accountingYears.length} accounting years for agreement ${agreementNumber}`);
      
      for (const year of accountingYears) {
        const yearId = year.year;
        const yearData = this.transformAccountingYearData(year, agreementNumber);
        await AccountingYearModel.upsert(yearData);
        recordCount++;
        
        // For each year, ensure period 0 exists for year totals
        await this.ensurePeriodExists(0, yearId, agreementNumber, 
          yearData.start_date, yearData.end_date);
        
        // Sync periods for each year
        await this.syncAccountingPeriodsForYear(agreement, yearId, checkPdfAvailability);
      }
      
      await AccountingYearModel.recordSyncLog(
        agreementNumber,
        recordCount,
        null,
        startTime
      );
      
      logger.info(`Completed accounting years sync for agreement ${agreementNumber}: ${recordCount} records processed`);
      
      return {
        agreement: {
          id: agreement.id,
          name: agreement.name,
          agreement_number: agreementNumber
        },
        recordCount
      };
      
    } catch (error) {
      logger.error(`Error syncing accounting years for agreement ${agreement.id}:`, error.message);
      
      await AccountingYearModel.recordSyncLog(
        agreement.agreement_number || 'unknown',
        recordCount,
        error.message,
        startTime
      );
      
      throw error;
    }
  }

  /**
   * Sync accounting periods for a specific year
   */
  async syncAccountingPeriodsForYear(agreement, yearId, checkPdfAvailability = false) {
    const startTime = new Date();
    let recordCount = 0;
    
    try {
      logger.info(`Starting accounting periods sync for year ${yearId} and agreement ${agreement.name} (PDF check: ${checkPdfAvailability})`);
      
      const client = this.getClientForAgreement(agreement.agreement_grant_token);
      const agreementInfo = await client.getAgreementInfo();
      const agreementNumber = agreementInfo.agreementNumber;
      
      const periods = await client.getPaginated(`/accounting-years/${yearId}/periods`);
      logger.info(`Found ${periods.length} accounting periods for year ${yearId} and agreement ${agreementNumber}`);
      
      // Create a set to track which normalized period numbers we've already processed
      const processedPeriods = new Set();
      
      for (const period of periods) {
        const periodData = this.transformAccountingPeriodData(period, yearId, agreementNumber);
        const normalizedPeriod = periodData.period_number;
        
        // Skip if we've already processed this normalized period
        if (processedPeriods.has(normalizedPeriod)) {
          logger.debug(`Skipping duplicate normalized period ${normalizedPeriod} for year ${yearId}`);
          continue;
        }
        
        await AccountingPeriodModel.upsert(periodData);
        processedPeriods.add(normalizedPeriod);
        recordCount++;
        
        // Sync entries and totals for each period
        try {
          await this.syncAccountingEntriesForPeriod(agreement, yearId, period.periodNumber, checkPdfAvailability);
        } catch (error) {
          logger.error(`Error syncing entries for period ${period.periodNumber}: ${error.message}`);
        }
        
        try {
          await this.syncAccountingTotalsForPeriod(agreement, yearId, period.periodNumber);
        } catch (error) {
          logger.error(`Error syncing totals for period ${period.periodNumber}: ${error.message}`);
        }
      }
      
      // Ensure we have period 0 for year totals
      if (!processedPeriods.has(0)) {
        const yearInfo = await AccountingYearModel.findByYearAndAgreement(yearId, agreementNumber);
        if (yearInfo) {
          await this.ensurePeriodExists(0, yearId, agreementNumber, yearInfo.start_date, yearInfo.end_date);
          recordCount++;
        }
      }
      
      // Sync year totals
      try {
        await this.syncAccountingTotalsForYear(agreement, yearId);
      } catch (error) {
        logger.error(`Error syncing year totals: ${error.message}`);
      }
      
      await AccountingPeriodModel.recordSyncLog(
        agreementNumber,
        yearId,
        recordCount,
        null,
        startTime
      );
      
      logger.info(`Completed accounting periods sync for year ${yearId} and agreement ${agreementNumber}: ${recordCount} records processed`);
      
      return {
        agreement: {
          id: agreement.id,
          name: agreement.name,
          agreement_number: agreementNumber
        },
        yearId,
        recordCount
      };
      
    } catch (error) {
      logger.error(`Error syncing accounting periods for year ${yearId} and agreement ${agreement.id}:`, error.message);
      
      await AccountingPeriodModel.recordSyncLog(
        agreement.agreement_number || 'unknown',
        yearId,
        recordCount,
        error.message,
        startTime
      );
      
      throw error;
    }
  }

  /**
   * Sync accounting entries for a specific period with PDF availability checking
   */
  async syncAccountingEntriesForPeriod(agreement, yearId, apiPeriodNumber, checkPdfAvailability = false) {
    const startTime = new Date();
    let recordCount = 0;
    
    try {
      logger.info(`Starting accounting entries sync for period ${apiPeriodNumber}, year ${yearId} and agreement ${agreement.name}`);
      
      const client = this.getClientForAgreement(agreement.agreement_grant_token);
      const agreementInfo = await client.getAgreementInfo();
      const agreementNumber = agreementInfo.agreementNumber;
      
      const normalizedPeriodNumber = this.normalizePeriodNumber(apiPeriodNumber);
      
      // Ensure period exists before adding entries
      const periodExists = await this.ensurePeriodExists(
        normalizedPeriodNumber, 
        yearId, 
        agreementNumber,
        null, null // Will be set with default dates
      );
      
      if (!periodExists) {
        throw new Error(`Cannot sync entries: period ${normalizedPeriodNumber} does not exist for year ${yearId}`);
      }
      
      let entries = await client.getPaginated(`/accounting-years/${yearId}/periods/${apiPeriodNumber}/entries`);
      logger.info(`Found ${entries.length} accounting entries for period ${apiPeriodNumber}, year ${yearId} and agreement ${agreementNumber}`);
      
      // Transform entries first
      const transformedEntries = entries.map(entry => 
        this.transformAccountingEntryData(entry, yearId, apiPeriodNumber, agreementNumber)
      );
      
      // Check PDF availability if requested
      if (checkPdfAvailability) {
        logger.info(`Checking PDF availability for ${transformedEntries.length} entries...`);
        const entriesWithPdf = await this.updateEntriesWithPdfAvailability(transformedEntries, agreementNumber, agreement.agreement_grant_token);
        
        // Update database with PDF availability information
        await this.updatePdfAvailabilityInDatabase(entriesWithPdf);
      }
      
      // Process entries in batches to avoid memory issues
      const batchSize = 100;
      for (let i = 0; i < transformedEntries.length; i += batchSize) {
        const batch = transformedEntries.slice(i, i + batchSize);
        const result = await AccountingEntryModel.batchUpsert(batch);
        recordCount += result.inserted + result.updated;
      }
      
      await AccountingEntryModel.recordSyncLog(
        agreementNumber,
        yearId,
        normalizedPeriodNumber,
        recordCount,
        null,
        startTime
      );
      
      logger.info(`Completed accounting entries sync for period ${apiPeriodNumber} (normalized: ${normalizedPeriodNumber}), year ${yearId} and agreement ${agreementNumber}: ${recordCount} records processed`);
      
      return {
        agreement: {
          id: agreement.id,
          name: agreement.name,
          agreement_number: agreementNumber
        },
        yearId,
        period: normalizedPeriodNumber,
        recordCount
      };
      
    } catch (error) {
      const normalizedPeriodNumber = this.normalizePeriodNumber(apiPeriodNumber);
      
      // Handle 404 errors more gracefully - some periods may not exist
      if (error.message && error.message.includes('404')) {
        logger.warn(`Period ${apiPeriodNumber} (normalized: ${normalizedPeriodNumber}) not found for year ${yearId} in agreement ${agreement.name} - this is normal if the period doesn't exist yet`);
        
        await AccountingEntryModel.recordSyncLog(
          agreement.agreement_number || 'unknown',
          yearId,
          normalizedPeriodNumber,
          0,
          `Period ${apiPeriodNumber} not available - skipped`,
          startTime
        );
        
        return {
          agreement: {
            id: agreement.id,
            name: agreement.name,
            agreement_number: agreement.agreement_number || 'unknown'
          },
          yearId,
          period: normalizedPeriodNumber,
          recordCount: 0,
          status: 'skipped',
          reason: 'Period not available'
        };
      }
      
      logger.error(`Error syncing accounting entries for period ${apiPeriodNumber}, year ${yearId} and agreement ${agreement.id}:`, error.message);
      
      await AccountingEntryModel.recordSyncLog(
        agreement.agreement_number || 'unknown',
        yearId,
        normalizedPeriodNumber,
        recordCount,
        error.message,
        startTime
      );
      
      throw error;
    }
  }

  /**
   * Sync accounting totals for a specific period
   */
  async syncAccountingTotalsForPeriod(agreement, yearId, apiPeriodNumber) {
    const startTime = new Date();
    let recordCount = 0;
    
    try {
      logger.info(`Starting accounting totals sync for period ${apiPeriodNumber}, year ${yearId} and agreement ${agreement.name}`);
      
      const client = this.getClientForAgreement(agreement.agreement_grant_token);
      const agreementInfo = await client.getAgreementInfo();
      const agreementNumber = agreementInfo.agreementNumber;
      
      const normalizedPeriodNumber = this.normalizePeriodNumber(apiPeriodNumber);
      
      // Ensure period exists before adding totals
      const periodExists = await this.ensurePeriodExists(
        normalizedPeriodNumber, 
        yearId, 
        agreementNumber,
        null, null // Will be set with default dates
      );
      
      if (!periodExists) {
        throw new Error(`Cannot sync totals: period ${normalizedPeriodNumber} does not exist for year ${yearId}`);
      }
      
      const totals = await client.getPaginated(`/accounting-years/${yearId}/periods/${apiPeriodNumber}/totals`);
      logger.info(`Found ${totals.length} accounting totals for period ${apiPeriodNumber}, year ${yearId} and agreement ${agreementNumber}`);
      
      if (totals.length > 0) {
        const transformedTotals = totals.map(total => 
          this.transformAccountingTotalData(total, yearId, apiPeriodNumber, agreementNumber)
        );
        
        const result = await AccountingTotalModel.batchUpsert(transformedTotals);
        recordCount = result.inserted + result.updated;
      }
      
      await AccountingTotalModel.recordSyncLog(
        agreementNumber,
        yearId,
        normalizedPeriodNumber,
        recordCount,
        null,
        startTime
      );
      
      logger.info(`Completed accounting totals sync for period ${apiPeriodNumber} (normalized: ${normalizedPeriodNumber}), year ${yearId} and agreement ${agreementNumber}: ${recordCount} records processed`);
      
      return {
        agreement: {
          id: agreement.id,
          name: agreement.name,
          agreement_number: agreementNumber
        },
        yearId,
        period: normalizedPeriodNumber,
        recordCount
      };
      
    } catch (error) {
      logger.error(`Error syncing accounting totals for period ${apiPeriodNumber}, year ${yearId} and agreement ${agreement.id}:`, error.message);
      
      const normalizedPeriodNumber = this.normalizePeriodNumber(apiPeriodNumber);
      await AccountingTotalModel.recordSyncLog(
        agreement.agreement_number || 'unknown',
        yearId,
        normalizedPeriodNumber,
        recordCount,
        error.message,
        startTime
      );
      
      throw error;
    }
  }

  /**
   * Sync accounting totals for a specific year
   */
  async syncAccountingTotalsForYear(agreement, yearId) {
    const startTime = new Date();
    let recordCount = 0;
    
    try {
      logger.info(`Starting accounting totals sync for year ${yearId} and agreement ${agreement.name}`);
      
      const client = this.getClientForAgreement(agreement.agreement_grant_token);
      const agreementInfo = await client.getAgreementInfo();
      const agreementNumber = agreementInfo.agreementNumber;
      
      // Ensure period 0 exists for year totals
      const yearInfo = await AccountingYearModel.findByYearAndAgreement(yearId, agreementNumber);
      if (yearInfo) {
        await this.ensurePeriodExists(0, yearId, agreementNumber, yearInfo.start_date, yearInfo.end_date);
      }
      
      const totals = await client.getPaginated(`/accounting-years/${yearId}/totals`);
      logger.info(`Found ${totals.length} accounting totals for year ${yearId} and agreement ${agreementNumber}`);
      
      if (totals.length > 0) {
        const transformedTotals = totals.map(total => 
          this.transformAccountingTotalData(total, yearId, null, agreementNumber)
        );
        
        const result = await AccountingTotalModel.batchUpsert(transformedTotals);
        recordCount = result.inserted + result.updated;
      }
      
      await AccountingTotalModel.recordSyncLog(
        agreementNumber,
        yearId,
        0, // Use 0 for year totals
        recordCount,
        null,
        startTime
      );
      
      logger.info(`Completed accounting totals sync for year ${yearId} and agreement ${agreementNumber}: ${recordCount} records processed`);
      
      return {
        agreement: {
          id: agreement.id,
          name: agreement.name,
          agreement_number: agreementNumber
        },
        yearId,
        recordCount
      };
      
    } catch (error) {
      logger.error(`Error syncing accounting totals for year ${yearId} and agreement ${agreement.id}:`, error.message);
      
      await AccountingTotalModel.recordSyncLog(
        agreement.agreement_number || 'unknown',
        yearId,
        0, // Use 0 for year totals
        recordCount,
        error.message,
        startTime
      );
      
      throw error;
    }
  }

  /**
   * Update database with PDF availability information
   */
  async updatePdfAvailabilityInDatabase(entries) {
    try {
      const db = require('../../db');
      
      // Create a table to store PDF availability if it doesn't exist
      await db.query(`
        CREATE TABLE IF NOT EXISTS voucher_pdf_availability (
          voucher_number INT NOT NULL,
          agreement_number INT NOT NULL,
          has_pdf BOOLEAN NOT NULL,
          last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (voucher_number, agreement_number)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      
      // Update PDF availability for vouchers
      for (const entry of entries) {
        if (entry.voucher_number && entry.has_pdf_document !== undefined) {
          await db.query(`
            INSERT INTO voucher_pdf_availability (voucher_number, agreement_number, has_pdf)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE has_pdf = VALUES(has_pdf), last_checked = CURRENT_TIMESTAMP
          `, [entry.voucher_number, entry.agreement_number, entry.has_pdf_document]);
        }
      }
      
      logger.info(`Updated PDF availability for ${entries.filter(e => e.voucher_number).length} vouchers`);
    } catch (error) {
      logger.error('Error updating PDF availability in database:', error.message);
    }
  }

  /**
   * Sync accounting years for current year only (daily sync)
   */
  async syncCurrentYearOnly() {
    const startTime = new Date();
    const agreementResults = [];
    let totalCount = 0;
    
    try {
      logger.info('Starting daily sync of current accounting year across all agreements');
      
      const agreements = await AgreementModel.getAll(true);
      
      if (agreements.length === 0) {
        logger.warn('No active agreements found for sync');
        return {
          status: 'warning',
          message: 'No active agreements found',
          results: [],
          totalCount: 0
        };
      }
      
      // Get current years for all agreements
      const currentYears = await this.getCurrentAccountingYears();
      
      for (const agreement of agreements) {
        try {
          const currentYear = currentYears.get(agreement.agreement_number);
          if (!currentYear) {
            logger.warn(`No current year found for agreement ${agreement.name}, skipping`);
            continue;
          }
          
          logger.info(`Syncing current year ${currentYear} for agreement ${agreement.name}`);
          const result = await this.syncAccountingYearForAgreement(agreement, currentYear, true); // true = check PDF availability
          agreementResults.push(result);
          totalCount += result.recordCount;
        } catch (error) {
          // Handle 404 errors more gracefully in daily sync
          if (error.message && error.message.includes('404')) {
            logger.warn(`Current year not found for agreement ${agreement.name} - this may be normal for new or inactive agreements`);
            agreementResults.push({
              agreement: {
                id: agreement.id,
                name: agreement.name,
                agreement_number: agreement.agreement_number
              },
              status: 'skipped',
              reason: 'Current year not available',
              recordCount: 0
            });
          } else {
            logger.error(`Error syncing current year for agreement ${agreement.name}:`, error.message);
            agreementResults.push({
              agreement: {
                id: agreement.id,
                name: agreement.name,
                agreement_number: agreement.agreement_number
              },
              status: 'error',
              error: error.message
            });
          }
        }
      }
      
      logger.info(`Completed daily sync across all agreements: ${totalCount} records processed`);
      
      return {
        status: 'success',
        results: agreementResults,
        totalCount,
        syncType: 'daily'
      };
      
    } catch (error) {
      logger.error('Error in daily sync process:', error.message);
      throw error;
    }
  }

  /**
   * Sync specific accounting year for agreement with optional PDF checking
   */
  async syncAccountingYearForAgreement(agreement, yearId, checkPdfAvailability = false) {
    const startTime = new Date();
    let recordCount = 0;
    
    try {
      logger.info(`Starting accounting year ${yearId} sync for agreement ${agreement.name} (PDF check: ${checkPdfAvailability})`);
      
      const client = this.getClientForAgreement(agreement.agreement_grant_token);
      const agreementInfo = await client.getAgreementInfo();
      const agreementNumber = agreementInfo.agreementNumber;
      
      // Get the specific year data
      const yearData = await client.get(`/accounting-years/${yearId}`);
      const transformedYearData = this.transformAccountingYearData(yearData, agreementNumber);
      await AccountingYearModel.upsert(transformedYearData);
      recordCount++;
      
      // Ensure period 0 exists for year totals
      await this.ensurePeriodExists(0, yearId, agreementNumber, 
        transformedYearData.start_date, transformedYearData.end_date);
      
      // Sync periods for this year
      await this.syncAccountingPeriodsForYear(agreement, yearId, checkPdfAvailability);
      
      await AccountingYearModel.recordSyncLog(
        agreementNumber,
        recordCount,
        null,
        startTime
      );
      
      logger.info(`Completed accounting year ${yearId} sync for agreement ${agreementNumber}: ${recordCount} records processed`);
      
      return {
        agreement: {
          id: agreement.id,
          name: agreement.name,
          agreement_number: agreementNumber
        },
        yearId,
        recordCount
      };
      
    } catch (error) {
      // Handle 404 errors more gracefully - some agreements may not have certain years
      if (error.message && error.message.includes('404')) {
        logger.warn(`Accounting year ${yearId} not found for agreement ${agreement.name} (${agreement.id}) - this is normal if the year doesn't exist yet`);
        
        await AccountingYearModel.recordSyncLog(
          agreement.agreement_number || 'unknown',
          0,
          `Year ${yearId} not available - skipped`,
          startTime
        );
        
        return {
          agreement: {
            id: agreement.id,
            name: agreement.name,
            agreement_number: agreement.agreement_number || 'unknown'
          },
          yearId,
          recordCount: 0,
          status: 'skipped',
          reason: 'Year not available'
        };
      }
      
      logger.error(`Error syncing accounting year ${yearId} for agreement ${agreement.id}:`, error.message);
      
      await AccountingYearModel.recordSyncLog(
        agreement.agreement_number || 'unknown',
        recordCount,
        error.message,
        startTime
      );
      
      throw error;
    }
  }

  /**
   * Sync all accounting years across all agreements with PDF checking (full sync)
   */
  async syncAllAccountingYears(checkPdfAvailability = false) {
    const startTime = new Date();
    const agreementResults = [];
    let totalCount = 0;
    
    try {
      logger.info(`Starting ${checkPdfAvailability ? 'full' : 'standard'} sync of accounting years across all agreements`);
      
      const agreements = await AgreementModel.getAll(true);
      
      if (agreements.length === 0) {
        logger.warn('No active agreements found for sync');
        return {
          status: 'warning',
          message: 'No active agreements found',
          results: [],
          totalCount: 0
        };
      }
      
      for (const agreement of agreements) {
        try {
          const result = await this.syncAccountingYearsForAgreement(agreement, checkPdfAvailability);
          agreementResults.push(result);
          totalCount += result.recordCount;
        } catch (error) {
          logger.error(`Error syncing accounting years for agreement ${agreement.name}:`, error.message);
          agreementResults.push({
            agreement: {
              id: agreement.id,
              name: agreement.name,
              agreement_number: agreement.agreement_number
            },
            status: 'error',
            error: error.message
          });
        }
      }
      
      logger.info(`Completed ${checkPdfAvailability ? 'full' : 'standard'} accounting years sync across all agreements: ${totalCount} records processed`);
      
      return {
        status: 'success',
        results: agreementResults,
        totalCount,
        syncType: checkPdfAvailability ? 'full' : 'standard'
      };
      
    } catch (error) {
      logger.error('Error in overall accounting years sync process:', error.message);
      throw error;
    }
  }
}

module.exports = new AccountingYearService();