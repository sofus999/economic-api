const logger = require('../core/logger');
const config = require('../../config');
const AgreementModel = require('../agreements/agreement.model');
const InvoiceModel = require('./invoice.model');
const db = require('../../db');
const ApiClient = require('../../api/client');
const endpoints = require('../../api/endpoints');
const axios = require('axios');

class InvoiceService {
  constructor() {
    // Default agreement number from config
    this.defaultAgreementNumber = config.api.agreementNumber;
  }
  
  // Get all active agreements
  async getActiveAgreements() {
    try {
      return await AgreementModel.getAll(true);
    } catch (error) {
      logger.error('Error getting active agreements:', error.message);
      throw error;
    }
  }
  
  // Get client for a specific agreement
  getClientForAgreement(agreementToken) {
    return ApiClient.forAgreement(agreementToken);
  }

  // Transform API invoice data to our database model
  transformInvoiceData(invoice, type, agreementNumber) {
    // Extract customer details
    const customerName = invoice.customer?.name || invoice.recipient?.name || 'Unknown Customer';
    const customerNumber = invoice.customer?.customerNumber || null;
    
    // Base transformed data
    const transformed = {
      customer_number: customerNumber,
      customer_name: customerName,
      agreement_number: agreementNumber,
      currency: invoice.currency,
      exchange_rate: invoice.exchangeRate,
      date: invoice.date,
      due_date: invoice.dueDate,
      net_amount: invoice.netAmount,
      gross_amount: invoice.grossAmount,
      vat_amount: invoice.vatAmount
    };
    
    // Set invoice number based on type
    if (type === 'draft') {
      transformed.draft_invoice_number = invoice.draftInvoiceNumber;
      transformed.payment_status = 'draft'; // Special status for drafts
    } else {
      transformed.invoice_number = invoice.bookedInvoiceNumber;
      
      // Determine payment status for non-draft invoices
      if (type === 'paid' || (invoice.remainder === 0 && invoice.remainder !== undefined)) {
        transformed.payment_status = 'paid';
      } else if (type === 'overdue' || (invoice.remainder > 0 && new Date(invoice.dueDate) < new Date())) {
        transformed.payment_status = 'overdue';
      } else {
        // This covers unpaid and not-due invoices
        transformed.payment_status = 'pending';
      }
    }
    
    // Extract PDF URL exactly as provided by the API
    if (invoice.pdf && invoice.pdf.download) {
      transformed.pdf_url = invoice.pdf.download;
      logger.debug(`Found PDF URL in API response: ${transformed.pdf_url}`);
    }
    
    // Extract notes
    if (invoice.notes) {
      transformed.notes = [invoice.notes.heading, invoice.notes.textLine1, invoice.notes.textLine2]
        .filter(Boolean).join(' - ');
    }
    
    // Extract reference
    if (invoice.references && invoice.references.other) {
      transformed.reference_number = invoice.references.other;
    }
    
    return transformed;
  }

    
  // Transform invoice lines
  transformInvoiceLines(invoice, invoiceNumber, agreementNumber) {
    if (!invoice.lines || !Array.isArray(invoice.lines)) {
      return [];
    }
    
    // Get customer number from the invoice
    const customerNumber = invoice.customer?.customerNumber || null;
    
    return invoice.lines.map((line) => ({
      invoice_id: invoiceNumber,
      agreement_number: agreementNumber,
      customer_number: customerNumber,
      line_number: line.lineNumber,
      product_number: line.product?.productNumber,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unitNetPrice,
      discount_percentage: line.discountPercentage,
      unit: line.unit?.name,
      total_net_amount: line.totalNetAmount
    }));
  }
  // Get detailed invoice by number (including line items)
  async getDetailedInvoice(invoiceNumber, type, client) {
    try {
      let endpoint;
      
      if (type === 'draft') {
        // Use draft endpoint for draft invoices
        endpoint = `${endpoints.INVOICES_DRAFTS}/${invoiceNumber}`;
      } else {
        // For all other types, use booked endpoint
        endpoint = `${endpoints.INVOICES_BOOKED}/${invoiceNumber}`;
      }
      
      const detailedInvoice = await client.get(endpoint);
      logger.debug(`Fetched detailed invoice #${invoiceNumber} from ${type} endpoint`);
      
      return detailedInvoice;
    } catch (error) {
      logger.error(`Error getting detailed invoice #${invoiceNumber} of type ${type}: ${error.message}`);
      return null;
    }
  }
  // Sync invoices for a specific agreement
  async syncAgreementInvoices(agreement, types = ['draft', 'booked', 'paid', 'unpaid', 'overdue', 'not-due']) {
    const startTime = new Date();
    const results = {};
    let totalCount = 0;
    
    try {
      logger.info(`Syncing for agreement ${agreement.agreement_number || agreement.name} started`);
      
      // Create client for this agreement
      const client = this.getClientForAgreement(agreement.agreement_grant_token);
      
      // Get the agreement number directly from the API to confirm
      let agreementInfo;
      try {
        agreementInfo = await client.getAgreementInfo();
      } catch (error) {
        logger.error(`Error getting agreement info from API: ${error.message}`);
        throw new Error(`Failed to verify agreement from API: ${error.message}`);
      }
      
      const agreementNumber = agreementInfo.agreementNumber;
      const companyName = agreementInfo.companyName || agreement.name;
      
      let needsUpdate = false;
      let updateData = {};

      // Log the agreement number to confirm it's available
      logger.debug(`Agreement number from API: ${agreementNumber}`);    

      // Check if agreement number needs update
      if (!agreement.agreement_number || agreement.agreement_number !== agreementNumber) {
        logger.warn(`Agreement number mismatch: stored=${agreement.agreement_number || 'null'}, API=${agreementNumber}`);
        needsUpdate = true;
        updateData.agreement_number = agreementNumber;
      }
      
      // Check if company name needs update
      if (companyName && companyName !== 'Unknown' && companyName !== agreement.name) {
        logger.warn(`Agreement name mismatch: stored=${agreement.name}, API=${companyName}`);
        needsUpdate = true;
        updateData.name = companyName;
      }
      
      // Update the agreement if needed
      if (needsUpdate) {
        try {
          await AgreementModel.update(agreement.id, updateData);
          
          // Update local object with new values
          if (updateData.agreement_number) {
            agreement.agreement_number = updateData.agreement_number;
          }
          if (updateData.name) {
            agreement.name = updateData.name;
          }
          
          logger.info(`Updated agreement data for ${agreement.id}: ${JSON.stringify(updateData)}`);
        } catch (updateError) {
          logger.error(`Error updating agreement: ${updateError.message}`);
          // Continue with sync even if update fails
        }
      }
      
      // Process invoice types with controlled concurrency - atomic upsert makes this safer
      const invTypePromises = types.map(async (type) => {
        try {
          let endpoint;
          switch (type) {
            case 'draft': endpoint = endpoints.INVOICES_DRAFTS; break;
            case 'booked': endpoint = endpoints.INVOICES_BOOKED; break;
            case 'paid': endpoint = endpoints.INVOICES_PAID; break;
            case 'unpaid': endpoint = endpoints.INVOICES_UNPAID; break;
            case 'overdue': endpoint = endpoints.INVOICES_OVERDUE; break;
            case 'not-due': endpoint = endpoints.INVOICES_NOT_DUE; break;
            default: return null; // Skip unknown types
          }
          
          // Fetch invoices of this type with pagination
          let invoices = [];
          try {
            invoices = await client.getPaginated(endpoint);
            logger.info(`Found ${invoices.length} ${type} invoices for agreement ${agreementNumber}`);
          } catch (fetchError) {
            logger.error(`Error fetching ${type} invoices: ${fetchError.message}`);
            return {
              type,
              status: 'error',
              error: fetchError.message,
              count: 0
            };
          }
          
          // Optimized batch size for better throughput
          const batchSize = 200; // Increased from 100 to 200
          let recordCount = 0;
          
          // Process invoices in batches to avoid memory issues
          for (let i = 0; i < invoices.length; i += batchSize) {
            const batch = invoices.slice(i, i + batchSize);
            logger.info(`Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(invoices.length/batchSize)} for ${type} invoices`);
            
            // Process invoices with controlled concurrency - balance between speed and stability
            const chunkSize = 20; // Increased from 5 to 20 for better throughput
            for (let j = 0; j < batch.length; j += chunkSize) {
              const chunk = batch.slice(j, j + chunkSize);
              
                              // Process chunk with limited concurrency (atomic upsert makes this safer)
                const concurrencyLimit = 5; // Process 5 invoices concurrently
                const invoicePromises = [];
                
                for (let k = 0; k < chunk.length; k += concurrencyLimit) {
                  const subChunk = chunk.slice(k, k + concurrencyLimit);
                  
                  const batchPromise = Promise.all(subChunk.map(async (invoice) => {
                  try {
                    // Transform API data to our model
                    const invoiceData = this.transformInvoiceData(invoice, type, agreementNumber);

                    // Verify we have agreement number before the smartUpsert call
                    logger.debug(`Processing invoice ${invoiceData.invoice_number || invoiceData.draft_invoice_number}, agreement: ${agreementNumber}`);
                  
                    // Smart upsert the invoice with explicit agreement number parameter
                    await InvoiceModel.smartUpsert(invoiceData, agreementNumber);
                    
                    // Get the correct invoice number based on type
                    const invoiceNumber = type === 'draft' ? invoice.draftInvoiceNumber : (invoice.bookedInvoiceNumber || invoice.draftInvoiceNumber);
                    
                    // Get detailed invoice to access line items - with error handling
                    try {
                      const detailedInvoice = await this.getDetailedInvoice(invoiceNumber, type, client);
                      
                      // Process invoice lines if available
                      if (detailedInvoice && (detailedInvoice.lines || [])) {
                        const lines = this.transformInvoiceLines(detailedInvoice, invoiceNumber, agreementNumber);
                        await InvoiceModel.saveInvoiceLines(invoiceNumber, agreementNumber, invoiceData.customer_number, lines);
                        logger.debug(`Saved ${lines.length} lines for invoice #${invoiceNumber}`);
                      } else {
                        logger.debug(`No line items available for invoice #${invoiceNumber}`);
                      }
                    } catch (detailError) {
                      logger.warn(`Error getting detail for invoice #${invoiceNumber}: ${detailError.message}`);
                      // Continue processing other invoices
                    }
                    
                    return 1; // Success count
                  } catch (invoiceError) {
                    logger.error(`Error processing invoice: ${invoiceError.message}`);
                    // Continue with next invoice
                    return 0; // Failed count
                  }
                }));
                
                invoicePromises.push(batchPromise);
              }
              
              // Wait for all sub-chunks to complete
              const results = await Promise.all(invoicePromises);
              recordCount += results.flat().reduce((sum, count) => sum + count, 0);
            }
            
            // Minimal delay between batches for better throughput
            await new Promise(resolve => setTimeout(resolve, 10)); // Reduced from 100ms to 10ms
          }
          
          // Record successful sync
          try {
            await InvoiceModel.recordSyncLog(
              `invoices_${type}`,
              'sync',
              'success',
              recordCount,
              null,
              startTime
            );
          } catch (logError) {
            logger.error(`Error recording sync log: ${logError.message}`);
          }
          
          return {
            type,
            status: 'success',
            count: recordCount
          };
          
        } catch (typeError) {
          logger.error(`Error syncing ${type} invoices for agreement ${agreementNumber}:`, typeError.message);
          
          // Record failed sync
          try {
            await InvoiceModel.recordSyncLog(
              `invoices_${type}`,
              'sync',
              'error',
              0,
              typeError.message,
              startTime
            );
          } catch (logError) {
            logger.error(`Error recording sync log: ${logError.message}`);
          }
          
          return {
            type,
            status: 'error',
            error: typeError.message,
            count: 0
          };
        }
      });
      
      // Wait for all invoice type syncs to complete
      const typeResults = await Promise.all(invTypePromises);
      
      // Process results
      typeResults.forEach(result => {
        if (result) {
          results[result.type] = {
            status: result.status,
            count: result.count
          };
          
          if (result.error) {
            results[result.type].error = result.error;
          }
          
          totalCount += result.count;
        }
      });
      
      // Count errors for the completion message
      const errorCount = Object.values(results).filter(r => r.status === 'error').length;
      logger.info(`Syncing for agreement ${agreementNumber} finished. ${errorCount > 0 ? errorCount + ' errors' : '0 errors'}`);
      
      return {
        agreement: {
          id: agreement.id,
          name: agreement.name,
          agreement_number: agreementNumber
        },
        results,
        totalCount,
        status: totalCount > 0 ? 'success' : 'warning'
      };
      
    } catch (error) {
      logger.error(`Error syncing invoices for agreement ${agreement.id}: ${error.message}`);
      
      // Record failed sync
      try {
        await InvoiceModel.recordSyncLog(
          'invoices_agreement',
          'sync',
          'error',
          0,
          error.message,
          startTime
        );
      } catch (logError) {
        logger.error(`Error recording sync log: ${logError.message}`);
      }
      
      return {
        agreement: {
          id: agreement.id,
          name: agreement.name,
          agreement_number: agreement.agreement_number
        },
        status: 'error',
        error: error.message,
        results,
        totalCount
      };
    }
  }
  
