const express = require('express');
const taskController = require('./task.controller');

const router = express.Router();

router.get('/', taskController.list);
router.post('/', taskController.create);
router.patch('/:id/complete', taskController.complete);

module.exports = router;