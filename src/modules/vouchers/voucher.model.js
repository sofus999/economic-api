const db = require('../../db');
const logger = require('../core/logger');

class VoucherModel {
  /**
   * Find voucher entries by voucher number and agreement number
   */
  static async findByVoucherAndAgreement(voucherNumber, agreementNumber) {
    try {
      const entries = await db.query(
        'SELECT * FROM accounting_entries WHERE voucher_number = ? AND agreement_number = ? ORDER BY entry_number',
        [voucherNumber, agreementNumber]
      );
      
      return entries;
    } catch (error) {
      logger.error(`Error finding voucher entries for voucher ${voucherNumber} and agreement ${agreementNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Find vouchers by entry type and agreement
   */
  static async findByEntryTypeAndAgreement(entryType, agreementNumber) {
    try {
      const entries = await db.query(
        'SELECT DISTINCT voucher_number, entry_type, agreement_number FROM accounting_entries WHERE entry_type = ? AND agreement_number = ? AND voucher_number IS NOT NULL ORDER BY voucher_number DESC',
        [entryType, agreementNumber]
      );
      
      return entries;
    } catch (error) {
      logger.error(`Error finding vouchers by entry type ${entryType} and agreement ${agreementNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Get voucher summary with entry counts
   */
  static async getVoucherSummary(voucherNumber, agreementNumber) {
    try {
      const summary = await db.query(
        `SELECT 
          voucher_number,
          agreement_number,
          entry_type,
          COUNT(*) as entry_count,
          SUM(amount) as total_amount,
          SUM(amount_in_base_currency) as total_amount_base,
          MIN(entry_date) as first_entry_date,
          MAX(entry_date) as last_entry_date,
          GROUP_CONCAT(DISTINCT account_number ORDER BY account_number) as account_numbers
        FROM accounting_entries 
        WHERE voucher_number = ? AND agreement_number = ?
        GROUP BY voucher_number, agreement_number, entry_type`,
        [voucherNumber, agreementNumber]
      );
      
      return summary.length > 0 ? summary[0] : null;
    } catch (error) {
      logger.error(`Error getting voucher summary for voucher ${voucherNumber} and agreement ${agreementNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Check if voucher has valid entry type for PDF access
   */
  static async isValidVoucherType(voucherNumber, agreementNumber) {
    try {
      const validTypes = ['financeVoucher', 'supplierInvoice', 'supplierPayment', 'manualDebtorInvoice', 'reminder'];
      
      const entries = await db.query(
        'SELECT DISTINCT entry_type FROM accounting_entries WHERE voucher_number = ? AND agreement_number = ?',
        [voucherNumber, agreementNumber]
      );
      
      return entries.some(entry => validTypes.includes(entry.entry_type));
    } catch (error) {
      logger.error(`Error checking voucher type for voucher ${voucherNumber} and agreement ${agreementNumber}:`, error.message);
      throw error;
    }
  }
}

module.exports = VoucherModel; 