  // Sync all invoices across all agreements
  async syncAllInvoices() {
    const startTime = new Date();
    const agreementResults = [];
    let totalCount = 0;
    let hasErrors = false;
    
    try {
      logger.info('Starting sync of all invoices across all agreements');
      
      // Get all active agreements
      let agreements;
      try {
        agreements = await this.getActiveAgreements();
      } catch (agreementError) {
        logger.error(`Error fetching active agreements: ${agreementError.message}`);
        return {
          status: 'error',
          message: `Failed to fetch agreements: ${agreementError.message}`,
          results: [],
          totalCount: 0
        };
      }
      
      if (!agreements || agreements.length === 0) {
        logger.warn('No active agreements found for sync');
        return {
          status: 'warning',
          message: 'No active agreements found',
          results: [],
          totalCount: 0
        };
      }
      
      // Process each agreement
      for (const agreement of agreements) {
        try {
          logger.info(`Processing agreement: ${agreement.name} (${agreement.agreement_number || 'Unknown'})`);
          const result = await this.syncAgreementInvoices(agreement);
          agreementResults.push(result);
          totalCount += result.totalCount || 0;
          
          if (result.status === 'error') {
            hasErrors = true;
          }
          
          // Add a small delay between agreements to let the event loop breathe
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          hasErrors = true;
          logger.error(`Error syncing agreement ${agreement.name}:`, error.message);
          agreementResults.push({
            agreement: {
              id: agreement.id,
              name: agreement.name,
              agreement_number: agreement.agreement_number
            },
            status: 'error',
            error: error.message
          });
          
          // Continue with next agreement even if this one fails
        }
      }
      
      // Record overall sync result
      try {
        await InvoiceModel.recordSyncLog(
          'invoices_all_agreements',
          'sync',
          hasErrors ? 'partial' : 'success',
          totalCount,
          hasErrors ? 'Some agreements had errors' : null,
          startTime
        );
      } catch (logError) {
        logger.error(`Error recording sync log: ${logError.message}`);
      }
      
      logger.info(`Completed sync across all agreements: ${totalCount} invoices processed. Status: ${hasErrors ? 'with errors' : 'success'}`);
      
      return {
        status: hasErrors ? 'partial' : 'success',
        results: agreementResults,
        totalCount
      };
      
    } catch (error) {
      logger.error('Error in overall sync process:', error.message);
      
      // Record failed sync
      try {
        await InvoiceModel.recordSyncLog(
          'invoices_all_agreements',
          'sync',
          'error',
          totalCount,
          error.message,
          startTime
        );
      } catch (logError) {
        logger.error(`Error recording sync log: ${logError.message}`);
      }
      
      return {
        status: 'error',
        message: error.message,
        results: agreementResults,
        totalCount
      };
    }
  }
  
