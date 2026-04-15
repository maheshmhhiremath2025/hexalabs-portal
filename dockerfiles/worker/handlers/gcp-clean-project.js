const cleanupResources = require('./../functions/gcp/cleanup/additional')
const deleteBigtableInstances = require('./../functions/gcp/cleanup/bigTable')
const deleteComputeEngineVMs = require('./../functions/gcp/cleanup/compute')
const deleteFirestoreCollections = require('./../functions/gcp/cleanup/fireStore')
const deleteGKEClusters = require('./../functions/gcp/cleanup/gke')
const deleteCloudSQLInstances = require('./../functions/gcp/cleanup/sql')
const deleteCloudStorageBuckets = require('./../functions/gcp/cleanup/storage')
const {logger} = require('./../plugins/logger')
const queues = require('./../queues');

const Project = require('./../models/project')

const handler = async (job) => {
  const {projectId, instruction} = job.data;

    try {
      await deleteBigtableInstances(projectId)
      await deleteComputeEngineVMs(projectId)
      await deleteFirestoreCollections(projectId)
      await deleteGKEClusters(projectId)
      await deleteCloudSQLInstances(projectId)
      await deleteCloudStorageBuckets(projectId)
      await cleanupResources(projectId)

      const currentTime = new Date();
      const logEntry = {
          operation: "Cleanup",
          time: currentTime
      };
      await Project.findOneAndUpdate(
          { name: projectId },
          { lastClean: currentTime, $push: { logs: logEntry } }
      );
      logger.info(`Project Cleaning Completed for: ${projectId}`)

      if(instruction === "shutdown"){
        //add to remove bill que 
        await queues['gcp-remove-billing'].add(projectId)
        logger.info(`Project added to shutdown queue: ${projectId}`)
      }
      
    } catch (error) {
      logger.error(`Project Cleaning Error for ${projectId}`, error)
      return new error      
    }
  };
  
  module.exports = handler;
  
  