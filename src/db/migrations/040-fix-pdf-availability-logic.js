const db = require('../index');
const logger = require('../../modules/core/logger');

async function up() {
  logger.info('Running migration: 040-fix-pdf-availability-logic');
  
  try {
    // Drop and recreate the view with correct logic
    await db.query('DROP VIEW IF EXISTS fact_accounting_augmented');
    
    await db.query(`
      CREATE VIEW fact_accounting_augmented AS
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
        -- For customer invoices, use invoice date (PDFs always available)
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN inv.date
          ELSE NULL
        END AS invoice_date,
        -- CRITICAL: Only show invoice_notes when PDF is confirmed to be available
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN COALESCE(inv.notes, 'NULL')
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') 
               AND vpa.has_pdf = TRUE THEN COALESCE(ae.entry_text, 'NULL')
          ELSE NULL
        END AS invoice_notes,
        -- CRITICAL: Only create PDF URLs when PDF is confirmed to be available
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN 
            CONCAT('http://localhost:3000/api/invoices/', ae.agreement_number, '/', ae.voucher_number, '/pdf')
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') 
               AND vpa.has_pdf = TRUE THEN 
            CONCAT('http://localhost:3000/api/vouchers/', ae.agreement_number, '/', ae.voucher_number, '/pdf')
          ELSE NULL
        END AS pdf_url,
        -- Create InvoiceKey for compatibility
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN CONCAT(ae.voucher_number, '_', ae.agreement_number)
          ELSE CONCAT('voucher_', ae.voucher_number, '_', ae.agreement_number)
        END AS InvoiceKey,
        -- Add PDF availability information
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN TRUE
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') THEN 
            COALESCE(vpa.has_pdf, FALSE)
          ELSE FALSE
        END AS has_pdf_available,
        -- Add last checked timestamp for PDF availability
        vpa.last_checked AS pdf_last_checked
      FROM fact_accounting_entries AS ae
      LEFT JOIN invoices AS inv
        ON ae.entry_type = 'customerInvoice'
       AND ae.voucher_number = inv.invoice_number
       AND ae.agreement_number = inv.agreement_number
      LEFT JOIN voucher_pdf_availability AS vpa
        ON ae.voucher_number = vpa.voucher_number
       AND ae.agreement_number = vpa.agreement_number
      WHERE ae.voucher_number IS NOT NULL
    `);
    
    logger.info('Migration 040-fix-pdf-availability-logic completed successfully');
  } catch (error) {
    logger.error('Error running migration 040-fix-pdf-availability-logic:', error.message);
    throw error;
  }
}

async function down() {
  logger.info('Reverting migration: 040-fix-pdf-availability-logic');
  
  try {
    // Revert to showing all invoice_notes regardless of PDF availability
    await db.query('DROP VIEW IF EXISTS fact_accounting_augmented');
    
    await db.query(`
      CREATE VIEW fact_accounting_augmented AS
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
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN inv.date
          ELSE NULL
        END AS invoice_date,
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN COALESCE(inv.notes, 'NULL')
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') THEN COALESCE(ae.entry_text, 'NULL')
          ELSE 'NULL'
        END AS invoice_notes,
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN 
            CONCAT('http://localhost:3000/api/invoices/', ae.agreement_number, '/', ae.voucher_number, '/pdf')
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') 
               AND vpa.has_pdf = TRUE THEN 
            CONCAT('http://localhost:3000/api/vouchers/', ae.agreement_number, '/', ae.voucher_number, '/pdf')
          ELSE NULL
        END AS pdf_url,
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN CONCAT(ae.voucher_number, '_', ae.agreement_number)
          ELSE CONCAT('voucher_', ae.voucher_number, '_', ae.agreement_number)
        END AS InvoiceKey,
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN TRUE
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') THEN 
            COALESCE(vpa.has_pdf, FALSE)
          ELSE FALSE
        END AS has_pdf_available,
        vpa.last_checked AS pdf_last_checked
      FROM fact_accounting_entries AS ae
      LEFT JOIN invoices AS inv
        ON ae.entry_type = 'customerInvoice'
       AND ae.voucher_number = inv.invoice_number
       AND ae.agreement_number = inv.agreement_number
      LEFT JOIN voucher_pdf_availability AS vpa
        ON ae.voucher_number = vpa.voucher_number
       AND ae.agreement_number = vpa.agreement_number
      WHERE ae.voucher_number IS NOT NULL
    `);
    
    logger.info('Migration 040-fix-pdf-availability-logic reverted successfully');
  } catch (error) {
    logger.error('Error reverting migration 040-fix-pdf-availability-logic:', error.message);
    throw error;
  }
}

module.exports = { up, down }; 