const db = require('../index');
const logger = require('../../modules/core/logger');

async function up() {
  logger.info('Running migration: 043-fix-collation-issue');
  
  try {
    // Fix the collation issue in fact_accounting_augmented view
    // The pdf_url column was causing collation mismatch errors when querying
    // Solution: Add explicit COLLATE utf8mb4_unicode_ci to CONCAT operations
    
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
        -- For customer invoices, use invoice date (PDFs always available)
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN inv.date
          ELSE NULL
        END AS invoice_date,
        -- Customer invoices: Always show notes (they always have PDFs)
        -- Other entry types: Only show actual notes when PDF is confirmed, otherwise 'NULL' string
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN COALESCE(inv.notes, 'NULL')
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') 
               AND vpa.has_pdf = TRUE THEN COALESCE(ae.entry_text, 'NULL')
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') 
               AND COALESCE(vpa.has_pdf, FALSE) = FALSE THEN 'NULL'
          ELSE 'NULL'
        END AS invoice_notes,
        -- PDF URLs: Customer invoices always, others only when confirmed
        -- FIXED: Added COLLATE to ensure consistent collation and prevent query errors
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN 
            CONCAT('http://93.165.248.108:3000/api/invoices/', ae.agreement_number, '/', ae.voucher_number, '/pdf') COLLATE utf8mb4_unicode_ci
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') 
               AND vpa.has_pdf = TRUE THEN 
            CONCAT('http://93.165.248.108:3000/api/vouchers/', ae.agreement_number, '/', ae.voucher_number, '/pdf') COLLATE utf8mb4_unicode_ci
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
      -- Use subquery to select only one invoice record per (invoice_number, agreement_number) combination
      -- This prevents duplicate rows when multiple invoices exist with same invoice_number but different customer_number
      LEFT JOIN (
        SELECT 
          invoice_number,
          agreement_number,
          date,
          notes
        FROM (
          SELECT 
            invoice_number,
            agreement_number,
            date,
            notes,
            ROW_NUMBER() OVER (
              PARTITION BY invoice_number, agreement_number 
              ORDER BY updated_at DESC, customer_number
            ) as rn
          FROM invoices
        ) ranked_invoices
        WHERE rn = 1
      ) inv ON ae.entry_type = 'customerInvoice'
        AND ae.voucher_number = inv.invoice_number
        AND ae.agreement_number = inv.agreement_number
      LEFT JOIN voucher_pdf_availability AS vpa
        ON ae.voucher_number = vpa.voucher_number
       AND ae.agreement_number = vpa.agreement_number
      WHERE ae.voucher_number IS NOT NULL
    `);
    
    logger.info('Migration 043-fix-collation-issue completed successfully');
  } catch (error) {
    logger.error('Error running migration 043-fix-collation-issue:', error.message);
    throw error;
  }
}

async function down() {
  logger.info('Reverting migration: 043-fix-collation-issue');
  
  try {
    // Revert to the previous version (without explicit collation)
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
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN inv.date
          ELSE NULL
        END AS invoice_date,
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN COALESCE(inv.notes, 'NULL')
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') 
               AND vpa.has_pdf = TRUE THEN COALESCE(ae.entry_text, 'NULL')
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') 
               AND COALESCE(vpa.has_pdf, FALSE) = FALSE THEN 'NULL'
          ELSE 'NULL'
        END AS invoice_notes,
        CASE 
          WHEN ae.entry_type = 'customerInvoice' THEN 
            CONCAT('http://93.165.248.108:3000/api/invoices/', ae.agreement_number, '/', ae.voucher_number, '/pdf')
          WHEN ae.entry_type IN ('financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder') 
               AND vpa.has_pdf = TRUE THEN 
            CONCAT('http://93.165.248.108:3000/api/vouchers/', ae.agreement_number, '/', ae.voucher_number, '/pdf')
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
      LEFT JOIN (
        SELECT 
          invoice_number,
          agreement_number,
          date,
          notes
        FROM (
          SELECT 
            invoice_number,
            agreement_number,
            date,
            notes,
            ROW_NUMBER() OVER (
              PARTITION BY invoice_number, agreement_number 
              ORDER BY updated_at DESC, customer_number
            ) as rn
          FROM invoices
        ) ranked_invoices
        WHERE rn = 1
      ) inv ON ae.entry_type = 'customerInvoice'
        AND ae.voucher_number = inv.invoice_number
        AND ae.agreement_number = inv.agreement_number
      LEFT JOIN voucher_pdf_availability AS vpa
        ON ae.voucher_number = vpa.voucher_number
       AND ae.agreement_number = vpa.agreement_number
      WHERE ae.voucher_number IS NOT NULL
    `);
    
    logger.info('Migration 043-fix-collation-issue reverted successfully');
  } catch (error) {
    logger.error('Error reverting migration 043-fix-collation-issue:', error.message);
    throw error;
  }
}

module.exports = { up, down }; 