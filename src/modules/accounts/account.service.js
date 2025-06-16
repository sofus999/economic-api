const ApiClient = require('../../api/client');
const endpoints = require('../../api/endpoints');
const AccountModel = require('./account.model');
const AgreementModel = require('../agreements/agreement.model');
const logger = require('../core/logger');
const { ApiError } = require('../core/error.handler');
const db = require('../../db');

class AccountService {
  getClientForAgreement(agreementToken) {
    return ApiClient.forAgreement(agreementToken);
  }

  transformAccountData(account, agreementNumber) {
    let vatCode = null;
    if (account.vatAccount && account.vatAccount.vatCode) {
      vatCode = account.vatAccount.vatCode;
    }
    
    return {
      account_number: account.accountNumber,
      agreement_number: agreementNumber,
      account_type: account.accountType,
      name: account.name,
      balance: account.balance || 0.00,
      debit_credit: account.debitCredit,
      block_direct_entries: account.blockDirectEntries || false,
      vat_code: vatCode,
      self_url: account.self
    };
  }

  async syncAccountsForAgreement(agreement) {
    const startTime = new Date();
    let recordCount = 0;
    
    try {
      logger.info(`Starting accounts sync for agreement ${agreement.name} (${agreement.agreement_number})`);
      
      const client = this.getClientForAgreement(agreement.agreement_grant_token);
      const agreementInfo = await client.getAgreementInfo();
      const agreementNumber = agreementInfo.agreementNumber;
      
      const accounts = await client.getPaginated(endpoints.ACCOUNTS);
      logger.info(`Found ${accounts.length} accounts for agreement ${agreementNumber}`);
      
      for (const account of accounts) {
        const accountData = this.transformAccountData(account, agreementNumber);
        await AccountModel.upsert(accountData);
        recordCount++;
      }
      
      await AccountModel.recordSyncLog(
        agreementNumber,
        recordCount,
        null,
        startTime
      );
      
      logger.info(`Completed accounts sync for agreement ${agreementNumber}: ${recordCount} records processed`);
      
      return {
        agreement: {
          id: agreement.id,
          name: agreement.name,
          agreement_number: agreementNumber
        },
        recordCount
      };
      
    } catch (error) {
      logger.error(`Error syncing accounts for agreement ${agreement.id}:`, error.message);
      
      await AccountModel.recordSyncLog(
        agreement.agreement_number || 'unknown',
        recordCount,
        error.message,
        startTime
      );
      
      throw error;
    }
  }

  async syncAllAccounts() {
    const startTime = new Date();
    const agreementResults = [];
    let totalCount = 0;
    
    try {
      logger.info('Starting sync of accounts across all agreements');
      
      const agreements = await AgreementModel.getAll(true);
      
      if (agreements.length === 0) {
        logger.warn('No active agreements found for sync');
        return {
          status: 'warning',
          message: 'No active agreements found',
          results: [],
          totalCount: 0
        };
      }
      
      for (const agreement of agreements) {
        try {
          const result = await this.syncAccountsForAgreement(agreement);
          agreementResults.push(result);
          totalCount += result.recordCount;
        } catch (error) {
          logger.error(`Error syncing accounts for agreement ${agreement.name}:`, error.message);
          agreementResults.push({
            agreement: {
              id: agreement.id,
              name: agreement.name,
              agreement_number: agreement.agreement_number
            },
            status: 'error',
            error: error.message
          });
        }
      }
      
      logger.info(`Completed accounts sync across all agreements: ${totalCount} records processed`);
      
      return {
        status: 'success',
        results: agreementResults,
        totalCount
      };
      
    } catch (error) {
      logger.error('Error in overall accounts sync process:', error.message);
      throw error;
    }
  }

  async getAccountsByAgreement(agreementNumber) {
    try {
      return await AccountModel.getByAgreement(agreementNumber);
    } catch (error) {
      logger.error(`Error getting accounts for agreement ${agreementNumber}:`, error.message);
      throw error;
    }
  }

  async getAccountByNumber(accountNumber, agreementNumber) {
    try {
      const account = await AccountModel.findByNumberAndAgreement(accountNumber, agreementNumber);
      
      if (!account) {
        throw ApiError.notFound(`Account with number ${accountNumber} not found for agreement ${agreementNumber}`);
      }
      
      return account;
    } catch (error) {
      logger.error(`Error getting account ${accountNumber} for agreement ${agreementNumber}:`, error.message);
      throw error;
    }
  }

