const db = require('../index');
const logger = require('../../modules/core/logger');

async function up() {
  logger.info('Running migration: 003-agreement-configs');
  
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS agreement_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) DEFAULT 'Pending API Verification',
        agreement_number INT NULL,
        agreement_grant_token VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY idx_agreement_grant_token (agreement_grant_token),
        UNIQUE KEY idx_agreement_number (agreement_number)
      )
    `);
    
    // Insert default agreement from environment variables if available
    if (process.env.AGREEMENT_GRANT_TOKEN) {
      await db.query(`
        INSERT INTO agreement_configs (agreement_grant_token, agreement_number, name)
        VALUES (?, ?, ?)
      `, [
        process.env.AGREEMENT_GRANT_TOKEN,
        process.env.AGREEMENT_NUMBER || null,
        'Default Agreement'
      ]);
    }
    
    logger.info('Migration 003-agreement-configs completed successfully');
  } catch (error) {
    logger.error('Error running migration 003-agreement-configs:', error.message);
    throw error;
  }
}

async function down() {
  logger.info('Reverting migration: 003-agreement-configs');
  
  try {
    await db.query('DROP TABLE IF EXISTS agreement_configs');
    
    logger.info('Migration 003-agreement-configs reverted successfully');
  } catch (error) {
    logger.error('Error reverting migration 003-agreement-configs:', error.message);
    throw error;
  }
}

module.exports = { up, down };