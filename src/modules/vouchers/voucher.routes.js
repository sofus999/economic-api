const express = require('express');
const voucherController = require('./voucher.controller');

const router = express.Router();

// Get voucher details by voucher number and agreement number
router.get('/:agreement_number/:voucher_number', voucherController.getVoucherDetails);

// Get PDF for voucher with agreement number - main endpoint for the new functionality
router.get('/:agreement_number/:voucher_number/pdf', voucherController.getVoucherPdf);

module.exports = router; 