const axios = require('axios');
const config = require('../../config');
const db = require('../../db');
const logger = require('../core/logger');

class VoucherService {
  constructor() {
    logger.info('VoucherService initialized');
  }

  /**
   * Get voucher PDF using the e-conomic documents API workflow:
   * 1. Get accounting entry to find voucher number
   * 2. Get document number using voucher number  
   * 3. Fetch PDF using document number
   */
  async getVoucherPdf(voucherNumber, agreementNumber) {
    try {
      const voucherNum = parseInt(voucherNumber, 10);
      const agrNumber = parseInt(agreementNumber, 10);
      
      logger.info(`Fetching PDF for voucher=${voucherNum} agreement=${agrNumber}`);
      
      // Get agreement details for authentication
      logger.info(`Looking up agreement ${agrNumber} in database`);
      const agreements = await db.query(
        'SELECT * FROM agreement_configs WHERE agreement_number = ?',
        [agrNumber]
      );
      
      if (!agreements || agreements.length === 0) {
        logger.error(`Agreement ${agrNumber} not found in database`);
        return null;
      }
      
      const agreement = agreements[0];
      
      if (!agreement.agreement_grant_token) {
        logger.error(`Agreement ${agrNumber} has no token for voucher ${voucherNum}`);
        return null;
      }
      
      logger.info(`Found agreement: ${agreement.name} (${agreement.agreement_number})`);
      logger.info(`Using agreement token: ${agreement.agreement_grant_token.substring(0, 10)}...`);
      logger.info(`Using app secret token: ${config.api.appSecretToken.substring(0, 10)}...`);
      
      // Step 1: Get accounting entry to verify voucher exists
      logger.info(`Step 1: Verifying voucher ${voucherNum} exists in accounting entries`);
      const entries = await db.query(
        'SELECT * FROM accounting_entries WHERE voucher_number = ? AND agreement_number = ? LIMIT 1',
        [voucherNum, agrNumber]
      );
      
      if (!entries || entries.length === 0) {
        logger.error(`No accounting entry found for voucher ${voucherNum} in agreement ${agrNumber}`);
        return null;
      }
      
      const entry = entries[0];
      logger.info(`Found accounting entry: ${entry.entry_number} (${entry.entry_type})`);
      
      // Step 2: Get document number using voucher number from documents API
      logger.info(`Step 2: Getting document number for voucher ${voucherNum}`);
      const documentsApiUrl = `https://apis.e-conomic.com/documentsapi/v2.1.0/AttachedDocuments?filter=voucherNumber$eq:${voucherNum}`;
      
      const documentsResponse = await axios({
        method: 'GET',
        url: documentsApiUrl,
        headers: {
          'X-AppSecretToken': config.api.appSecretToken,
          'X-AgreementGrantToken': agreement.agreement_grant_token,
          'Content-Type': 'application/json'
        },
        validateStatus: function (status) {
          return status < 500; // Accept all status codes below 500
        }
      });
      
      logger.info(`Documents API response status: ${documentsResponse.status}`);
      
      if (documentsResponse.status !== 200) {
        logger.error(`Documents API failed with status ${documentsResponse.status}: ${JSON.stringify(documentsResponse.data)}`);
        return null;
      }
      
      const documentsData = documentsResponse.data;
      
      if (!documentsData.items || documentsData.items.length === 0) {
        logger.error(`No documents found for voucher ${voucherNum}`);
        return null;
      }
      
      const document = documentsData.items[0];
      const documentNumber = document.number;
      
      logger.info(`Found document number: ${documentNumber} for voucher ${voucherNum}`);
      
      // Step 3: Get PDF using document number
      logger.info(`Step 3: Fetching PDF for document ${documentNumber}`);
      const pdfUrl = `https://apis.e-conomic.com/documentsapi/v2.1.0/AttachedDocuments/${documentNumber}/pdf`;
      
      const pdfResponse = await axios({
        method: 'GET',
        url: pdfUrl,
        headers: {
          'X-AppSecretToken': config.api.appSecretToken,
          'X-AgreementGrantToken': agreement.agreement_grant_token,
          'Content-Type': 'application/json'
        },
        responseType: 'stream',
        validateStatus: function (status) {
          return status < 500; // Accept all status codes below 500
        }
      });
      
      logger.info(`PDF API response status: ${pdfResponse.status}`);
      
      if (pdfResponse.status === 200) {
        logger.info(`Successfully fetched PDF for voucher ${voucherNum}`);
        return pdfResponse.data;
      }
      
      logger.error(`Failed to fetch PDF for voucher ${voucherNum}: ${pdfResponse.status}`);
      return null;
      
    } catch (error) {
      logger.error(`Error getting PDF for voucher ${voucherNumber} for agreement ${agreementNumber}:`, error.message);
      logger.error(`Error details: ${error.message}`);
      if (error.response) {
        logger.error(`Response status: ${error.response.status}`);
        logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Helper method to validate entry type for voucher endpoints
   */
  isValidVoucherEntryType(entryType) {
    const voucherTypes = [
      'financeVoucher',
      'supplierInvoice', 
      'supplierPayment',
      'manualDebtorInvoice',
      'reminder'
    ];
    return voucherTypes.includes(entryType);
  }

  /**
   * Get voucher details from accounting entries
   */
  async getVoucherDetails(voucherNumber, agreementNumber) {
    try {
      const entries = await db.query(
        'SELECT * FROM accounting_entries WHERE voucher_number = ? AND agreement_number = ?',
        [voucherNumber, agreementNumber]
      );
      
      return entries;
    } catch (error) {
      logger.error(`Error getting voucher details for ${voucherNumber}:`, error.message);
      throw error;
    }
  }
}

module.exports = new VoucherService(); 