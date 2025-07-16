const express = require('express');
const syncController = require('../modules/sync/sync.controller');
const router = express.Router();

// POST /api/sync - Sync all data (standard sync)
router.post('/', syncController.syncAll.bind(syncController));

// POST /api/sync/daily - Daily sync (current year only with PDF checking)
router.post('/daily', syncController.syncDaily.bind(syncController));

// POST /api/sync/full - Full sync (all data with PDF checking)
router.post('/full', syncController.syncFull.bind(syncController));

module.exports = router;
