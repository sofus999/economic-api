const AccountService = require('./account.service');
const logger = require('../core/logger');
const { ApiError } = require('../core/error.handler');

class AccountController {
  // Get all accounts
  async getAllAccounts(req, res, next) {
    try {
      const accounts = await AccountService.getAllAccounts();
      res.json(accounts);
    } catch (error) {
      next(error);
    }
  }

  // Get accounts for a specific agreement
  async getAccounts(req, res, next) {
    try {
      const { agreement_number } = req.params;
      const accounts = await AccountService.getByAgreement(agreement_number);
      res.json(accounts);
    } catch (error) {
      next(error);
    }
  }

  // Get specific account by number and agreement
  async getAccountByNumber(req, res, next) {
    try {
      const { agreement_number, account_number } = req.params;
      const account = await AccountService.getAccountByNumber(account_number, agreement_number);
      
      if (!account) {
        throw new ApiError('Account not found', 404);
      }
      
      res.json(account);
    } catch (error) {
      next(error);
    }
  }

  // Get account entries with pagination
  async getAccountEntries(req, res, next) {
    try {
      const { agreement_number, account_number } = req.params;
      const { page = 1, limit = 50, from_date, to_date } = req.query;
      
      const entries = await AccountService.getAccountEntriesDirect(
        account_number, 
        agreement_number, 
        parseInt(page), 
        parseInt(limit),
        from_date,
        to_date
      );
      
      console.log(`Account entries data sample: ${entries.entries.length > 0 ? JSON.stringify(entries.entries[0]) : 'No entries'}`);
      
      res.json(entries);
    } catch (error) {
      next(error);
    }
  }

  // Get monthly balances for an account
  async getMonthlyBalances(req, res, next) {
    try {
      const { agreement_number, account_number } = req.params;
      const { year } = req.query;
      
      const result = await AccountService.getMonthlyBalancesDirect(
        account_number, 
        agreement_number,
        year
      );
      
      console.log(`Monthly balances data sample: ${result.balances.length > 0 ? JSON.stringify(result.balances[0]) : 'No balances'}`);
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Get invoices related to an account
  async getAccountInvoices(req, res, next) {
    try {
      const { agreement_number, account_number } = req.params;
      const { page = 1, limit = 20 } = req.query;
      
      const result = await AccountService.getAccountInvoicesDirect(
        account_number, 
        agreement_number,
        parseInt(page),
        parseInt(limit)
      );
      
      console.log(`Invoice data sample: ${result.invoices.length > 0 ? JSON.stringify(result.invoices[0]) : 'No invoices'}`);
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AccountController();