  // Get all accounts from all agreements
  async getAllAccounts() {
    try {
      // Use the account summary view - select specific columns for better performance
      const accounts = await db.query(`
        SELECT
          account_number,
          agreement_number,
          account_type,
          name,
          balance,
          debit_credit
        FROM account_summary_view
        ORDER BY account_number
      `);
      return accounts;
    } catch (error) {
      logger.error('Error getting all accounts:', error.message);
      throw new ApiError('Failed to get accounts', 500);
    }
  }

  // Get accounts for a specific agreement
  async getByAgreement(agreementNumber) {
    try {
      // Use the account summary view filtered by agreement - select specific columns for better performance
      const accounts = await db.query(`
        SELECT
          account_number,
          agreement_number,
          account_type,
          name,
          balance,
          debit_credit
        FROM account_summary_view
        WHERE agreement_number = ?
        ORDER BY account_number
      `, [agreementNumber]);
      
      return accounts;
    } catch (error) {
      logger.error(`Error getting accounts for agreement ${agreementNumber}:`, error.message);
      throw new ApiError('Failed to get accounts', 500);
    }
  }

  // Get account by number and agreement
  async getAccountByNumber(accountNumber, agreementNumber) {
    try {
      // Use the account summary view - select specific columns for better performance
      const accounts = await db.query(`
        SELECT
          account_number,
          agreement_number,
          account_type,
          name,
          balance,
          debit_credit,
          block_direct_entries,
          vat_code
        FROM account_summary_view
        WHERE account_number = ? AND agreement_number = ?
      `, [accountNumber, agreementNumber]);
      
      return accounts.length > 0 ? accounts[0] : null;
    } catch (error) {
      logger.error(`Error getting account ${accountNumber} for agreement ${agreementNumber}:`, error.message);
      throw new ApiError('Failed to get account', 500);
    }
  }

