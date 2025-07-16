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

module.exports = router;