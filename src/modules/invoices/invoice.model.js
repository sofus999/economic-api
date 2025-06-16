const db = require('../../db');
const logger = require('../core/logger');
const { ApiError } = require('../core/error.handler');
const { v4: uuidv4 } = require('uuid'); 

class InvoiceModel {
  // Smart upsert - uses invoice_number AND agreement_number to determine if record exists
static async smartUpsert(invoiceData, agreementNumber) {
  try {
    // Add agreement_number to the data
    invoiceData.agreement_number = agreementNumber;
    
    // For draft invoices, use the draft number as the invoice_number for the primary key
    if (invoiceData.payment_status === 'draft' || !invoiceData.invoice_number) {
      invoiceData.invoice_number = invoiceData.draft_invoice_number;
    } 
    // For booked invoices, check if there's a draft that needs to be deleted
    else if (invoiceData.invoice_number && invoiceData.payment_status !== 'draft') {
      // Check if there's a corresponding draft that should be deleted
      const draftInvoice = await this.findDraftForBookedInvoice(invoiceData.invoice_number, agreementNumber);
      if (draftInvoice) {
        // Delete the draft since it's now booked
        await this.deleteDraftInvoice(invoiceData.invoice_number, agreementNumber, invoiceData.customer_number);
        logger.info(`Deleted draft for invoice #${invoiceData.invoice_number} that is now ${invoiceData.payment_status}`);
      }
    }
    
    // Safety check for required fields
    if (!invoiceData.invoice_number) {
      logger.error('Missing invoice_number in smartUpsert');
      throw new Error('Missing invoice_number in invoice data');
    }
    
    if (!invoiceData.customer_number) {
      logger.error('Missing customer_number in smartUpsert');
      throw new Error('Missing customer_number in invoice data');
    }
    
    if (!agreementNumber) {
      logger.error('Missing agreementNumber in smartUpsert');
      throw new Error('Missing agreement_number parameter');
    }
    
    // Use atomic INSERT ... ON DUPLICATE KEY UPDATE to prevent race conditions
    await db.query(
      `INSERT INTO invoices (
        invoice_number, draft_invoice_number, customer_number, agreement_number,
        currency, exchange_rate, date, due_date,
        net_amount, gross_amount, vat_amount,
        payment_status, customer_name,
        reference_number, notes, pdf_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        draft_invoice_number = VALUES(draft_invoice_number),
        currency = VALUES(currency),
        exchange_rate = VALUES(exchange_rate),
        date = VALUES(date),
        due_date = VALUES(due_date),
        net_amount = VALUES(net_amount),
        gross_amount = VALUES(gross_amount),
        vat_amount = VALUES(vat_amount),
        payment_status = VALUES(payment_status),
        customer_name = VALUES(customer_name),
        reference_number = VALUES(reference_number),
        notes = VALUES(notes),
        pdf_url = VALUES(pdf_url),
        updated_at = CURRENT_TIMESTAMP`,
      [
        invoiceData.invoice_number,
        invoiceData.draft_invoice_number || null,
        invoiceData.customer_number,
        invoiceData.agreement_number,
        invoiceData.currency,
        invoiceData.exchange_rate || null,
        invoiceData.date,
        invoiceData.due_date || null,
        invoiceData.net_amount || 0,
        invoiceData.gross_amount || 0,
        invoiceData.vat_amount || 0,
        invoiceData.payment_status || 'pending',
        invoiceData.customer_name,
        invoiceData.reference_number || null,
        invoiceData.notes || null,
        invoiceData.pdf_url || null
      ]
    );
    
    return invoiceData;
  } catch (error) {
    logger.error(`Error upserting invoice:`, error.message);
    throw error;
  }
}
  
