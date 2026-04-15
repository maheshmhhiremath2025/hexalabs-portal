const express = require('express');
const {
  handleCreateCluster,
  handleGetClusters,
  handleGetCluster,
  handleAddStudents,
  handleRemoveStudent,
  handleDeleteCluster,
  handleScaleCluster,
} = require('../controllers/aro');

const router = express.Router();

router.post('/', handleCreateCluster);
router.get('/', handleGetClusters);
router.get('/:id', handleGetCluster);
router.post('/:id/students', handleAddStudents);
router.delete('/:id/students/:email', handleRemoveStudent);
router.delete('/:id', handleDeleteCluster);
router.patch('/:id/scale', handleScaleCluster);

module.exports = router;
