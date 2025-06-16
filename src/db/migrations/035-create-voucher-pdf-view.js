const db = require('../index');
const logger = require('../../modules/core/logger');

async function up() {
  logger.info('Running migration: 035-create-voucher-pdf-view');
  
  try {
    // Create a view with a composite unique key
    await db.query(`
      CREATE VIEW v_voucher_pdf_links AS
      SELECT DISTINCT
        voucher_number,
        agreement_number,
        CONCAT(voucher_number, '_', agreement_number) AS voucher_key,
        CONCAT('http://localhost:3000/api/invoices/', agreement_number, '/', voucher_number, '/pdf') AS pdf_url
      FROM
        accounting_entries
      WHERE
        voucher_number IS NOT NULL
    `);
    
    logger.info('Migration 035-create-voucher-pdf-view completed successfully');
  } catch (error) {
    logger.error('Error running migration 035-create-voucher-pdf-view:', error.message);
    throw error;
  }
}

async function down() {
  logger.info('Reverting migration: 035-create-voucher-pdf-view');
  
  try {
    await db.query('DROP VIEW IF EXISTS v_voucher_pdf_links');
    
    logger.info('Migration 035-create-voucher-pdf-view reverted successfully');
  } catch (error) {
    logger.error('Error reverting migration 035-create-voucher-pdf-view:', error.message);
    throw error;
  }
}

module.exports = { up, down }; 