  // Get account entries with pagination and date filter
  async getAccountEntries(accountNumber, agreementNumber, page = 1, limit = 50, fromDate = null, toDate = null) {
    try {
      const offset = (page - 1) * limit;
      
      let whereClause = 'WHERE account_number = ? AND agreement_number = ?';
      const params = [accountNumber, agreementNumber];
      
      if (fromDate) {
        whereClause += ' AND entry_date >= ?';
        params.push(fromDate);
      }
      
      if (toDate) {
        whereClause += ' AND entry_date <= ?';
        params.push(toDate);
      }
      
      // Use the account entries view - use SELECT * as we're not sure of column names
      const query = `
        SELECT *
        FROM account_entries_view
        ${whereClause}
        ORDER BY entry_date DESC, entry_number DESC
        LIMIT ? OFFSET ?
      `;
      
      params.push(limit, offset);
      
      const entries = await db.query(query, params);
      
      // Get total count for pagination using COUNT(*) for performance
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM account_entries_view
        ${whereClause}
      `;
      
      const countResult = await db.query(countQuery, params.slice(0, params.length - 2));
      
      return {
        entries,
        pagination: {
          total: countResult[0]?.total || 0,
          page,
          limit,
          pages: Math.ceil((countResult[0]?.total || 0) / limit)
        }
      };
    } catch (error) {
      logger.error(`Error getting entries for account ${accountNumber}:`, error.message);
      throw new ApiError('Failed to get account entries', 500);
    }
  }

  // Get monthly balances for an account
  async getMonthlyBalances(accountNumber, agreementNumber, year = null) {
    try {
      logger.info(`Starting monthly balances query for account ${accountNumber}`);
      const startTime = Date.now();
      
      const currentYear = new Date().getFullYear();
      const targetYear = year || currentYear;
      
      // Use the monthly account balances view - use SELECT * as we're not sure of column names
      const query = `
        SELECT *
        FROM monthly_account_balances_view
        WHERE account_number = ? 
        AND agreement_number = ?
        AND entry_year = ?
        ORDER BY entry_year, entry_month
      `;
      
      logger.info(`Executing monthly balances query: ${Date.now() - startTime}ms`);
      const balances = await db.query(query, [accountNumber, agreementNumber, targetYear]);
      logger.info(`Monthly balances query complete: ${Date.now() - startTime}ms (${balances.length} rows)`);
      
      const result = {
        account_number: accountNumber,
        agreement_number: agreementNumber,
        year: targetYear,
        balances
      };
      
      logger.info(`Monthly balances total time: ${Date.now() - startTime}ms`);
      return result;
    } catch (error) {
      logger.error(`Error getting monthly balances for account ${accountNumber}:`, error.message);
      throw new ApiError('Failed to get monthly balances', 500);
    }
  }

  // Get monthly balances for an account - direct table query version
  async getMonthlyBalancesDirect(accountNumber, agreementNumber, year = null) {
    try {
      logger.info(`Starting DIRECT monthly balances query for account ${accountNumber}`);
      const startTime = Date.now();
      
      const currentYear = new Date().getFullYear();
      const targetYear = year || currentYear;
      
      // Use the accounting_entries table directly instead of views
      // Format results to match what the frontend expects
      const query = `
        SELECT 
          ae.account_number,
          ae.agreement_number,
          YEAR(ae.entry_date) as entry_year,
          MONTH(ae.entry_date) as entry_month,
          SUM(ae.amount) as amount
        FROM 
          accounting_entries ae
        WHERE 
          ae.account_number = ? 
          AND ae.agreement_number = ?
          AND YEAR(ae.entry_date) = ?
        GROUP BY
          ae.account_number, ae.agreement_number, entry_year, entry_month
        ORDER BY 
          entry_year, entry_month
      `;
      
      logger.info(`Executing DIRECT monthly balances query: ${Date.now() - startTime}ms`);
      const rawBalances = await db.query(query, [accountNumber, agreementNumber, targetYear]);
      
      // Transform the data to exactly match what the frontend expects
      const balances = rawBalances.map(balance => ({
        year_month: `${balance.entry_year}-${balance.entry_month.toString().padStart(2, '0')}`,
        year: balance.entry_year,
        month: balance.entry_month,
        amount: balance.amount,
        balance: balance.amount,  // Use amount as balance if no running total is available
        monthly_amount: balance.amount,  // Add the property that the chart expects
        end_of_month_balance: balance.amount  // Add the property that the chart expects
      }));
      
      logger.info(`DIRECT monthly balances query complete: ${Date.now() - startTime}ms (${balances.length} rows)`);
      
      const result = {
        account_number: accountNumber,
        agreement_number: agreementNumber,
        year: targetYear,
        balances
      };
      
      logger.info(`DIRECT monthly balances total time: ${Date.now() - startTime}ms`);
      return result;
    } catch (error) {
      logger.error(`Error getting DIRECT monthly balances for account ${accountNumber}:`, error.message);
      return {
        account_number: accountNumber,
        agreement_number: agreementNumber,
        year: year || new Date().getFullYear(),
        balances: [],
        error: error.message
      };
    }
  }

  // Get invoices related to an account
  async getAccountInvoices(accountNumber, agreementNumber, page = 1, limit = 20) {
    try {
      logger.info(`Starting invoices query for account ${accountNumber}`);
      const startTime = Date.now();
      
      const offset = (page - 1) * limit;
      
      // Use the account invoices view - use SELECT * as we're not sure of column names
      const query = `
        SELECT *
        FROM account_invoices_view
        WHERE account_number = ? AND agreement_number = ?
        ORDER BY date DESC
        LIMIT ? OFFSET ?
      `;
      
      logger.info(`Executing invoices query: ${Date.now() - startTime}ms`);
      const invoices = await db.query(query, [
        accountNumber,
        agreementNumber,
        limit,
        offset
      ]);
      logger.info(`Invoices query complete: ${Date.now() - startTime}ms (${invoices.length} rows)`);
      
      // Get total count for pagination using COUNT(*) for performance
      logger.info(`Starting invoices count query: ${Date.now() - startTime}ms`);
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM account_invoices_view
        WHERE account_number = ? AND agreement_number = ?
      `;
      
      const countResult = await db.query(countQuery, [
        accountNumber,
        agreementNumber
      ]);
      logger.info(`Invoices count query complete: ${Date.now() - startTime}ms`);
      
      const result = {
        invoices,
        pagination: {
          total: countResult[0]?.total || 0,
          page,
          limit,
          pages: Math.ceil((countResult[0]?.total || 0) / limit)
        }
      };
      
      logger.info(`Invoices total time: ${Date.now() - startTime}ms`);
      return result;
    } catch (error) {
      logger.error(`Error getting invoices for account ${accountNumber}:`, error.message);
      throw new ApiError('Failed to get account invoices', 500);
    }
  }