  // Sync invoices for a specific agreement by ID
  async syncInvoicesByAgreementId(agreementId) {
    try {
      const agreement = await AgreementModel.getById(agreementId);
      return await this.syncAgreementInvoices(agreement);
    } catch (error) {
      logger.error(`Error syncing invoices for agreement ID ${agreementId}:`, error.message);
      throw error;
    }
  }
  
  // Clean up duplicate invoices based on invoice_number
  async cleanupDuplicateInvoices() {
    const startTime = new Date();
    let cleanedCount = 0;
    
    try {
      logger.info('Starting cleanup of duplicate invoices');
      
      // Get all active agreements
      const agreements = await this.getActiveAgreements();
      
      // For each agreement
      for (const agreement of agreements) {
        // Get all distinct invoice numbers for this agreement
        const invoiceNumbers = await db.query(
          'SELECT DISTINCT invoice_number FROM invoices WHERE agreement_number = ? AND invoice_number IS NOT NULL',
          [agreement.agreement_number]
        );
        
        // Process each invoice number within this agreement
        for (const row of invoiceNumbers) {
          const invoiceNumber = row.invoice_number;
          
          // Find all invoices with this number in this agreement
          const invoices = await db.query(
            'SELECT * FROM invoices WHERE invoice_number = ? AND agreement_number = ? ORDER BY updated_at DESC',
            [invoiceNumber, agreement.agreement_number]
          );
          
          // Skip if there's only one or none
          if (invoices.length <= 1) continue;
          
          // Keep the most recently updated one
          const mostRecent = invoices[0];
          const duplicates = invoices.slice(1);
          
          // Delete the duplicates
          for (const dup of duplicates) {
            await db.query('DELETE FROM invoices WHERE id = ?', [dup.id]);
            cleanedCount++;
          }
        }
      }
      
      logger.info(`Cleanup complete. Removed ${cleanedCount} duplicate invoices`);
      
      // Record cleanup
      await InvoiceModel.recordSyncLog(
        'invoices_cleanup',
        'cleanup',
        'success',
        cleanedCount,
        null,
        startTime
      );
      
      return {
        status: 'success',
        count: cleanedCount
      };
    } catch (error) {
      logger.error('Error cleaning up duplicate invoices:', error.message);
      
      // Record failed cleanup
      await InvoiceModel.recordSyncLog(
        'invoices_cleanup',
        'cleanup',
        'error',
        cleanedCount,
        error.message,
        startTime
      );
      
      throw error;
    }
  }

