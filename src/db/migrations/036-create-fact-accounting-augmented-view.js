const db = require('../index');
const logger = require('../../modules/core/logger');

async function up() {
  logger.info('Running migration: 036-create-fact-accounting-augmented-view');
  
  try {
    // Create the fact_accounting_augmented view that handles both invoices and vouchers
    await db.query(`
      CREATE OR REPLACE VIEW fact_accounting_augmented AS
      SELECT
        ae.entry_number,
        YEAR(ae.entry_date) * 10000 + MONTH(ae.entry_date) * 100 + DAY(ae.entry_date) AS entry_date_id,
        ae.entry_date,
        ae.account_number,
        ae.agreement_number,
        CONCAT(ae.account_number, '_', ae.agreement_number) AS AccountKey,
        ae.amount,
        ae.amount_in_base_currency,
        ae.currency,
        ae.entry_type,
        ae.voucher_number,
        -- For customer invoices, use invoice data and existing invoice PDF URL
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN inv.date
          ELSE NULL
        END AS invoice_date,
        -- For invoices, use invoice notes; for vouchers, use entry text
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN COALESCE(inv.notes, 'NULL')
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') THEN COALESCE(ae.entry_text, 'NULL')
          ELSE 'NULL'
        END AS invoice_notes,
        -- Create appropriate PDF URLs based on entry type
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN 
            CONCAT('http://localhost:3000/api/invoices/', ae.agreement_number, '/', ae.voucher_number, '/pdf')
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') THEN 
            CONCAT('http://localhost:3000/api/vouchers/', ae.agreement_number, '/', ae.voucher_number, '/pdf')
          ELSE NULL
        END AS pdf_url,
        -- Create InvoiceKey for compatibility
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN CONCAT(ae.voucher_number, '_', ae.agreement_number)
          ELSE CONCAT('voucher_', ae.voucher_number, '_', ae.agreement_number)
        END AS InvoiceKey
      FROM fact_accounting_entries AS ae
      LEFT JOIN invoices AS inv
        ON ae.entry_type = 'customerInvoice'
       AND ae.voucher_number = inv.invoice_number
       AND ae.agreement_number = inv.agreement_number
      WHERE ae.voucher_number IS NOT NULL
    `);
    
    logger.info('Migration 036-create-fact-accounting-augmented-view completed successfully');
  } catch (error) {
    logger.error('Error running migration 036-create-fact-accounting-augmented-view:', error.message);
    throw error;
  }
}

async function down() {
  logger.info('Reverting migration: 036-create-fact-accounting-augmented-view');
  
  try {
    await db.query('DROP VIEW IF EXISTS fact_accounting_augmented');
    
    logger.info('Migration 036-create-fact-accounting-augmented-view reverted successfully');
  } catch (error) {
    logger.error('Error reverting migration 036-create-fact-accounting-augmented-view:', error.message);
    throw error;
  }
}

module.exports = { up, down }; 