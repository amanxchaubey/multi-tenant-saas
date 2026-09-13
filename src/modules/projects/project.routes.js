const express = require('express');
const authorize = require('../../middleware/authorize');
const projectController = require('./project.controller');

const router = express.Router();

router.get('/', projectController.list);
router.post('/', authorize('OWNER', 'ADMIN'), projectController.create);

module.exports = router;