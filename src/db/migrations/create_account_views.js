/**
 * Migration to create views for account balance reporting
 */
const db = require('../index');
const logger = require('../../modules/core/logger');

async function up() {
  logger.info('Running migration: create_account_views');
  
  try {
    // Create view for account entries with running balance
    await db.query(`
      CREATE OR REPLACE VIEW account_entries_view AS
      SELECT 
        ae.entry_number,
        ae.account_number,
        ae.agreement_number,
        ae.entry_date,
        ae.period_number,
        ae.year_id,
        ae.voucher_number,
        ae.entry_type,
        ae.entry_text,
        ae.amount,
        ae.currency,
        ae.amount_in_base_currency,
        a.name AS account_name,
        a.account_type,
        j.name AS journal_name,
        (
          SELECT SUM(ae2.amount) 
          FROM accounting_entries ae2 
          WHERE ae2.account_number = ae.account_number 
          AND ae2.agreement_number = ae.agreement_number
          AND (ae2.entry_date < ae.entry_date OR (ae2.entry_date = ae.entry_date AND ae2.entry_number <= ae.entry_number))
        ) AS running_balance
      FROM 
        accounting_entries ae
      LEFT JOIN 
        accounts a ON ae.account_number = a.account_number AND ae.agreement_number = a.agreement_number
      LEFT JOIN 
        journals j ON ae.voucher_number = j.journal_number AND ae.agreement_number = j.agreement_number
    `);

    // Create view for monthly account balances with simpler structure
    await db.query(`
      CREATE OR REPLACE VIEW monthly_account_balances_view AS
      SELECT 
        ae.account_number,
        ae.agreement_number,
        YEAR(ae.entry_date) AS entry_year,
        MONTH(ae.entry_date) AS entry_month,
        CONCAT(YEAR(ae.entry_date), '-', MONTH(ae.entry_date)) AS period_key,
        SUM(ae.amount) AS monthly_amount,
        (
          SELECT SUM(ae2.amount) 
          FROM accounting_entries ae2 
          WHERE ae2.account_number = ae.account_number 
          AND ae2.agreement_number = ae.agreement_number
          AND ae2.entry_date <= LAST_DAY(DATE(CONCAT(YEAR(ae.entry_date), '-', MONTH(ae.entry_date), '-01')))
        ) AS end_of_month_balance,
        a.name AS account_name,
        a.account_type
      FROM 
        accounting_entries ae
      JOIN 
        accounts a ON ae.account_number = a.account_number AND ae.agreement_number = a.agreement_number
      GROUP BY 
        ae.account_number, ae.agreement_number, YEAR(ae.entry_date), MONTH(ae.entry_date), a.name, a.account_type
      ORDER BY 
        ae.account_number, YEAR(ae.entry_date), MONTH(ae.entry_date)
    `);

    // Create view for account summaries
    await db.query(`
      CREATE OR REPLACE VIEW account_summary_view AS
      SELECT 
        a.account_number,
        a.agreement_number,
        a.name,
        a.account_type,
        a.balance,
        a.debit_credit,
        a.block_direct_entries,
        a.vat_code,
        ac.name AS agreement_name,
        COUNT(DISTINCT ae.entry_number) AS entry_count,
        SUM(CASE WHEN ae.entry_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS recent_entries,
        MIN(ae.entry_date) AS first_entry_date,
        MAX(ae.entry_date) AS last_entry_date
      FROM 
        accounts a
      LEFT JOIN 
        agreement_configs ac ON a.agreement_number = ac.agreement_number
      LEFT JOIN 
        accounting_entries ae ON a.account_number = ae.account_number AND a.agreement_number = ae.agreement_number
      GROUP BY 
        a.account_number, a.agreement_number, a.name, a.account_type, a.balance, a.debit_credit, a.block_direct_entries, a.vat_code, ac.name
    `);

    // Create view connecting invoices to accounts through entries
    await db.query(`
      CREATE OR REPLACE VIEW account_invoices_view AS
      SELECT DISTINCT
        a.account_number,
        a.agreement_number,
        i.invoice_number,
        i.customer_number,
        i.date,
        i.due_date,
        i.payment_status,
        i.net_amount,
        i.gross_amount,
        i.vat_amount,
        i.currency,
        c.name AS customer_name
      FROM 
        accounts a
      JOIN 
        accounting_entries ae ON a.account_number = ae.account_number AND a.agreement_number = ae.agreement_number
      JOIN 
        invoices i ON (ae.voucher_number = i.invoice_number OR ae.entry_text LIKE CONCAT('%', i.invoice_number, '%'))
        AND ae.agreement_number = i.agreement_number
      JOIN 
        customers c ON i.customer_number = c.customer_number AND i.agreement_number = c.agreement_number
    `);
    
    logger.info('Migration create_account_views completed successfully');
  } catch (error) {
    logger.error('Error running migration create_account_views:', error.message);
    throw error;
  }
}

async function down() {
  logger.info('Reverting migration: create_account_views');
  
  try {
    // Drop views in reverse order
    await db.query('DROP VIEW IF EXISTS account_invoices_view');
    await db.query('DROP VIEW IF EXISTS account_summary_view');
    await db.query('DROP VIEW IF EXISTS monthly_account_balances_view');
    await db.query('DROP VIEW IF EXISTS account_entries_view');
    
    logger.info('Migration create_account_views reverted successfully');
  } catch (error) {
    logger.error('Error reverting migration create_account_views:', error.message);
    throw error;
  }
}

module.exports = { up, down }; 