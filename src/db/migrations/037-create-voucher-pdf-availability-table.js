const db = require('../index');
const logger = require('../../modules/core/logger');

async function up() {
  logger.info('Running migration: 037-create-voucher-pdf-availability-table');
  
  try {
    // Create table to track PDF availability for vouchers
    await db.query(`
      CREATE TABLE IF NOT EXISTS voucher_pdf_availability (
        voucher_number INT NOT NULL,
        agreement_number INT NOT NULL,
        has_pdf BOOLEAN NOT NULL DEFAULT FALSE,
        last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (voucher_number, agreement_number),
        INDEX idx_has_pdf (has_pdf),
        INDEX idx_last_checked (last_checked),
        FOREIGN KEY (agreement_number) REFERENCES agreement_configs(agreement_number) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    logger.info('Migration 037-create-voucher-pdf-availability-table completed successfully');
  } catch (error) {
    logger.error('Error running migration 037-create-voucher-pdf-availability-table:', error.message);
    throw error;
  }
}

async function down() {
  logger.info('Reverting migration: 037-create-voucher-pdf-availability-table');
  
  try {
    await db.query('DROP TABLE IF EXISTS voucher_pdf_availability');
    
    logger.info('Migration 037-create-voucher-pdf-availability-table reverted successfully');
  } catch (error) {
    logger.error('Error reverting migration 037-create-voucher-pdf-availability-table:', error.message);
    throw error;
  }
}

module.exports = { up, down }; 