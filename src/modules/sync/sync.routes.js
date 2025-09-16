const express = require('express');
const router = express.Router();
const syncController = require('./sync.controller');

// POST /api/sync - Sync all data (standard sync)
router.post('/', (req, res, next) => {
  syncController.syncAll(req, res, next);
});

// POST /api/sync/daily - Daily sync (current year only with PDF checking)
router.post('/daily', (req, res, next) => {
  syncController.syncDaily(req, res, next);
});

// POST /api/sync/full - Full sync (all data with PDF checking)
router.post('/full', (req, res, next) => {
  syncController.syncFull(req, res, next);
});

// GET /api/sync/status - Get sync status and recent logs
router.get('/status', (req, res, next) => {
  syncController.getSyncStatus(req, res, next);
});

module.exports = router;