const express = require('express');
const accountController = require('./account.controller');
const router = express.Router();
const accountService = require('./account.service');

// Get accounts by agreement
router.get('/agreements/:agreement_number', accountController.getAccounts);

// Get account by number and agreement
router.get('/agreements/:agreement_number/:account_number', accountController.getAccountByNumber);
router.get('/:agreement_number/:account_number', accountController.getAccountByNumber);

// Get all accounts
router.get('/', accountController.getAllAccounts);

// Get account entries with pagination
router.get('/:agreement_number/:account_number/entries', accountController.getAccountEntries);

// Get monthly account balances
router.get('/:agreement_number/:account_number/monthly-balances', accountController.getMonthlyBalances);

// Get account invoices
router.get('/:agreement_number/:account_number/invoices', accountController.getAccountInvoices);

// DIAGNOSTIC ROUTES - Test direct table queries
router.get('/:agreementNumber/:accountNumber/monthly-balances-direct', async (req, res) => {
  try {
    const result = await accountService.getMonthlyBalancesDirect(
      req.params.accountNumber,
      req.params.agreementNumber,
      req.query.year
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:agreementNumber/:accountNumber/invoices-direct', async (req, res) => {
  try {
    const result = await accountService.getAccountInvoicesDirect(
      req.params.accountNumber,
      req.params.agreementNumber,
      req.query.page || 1,
      req.query.limit || 20
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DIAGNOSTIC ROUTES - Debug endpoint to check data format
router.get('/:agreementNumber/:accountNumber/debug', async (req, res) => {
  try {
    // Get all data for debugging
    const entriesPromise = accountService.getAccountEntriesDirect(
      req.params.accountNumber,
      req.params.agreementNumber,
      1, 10
    );
    
    const balancesPromise = accountService.getMonthlyBalancesDirect(
      req.params.accountNumber,
      req.params.agreementNumber
    );
    
    const invoicesPromise = accountService.getAccountInvoicesDirect(
      req.params.accountNumber,
      req.params.agreementNumber,
      1, 10
    );
    
    // Wait for all promises to resolve
    const [entries, balances, invoices] = await Promise.all([
      entriesPromise, balancesPromise, invoicesPromise
    ]);
    
    // Return all data for inspection
    res.json({
      entries: entries.entries.slice(0, 2), // Just show first 2 for brevity
      balances: balances.balances,
      invoices: invoices.invoices.slice(0, 2) // Just show first 2 for brevity
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;