  // Get invoice by ID and agreement number
  async getInvoiceById(invoiceNumber, agreementNumber) {
    try {
      // Ensure the numbers are treated as integers
      const invNumber = parseInt(invoiceNumber, 10);
      const agrNumber = parseInt(agreementNumber, 10);
      
      logger.info(`Looking for invoice with invoice_number=${invNumber} and agreement_number=${agrNumber}`);
      
      // Query with both the invoice number and agreement number
      const result = await db.query(
        'SELECT * FROM invoices WHERE invoice_number = ? AND agreement_number = ?',
        [invNumber, agrNumber]
      );
      
      // Log the raw result for debugging
      logger.info(`Raw DB result type: ${typeof result}`);
      logger.info(`Raw DB result is array: ${Array.isArray(result)}`);
      if (result) {
        logger.info(`Result has ${Array.isArray(result) ? result.length : 'unknown'} items`);
        logger.info(`First element type: ${result[0] ? typeof result[0] : 'N/A'}`);
        logger.info(`First element is array: ${result[0] ? Array.isArray(result[0]) : false}`);
      }
      
      // Safely handle the results - check if it's an array and has items
      const rows = Array.isArray(result) ? result : 
                  (result && Array.isArray(result[0]) ? result[0] : []);
      
      logger.info(`Processed rows length: ${rows.length}`);
      
      // Log the result for debugging
      if (rows.length === 0) {
        logger.error(`No invoice found with invoice_number=${invNumber} and agreement_number=${agrNumber}`);
        return null;
      } else {
        const invoice = rows[0];
        logger.info(`Found invoice: ${invoice.invoice_number} for agreement ${invoice.agreement_number}`);
        logger.info(`PDF URL: ${invoice.pdf_url || 'Not set'}`);
        return invoice;
      }
    } catch (error) {
      logger.error(`Error getting invoice ${invoiceNumber} for agreement ${agreementNumber}:`, error.message);
      throw error;
    }
  }
  
