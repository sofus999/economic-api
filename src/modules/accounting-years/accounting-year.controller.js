const accountingYearService = require('./accounting-year.service');
const logger = require('../core/logger');

class AccountingYearController {
  /**
   * Sync accounting years for all agreements (standard sync without PDF checking)
   */
  async syncAccountingYears(req, res, next) {
    try {
      const result = await accountingYearService.syncAllAccountingYears();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Daily sync - only current (non-closed) year with PDF checking
   */
  async syncDailyAccountingYears(req, res, next) {
    try {
      const result = await accountingYearService.syncCurrentYearOnly();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Full sync - all years with PDF availability checking
   */
  async syncFullAccountingYears(req, res, next) {
    try {
      const result = await accountingYearService.syncAllAccountingYears(true); // true = check PDF availability
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
  
  /**
   * Sync accounting years for a specific agreement
   */
  async syncAccountingYearsForAgreement(req, res, next) {
    try {
      const { id } = req.params;
      const agreement = await require('../agreements/agreement.model').getById(id);
      const result = await accountingYearService.syncAccountingYearsForAgreement(agreement);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AccountingYearController();