const VoucherService = require('./voucher.service');
const logger = require('../core/logger');

class VoucherController {
  /**
   * Get voucher PDF
   */
  async getVoucherPdf(req, res) {
    try {
      const { agreement_number, voucher_number } = req.params;
      
      // Convert to integers
      const voucherNum = parseInt(voucher_number, 10);
      const agrNumber = parseInt(agreement_number, 10);
      
      if (isNaN(voucherNum) || isNaN(agrNumber)) {
        return res.status(400).json({ 
          error: 'Invalid Parameters', 
          details: 'Voucher number and agreement number must be valid integers'
        });
      }
      
      logger.info(`Controller: Getting PDF for voucher ${voucherNum} in agreement ${agrNumber}`);
      
      // Use the voucher service to get the PDF
      const pdfStream = await VoucherService.getVoucherPdf(voucherNum, agrNumber);
      
      if (!pdfStream) {
        return res.status(404).json({ 
          error: 'PDF Not Found', 
          details: 'The PDF could not be found for this voucher. It might not exist or it may be in a different state.'
        });
      }
      
      // Set response headers
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="voucher-${agrNumber}-${voucherNum}.pdf"`);
      
      // Stream the PDF to the response
      pdfStream.pipe(res);
      
      // Handle any stream errors
      pdfStream.on('error', (streamError) => {
        logger.error('PDF stream error:', streamError.message);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream Error', details: streamError.message });
        }
      });
      
    } catch (error) {
      logger.error('Voucher PDF controller error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get voucher details
   */
  async getVoucherDetails(req, res) {
    try {
      const { agreement_number, voucher_number } = req.params;
      
      const voucherNum = parseInt(voucher_number, 10);
      const agrNumber = parseInt(agreement_number, 10);
      
      if (isNaN(voucherNum) || isNaN(agrNumber)) {
        return res.status(400).json({ 
          error: 'Invalid Parameters', 
          details: 'Voucher number and agreement number must be valid integers'
        });
      }
      
      const voucherDetails = await VoucherService.getVoucherDetails(voucherNum, agrNumber);
      
      if (!voucherDetails || voucherDetails.length === 0) {
        return res.status(404).json({ 
          error: 'Voucher Not Found', 
          details: 'No voucher found with the specified number and agreement'
        });
      }
      
      res.json({
        voucher_number: voucherNum,
        agreement_number: agrNumber,
        entries: voucherDetails
      });
      
    } catch (error) {
      logger.error('Get voucher details error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new VoucherController(); 