  // Get all invoices
  async getAllInvoices() {
    try {
      // You may want to add pagination or other filters here
      return await InvoiceModel.getAll();
    } catch (error) {
      logger.error('Error getting all invoices:', error.message);
      throw error;
    }
  }
  
  // Get PDF for invoice with proper authentication
  async getInvoicePdf(invoiceNumber, agreementNumber) {
    try {
      // Ensure the numbers are treated as integers
      const invNumber = parseInt(invoiceNumber, 10);
      const agrNumber = parseInt(agreementNumber, 10);
      
      logger.info(`Fetching PDF for invoice=${invNumber} agreement=${agrNumber}`);
      
      // First, query the database directly to get the invoice with pdf_url
      const invoices = await db.query(
        'SELECT * FROM invoices WHERE invoice_number = ? AND agreement_number = ?',
        [invNumber, agrNumber]
      );
      
      if (!invoices || invoices.length === 0) {
        logger.error(`No invoice ${invNumber} not found for agreement ${agrNumber}`);
        return null;
      }
      
      const invoice = invoices[0];
      
      // Get agreement details for authentication - Use direct query to ensure we get the record
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
        logger.error(`Agreement ${agrNumber} has no token for invoice ${invNumber}`);
        return null;
      }
      
      logger.info(`Found agreement: ${agreement.name} (${agreement.agreement_number})`);
      logger.info(`Using agreement token: ${agreement.agreement_grant_token.substring(0, 10)}...`);
      logger.info(`Using app secret token: ${config.api.appSecretToken.substring(0, 10)}...`);
      
      // Define possible endpoints for fallback
      const possibleStates = [
        'booked',  // Try booked first (most common)
        'paid',    // Then paid
        'drafts',  // Then drafts
        'unpaid',  // Then unpaid
        'overdue', // Then overdue
        'not-due'  // Then not-due
      ];
      
      // First try: Use the stored PDF URL if available
      if (invoice.pdf_url) {
        logger.info(`Using stored PDF URL: ${invoice.pdf_url}`);
        const pdfResponse = await this.tryFetchPdf(
          invoice.pdf_url, 
          agreement.agreement_grant_token, 
          config.api.appSecretToken
        );
        
        if (pdfResponse) {
          logger.info(`Successfully fetched PDF using stored URL for invoice #${invNumber}`);
          return pdfResponse.stream;
        } else {
          logger.warn(`Stored PDF URL failed for invoice #${invNumber}, will try API lookup`);
        }
      } else {
        logger.warn(`No PDF URL found for invoice ${invNumber}, will try API lookup`);
      }
      
      // Second try: Fetch the invoice details from the API to get the current correct PDF URL
      const client = this.getClientForAgreement(agreement.agreement_grant_token);
      
      // Try each possible endpoint to get the invoice details
      for (const state of possibleStates) {
        try {
          logger.info(`Looking up invoice details from ${state} endpoint for #${invNumber}`);
          const endpoint = `${endpoints.INVOICES_BASE}/${state}/${invNumber}`;
          const invoiceDetails = await client.get(endpoint);
          
          // If we found the invoice details and it has a PDF download link
          if (invoiceDetails && invoiceDetails.pdf && invoiceDetails.pdf.download) {
            const correctPdfUrl = invoiceDetails.pdf.download;
            logger.info(`Found correct PDF URL from API: ${correctPdfUrl}`);
            
            // Update the PDF URL in the database
            await db.query(
              'UPDATE invoices SET pdf_url = ? WHERE invoice_number = ? AND agreement_number = ?',
              [correctPdfUrl, invNumber, agrNumber]
            );
            
            // Fetch the PDF using the correct URL
            const pdfResponse = await this.tryFetchPdf(
              correctPdfUrl, 
              agreement.agreement_grant_token, 
              config.api.appSecretToken
            );
            
            if (pdfResponse) {
              logger.info(`Successfully fetched PDF from correct URL for invoice #${invNumber}`);
              return pdfResponse.stream;
            }
          }
        } catch (error) {
          logger.debug(`No invoice found at ${state} endpoint: ${error.message}`);
          // Continue to next state, no need to fail here
        }
      }
      
      // Last resort: Try direct PDF URLs if API lookup failed
      logger.warn(`API lookup failed for invoice #${invNumber}, trying direct PDF endpoints`);
      
      for (const state of possibleStates) {
        const pdfUrl = `https://restapi.e-conomic.com/invoices/${state}/${invNumber}/pdf`;
        logger.info(`Trying direct PDF endpoint: ${pdfUrl}`);
        
        const pdfResponse = await this.tryFetchPdf(
          pdfUrl, 
          agreement.agreement_grant_token, 
          config.api.appSecretToken
        );
        
        if (pdfResponse) {
          // Update the invoice with the working URL
          await db.query(
            'UPDATE invoices SET pdf_url = ? WHERE invoice_number = ? AND agreement_number = ?',
            [pdfResponse.url, invNumber, agrNumber]
          );
          logger.info(`Found PDF at fallback URL for invoice #${invNumber}: ${pdfResponse.url}`);
          return pdfResponse.stream;
        }
      }
      
      logger.error(`PDF not found for invoice #${invNumber} in any endpoint`);
      return null;
    } catch (error) {
      logger.error(`Error getting PDF for invoice ${invoiceNumber} for agreement ${agreementNumber}:`, error.message);
      logger.error(`Error details: ${error.message}`);
      if (error.response) {
        logger.error(`Response status: ${error.response.status}`);
      }
      throw error;
    }
  }

  // Helper method to try fetching a PDF from a given URL
  async tryFetchPdf(pdfUrl, agreementToken, appSecretToken) {
    try {
      logger.info(`Attempting to fetch PDF from ${pdfUrl}`);
      
      // Use axios to fetch the PDF
      const response = await axios({
        method: 'GET',
        url: pdfUrl,
        headers: {
          'X-AppSecretToken': appSecretToken,
          'X-AgreementGrantToken': agreementToken,
          'Content-Type': 'application/json'
        },
        responseType: 'stream',
        validateStatus: function (status) {
          return true; // Accept all status codes for better handling
        }
      });
      
      logger.info(`API response status: ${response.status} for ${pdfUrl}`);
      
      // If we got a successful response
      if (response.status === 200) {
        logger.info(`Successfully fetched PDF from ${pdfUrl}`);
        return { 
          stream: response.data,
          url: pdfUrl
        };
      }
      
      // If we didn't get a 200, log the error
      if (response.headers['content-type'] && !response.headers['content-type'].includes('application/pdf')) {
        let errorData = '';
        response.data.on('data', chunk => {
          errorData += chunk.toString();
        });
        
        // Wait for the data to be collected
        await new Promise(resolve => {
          response.data.on('end', resolve);
        });
        
        logger.error(`Error response for ${pdfUrl}: ${errorData}`);
      }
      
      return null;
    } catch (error) {
      logger.error(`Error trying to fetch PDF from ${pdfUrl}:`, error.message);
      return null;
    }
  }
}

module.exports = new InvoiceService();