  // Get invoices related to an account - direct table query version
  async getAccountInvoicesDirect(accountNumber, agreementNumber, page = 1, limit = 20) {
    try {
      logger.info(`Starting DIRECT invoices query for account ${accountNumber}`);
      const startTime = Date.now();
      
      const offset = (page - 1) * limit;
      
      // Get the invoices using field names the frontend expects
      const query = `
        SELECT 
          invoice_number,
          date,
          customer_name,
          net_amount,
          payment_status,
          currency
        FROM 
          invoices
        WHERE 
          agreement_number = ?
        ORDER BY 
          date DESC
        LIMIT ? OFFSET ?
      `;
      
      logger.info(`Executing DIRECT invoices query: ${Date.now() - startTime}ms`);
      const rawInvoices = await db.query(query, [
        agreementNumber,
        limit,
        offset
      ]);
      
      // Transform the data to exactly match what the frontend expects
      const invoices = rawInvoices.map(invoice => ({
        invoice_number: invoice.invoice_number,
        date: invoice.date,
        customer: invoice.customer_name,
        amount: invoice.net_amount,
        status: invoice.payment_status,
        currency: invoice.currency
      }));
      
      logger.info(`DIRECT invoices query complete: ${Date.now() - startTime}ms (${invoices.length} rows)`);
      
      // Get total count for pagination 
      logger.info(`Starting DIRECT invoices count query: ${Date.now() - startTime}ms`);
      const countQuery = `
        SELECT 
          COUNT(*) as total 
        FROM 
          invoices
        WHERE 
          agreement_number = ?
      `;
      
      const countResult = await db.query(countQuery, [
        agreementNumber
      ]);
      logger.info(`DIRECT invoices count query complete: ${Date.now() - startTime}ms`);
      
      const result = {
        invoices,
        pagination: {
          total: countResult[0]?.total || 0,
          page,
          limit,
          pages: Math.ceil((countResult[0]?.total || 0) / limit)
        }
      };
      
      logger.info(`DIRECT invoices total time: ${Date.now() - startTime}ms`);
      return result;
    } catch (error) {
      logger.error(`Error getting DIRECT invoices for account ${accountNumber}:`, error.message);
      return {
        invoices: [],
        pagination: {
          total: 0,
          page,
          limit,
          pages: 0
        },
        error: error.message
      };
    }
  }

  // Get account entries with pagination - direct table query version
  async getAccountEntriesDirect(accountNumber, agreementNumber, page = 1, limit = 50, fromDate = null, toDate = null) {
    try {
      logger.info(`Starting DIRECT account entries query for account ${accountNumber}`);
      const startTime = Date.now();
      
      const offset = (page - 1) * limit;
      
      let whereClause = 'WHERE account_number = ? AND agreement_number = ?';
      const params = [accountNumber, agreementNumber];
      
      if (fromDate) {
        whereClause += ' AND entry_date >= ?';
        params.push(fromDate);
      }
      
      if (toDate) {
        whereClause += ' AND entry_date <= ?';
        params.push(toDate);
      }
      
      // Use the accounting_entries table directly with field names that match frontend expectations
      const query = `
        SELECT 
          entry_number,
          entry_date,
          voucher_number,
          entry_type,
          entry_text,
          amount,
          currency,
          amount as balance
        FROM 
          accounting_entries
        ${whereClause}
        ORDER BY entry_date DESC, entry_number DESC
        LIMIT ? OFFSET ?
      `;
      
      params.push(limit, offset);
      
      logger.info(`Executing DIRECT account entries query: ${Date.now() - startTime}ms`);
      const rawEntries = await db.query(query, params);
      
      // Transform the data to exactly match what the frontend expects
      const entries = rawEntries.map(entry => ({
        entry_number: entry.entry_number,
        date: entry.entry_date,
        voucher: entry.voucher_number,
        type: entry.entry_type,
        text: entry.entry_text,
        amount: entry.amount,
        currency: entry.currency,
        balance: entry.balance,
        running_balance: entry.balance  // Add running_balance to match what frontend expects
      }));
      
      logger.info(`DIRECT account entries query complete: ${Date.now() - startTime}ms (${entries.length} rows)`);
      
      // Get total count for pagination
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM accounting_entries
        ${whereClause}
      `;
      
      const countResult = await db.query(countQuery, params.slice(0, params.length - 2));
      logger.info(`DIRECT account entries count complete: ${Date.now() - startTime}ms`);
      
      const result = {
        entries,
        pagination: {
          total: countResult[0]?.total || 0,
          page,
          limit,
          pages: Math.ceil((countResult[0]?.total || 0) / limit)
        }
      };
      
      logger.info(`DIRECT account entries total time: ${Date.now() - startTime}ms`);
      return result;
    } catch (error) {
      logger.error(`Error getting DIRECT account entries for account ${accountNumber}:`, error.message);
      return {
        entries: [],
        pagination: {
          total: 0,
          page,
          limit,
          pages: 0
        },
        error: error.message
      };
    }
  }
}

module.exports = new AccountService();