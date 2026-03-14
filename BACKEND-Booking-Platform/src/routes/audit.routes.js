// src/routes/audits.routes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Audit = require('../models/audit.model');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');

/**
 * Admin-only audit read endpoints.
 *
 * Query options:
 *  - correlationId (string) => returns audits for that correlation id
 *  - targetType & targetId => returns audits for a specific resource (e.g., targetType=Request, targetId=5f...)
 *  - page, pageSize => pagination (defaults: page=1, pageSize=50)
 *
 * At least one of correlationId or (targetType & targetId) must be provided.
 */

// GET /audits?correlationId=... OR /audits?targetType=Request&targetId=...
router.get('/', requireAuth, requireRole('administrator'), async (req, res) => {
  try {
    const { correlationId, targetType, targetId } = req.query;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || '50', 10)));
    const skip = (page - 1) * pageSize;

    if (!correlationId && !(targetType && targetId)) {
      return res.status(400).json({ message: 'Provide correlationId or targetType and targetId' });
    }

    let filter = {};
    if (correlationId) {
      filter.correlationId = correlationId;
    } else {
      filter['target.type'] = targetType;
      filter['target.id'] = targetId;
    }

    const [results, total] = await Promise.all([
      Audit.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean().exec(),
      Audit.countDocuments(filter).exec()
    ]);

    return res.json({ results, total, page, pageSize });
  } catch (err) {
    console.error('[audits.routes] error', err && err.message);
    return res.status(500).json({ message: 'Failed to query audits' });
  }
});

// GET /audits/:id - fetch a single audit record by its Mongo _id
router.get('/:id', requireAuth, requireRole('administrator'), async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid audit id' });
    }
    const audit = await Audit.findById(id).lean().exec();
    if (!audit) return res.status(404).json({ message: 'Audit record not found' });
    return res.json({ audit });
  } catch (err) {
    console.error('[audits.routes] error', err && err.message);
    return res.status(500).json({ message: 'Failed to fetch audit record' });
  }
});

module.exports = router;
