const express = require('express');
const router = express.Router();
const { handleCreateImage, handleListImages, handlePullImage, handleDeleteImage } = require('../controllers/customImage');

router.post('/', handleCreateImage);
router.get('/', handleListImages);
router.post('/pull', handlePullImage);
router.delete('/', handleDeleteImage);

module.exports = router;