  // Create a new invoice in the database
  static async create(invoiceData) {
    try {
      // Generate a unique ID for the new invoice
      const id = uuidv4();
      
      // Insert invoice record
      await db.query(
        `INSERT INTO invoices (
          id, invoice_number, draft_invoice_number, customer_number, agreement_number,
          currency, exchange_rate, date, due_date, 
          net_amount, gross_amount, vat_amount, 
          payment_status, customer_name, 
          reference_number, notes, pdf_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          invoiceData.invoice_number || null,
          invoiceData.draft_invoice_number || null,
          invoiceData.customer_number,
          invoiceData.agreement_number || null,
          invoiceData.currency,
          invoiceData.exchange_rate || null,
          invoiceData.date,
          invoiceData.due_date || null,
          invoiceData.net_amount || 0,
          invoiceData.gross_amount || 0,
          invoiceData.vat_amount || 0,
          invoiceData.payment_status || 'pending',
          invoiceData.customer_name,
          invoiceData.reference_number || null,
          invoiceData.notes || null,
          invoiceData.pdf_url || null
        ]
      );
      
      return { id, ...invoiceData };
    } catch (error) {
      logger.error('Error creating invoice:', error.message);
      throw error;
    }
  }
  
  // Update existing invoice
  static async update(id, invoiceData) {
    try {
      await db.query(
        `UPDATE invoices SET
          invoice_number = ?,
          draft_invoice_number = ?,
          customer_number = ?,
          agreement_number = ?,
          currency = ?,
          exchange_rate = ?,
          date = ?,
          due_date = ?,
          net_amount = ?,
          gross_amount = ?,
          vat_amount = ?,
          payment_status = ?,
          customer_name = ?,
          reference_number = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
          invoiceData.invoice_number || null,
          invoiceData.draft_invoice_number || null,
          invoiceData.customer_number,
          invoiceData.agreement_number || null,
          invoiceData.currency,
          invoiceData.exchange_rate || null,
          invoiceData.date,
          invoiceData.due_date || null,
          invoiceData.net_amount || 0,
          invoiceData.gross_amount || 0,
          invoiceData.vat_amount || 0,
          invoiceData.payment_status || 'pending',
          invoiceData.customer_name,
          invoiceData.reference_number || null,
          invoiceData.notes || null,
          id
        ]
      );
      
      return { id, ...invoiceData };
    } catch (error) {
      logger.error(`Error updating invoice ${id}:`, error.message);
      throw error;
    }
  }

  // Find by invoice number, customer number, and agreement number
  static async findByInvoiceAndAgreementNumber(invoiceNumber, customerNumber, agreementNumber) {
    try {
      // Safety check for parameters
      if (!invoiceNumber || !customerNumber || !agreementNumber) {
        logger.error(`Missing parameters in findByInvoiceAndAgreementNumber: invoiceNumber=${invoiceNumber}, customerNumber=${customerNumber}, agreementNumber=${agreementNumber}`);
        return null;
      }
      
      const invoices = await db.query(
        'SELECT * FROM invoices WHERE (invoice_number = ? OR draft_invoice_number = ?) AND customer_number = ? AND agreement_number = ?',
        [invoiceNumber, invoiceNumber, customerNumber, agreementNumber]
      );
      
      return invoices.length > 0 ? invoices[0] : null;
    } catch (error) {
      logger.error(`Error finding invoice by number ${invoiceNumber}, customer ${customerNumber}, and agreement ${agreementNumber}:`, error.message);
      throw error;
    }
  }

  // Helper method to determine if status should be updated
  static shouldUpdateStatus(currentStatus, newStatus) {
    // Status precedence: overdue > paid > pending
    const statusPriority = {
      'overdue': 3,
      'paid': 2,
      'partial': 1,
      'pending': 0
    };
    
    // Higher number = higher priority
    return (statusPriority[newStatus] || 0) >= (statusPriority[currentStatus] || 0);
  }
  
  // Save invoice lines for an invoice
  static async saveInvoiceLines(invoiceNumber, agreementNumber, customerNumber, lines) {
    try {
      if (!lines || !Array.isArray(lines) || lines.length === 0) {
        return [];
      }
      
      // Use a transaction to ensure all lines are saved consistently
      await db.transaction(async (connection) => {
        // Delete existing lines for this invoice
        await connection.query(
          'DELETE FROM invoice_lines WHERE invoice_id = ? AND agreement_number = ? AND customer_number = ?',
          [invoiceNumber, agreementNumber, customerNumber]
        );
        
        // Batch insert new lines for better performance
        if (lines.length > 0) {
          const values = lines.map(line => [
            invoiceNumber,
            agreementNumber,
            customerNumber,
            line.line_number,
            line.product_number || null,
            line.description,
            line.quantity || 1,
            line.unit_price || 0,
            line.discount_percentage || 0,
            line.unit || null,
            line.total_net_amount || 0
          ]);
          
          // Use batch insert for better performance
          const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
          const flatValues = values.flat();
          
          await connection.query(
            `INSERT INTO invoice_lines (
              invoice_id, agreement_number, customer_number, line_number,
              product_number, description, quantity, unit_price, 
              discount_percentage, unit, total_net_amount
            ) VALUES ${placeholders}`,
            flatValues
          );
        }
      });
      
      return lines;
    } catch (error) {
      logger.error(`Error saving invoice lines for invoice ${invoiceNumber}:`, error.message);
      throw error;
    }
  }
  
  // Get invoice lines for an invoice
  static async getInvoiceLines(invoiceId) {
    try {
      const lines = await db.query(
        'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number',
        [invoiceId]
      );
      
      return lines;
    } catch (error) {
      logger.error(`Error getting invoice lines for invoice ${invoiceId}:`, error.message);
      throw error;
    }
  }
  
  // Find invoice by invoice number
  static async findById(id) {
    try {
      const [rows] = await db.query('SELECT * FROM invoices WHERE invoice_number = ?', [id]);
      return rows[0] || null;
    } catch (error) {
      logger.error(`Error finding invoice by invoice number ${id}:`, error.message);
      throw error;
    }
  }
  
  // Get all invoices (with basic pagination)
  static async getAll(limit = 1000, offset = 0) {
    try {
      const [rows] = await db.query(
        'SELECT * FROM invoices ORDER BY date DESC LIMIT ? OFFSET ?',
        [limit, offset]
      );
      return rows;
    } catch (error) {
      logger.error('Error getting all invoices:', error.message);
      throw error;
    }
  }
  
  // Record sync log
  static async recordSyncLog(entityType, operation, status, recordCount = 0, errorMessage = null, startTime = null) {
    try {
      const started = startTime || new Date();
      const completed = new Date();
      const durationMs = completed.getTime() - started.getTime();
      
      await db.query(
        `INSERT INTO sync_logs (
          entity, operation, record_count, status, 
          error_message, started_at, completed_at, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entityType,
          operation,
          recordCount,
          status,
          errorMessage,
          started,
          completed,
          durationMs
        ]
      );
      
      return {
        entity: entityType,
        operation,
        status,
        recordCount,
        durationMs
      };
    } catch (error) {
      logger.error('Error recording sync log:', error.message);
      // Don't throw error for logging failures
      return null;
    }
  }

  // Add this method after smartUpsert
  static async deleteDraftInvoice(draftInvoiceNumber, agreementNumber, customerNumber) {
    try {
      if (!draftInvoiceNumber || !agreementNumber) {
        logger.warn('Missing required parameters for deleteDraftInvoice');
        return false;
      }
      
      // Log the deletion attempt
      logger.info(`Attempting to delete draft invoice #${draftInvoiceNumber} for agreement ${agreementNumber}`);
      
      // Delete the draft invoice
      const result = await db.query(
        `DELETE FROM invoices 
         WHERE draft_invoice_number = ? 
         AND agreement_number = ? 
         AND payment_status = 'draft'
         ${customerNumber ? 'AND customer_number = ?' : ''}`,
        customerNumber ? [draftInvoiceNumber, agreementNumber, customerNumber] : [draftInvoiceNumber, agreementNumber]
      );
      
      if (result && result.affectedRows > 0) {
        logger.info(`Successfully deleted draft invoice #${draftInvoiceNumber} for agreement ${agreementNumber}`);
        return true;
      } else {
        logger.debug(`No draft invoice found to delete with number #${draftInvoiceNumber} for agreement ${agreementNumber}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error deleting draft invoice #${draftInvoiceNumber}:`, error.message);
      return false;
    }
  }

  // Add this method to check if a draft exists for a booked invoice
  static async findDraftForBookedInvoice(invoiceNumber, agreementNumber) {
    try {
      const [rows] = await db.query(
        `SELECT * FROM invoices 
         WHERE draft_invoice_number = ? 
         AND agreement_number = ? 
         AND payment_status = 'draft'`,
        [invoiceNumber, agreementNumber]
      );
      
      return rows && rows.length > 0 ? rows[0] : null;
    } catch (error) {
      logger.error(`Error finding draft for booked invoice #${invoiceNumber}:`, error.message);
      return null;
    }
  }

  // Helper method to determine the endpoint for a given payment status
  static getEndpointForState(paymentStatus, dueDate = null) {
    switch (paymentStatus) {
      case 'draft': return 'drafts';
      case 'paid': return 'paid';
      case 'overdue': return 'overdue';
      case 'pending': 
        // For pending, we determine if it's unpaid or not-due based on due date if available
        if (dueDate) {
          const now = new Date();
          if (new Date(dueDate) < now) {
            return 'unpaid';
          } else {
            return 'not-due';
          }
        }
        // Without due date information, default to booked
        return 'booked';
      default: return 'booked'; // Default to booked for unknown statuses
    }
  }
}

module.exports = InvoiceModel;