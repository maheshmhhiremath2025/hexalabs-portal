/**
 * Cloud Service Catalog
 *
 * Single source of truth for which AWS/Azure/GCP services GetLabs supports
 * in B2B sandbox environments, their risk tier, baseline hourly cost (INR)
 * used for quote estimation, and any restrictions we enforce.
 *
 * Risk tiers:
 *   safe       - allow with default restrictions (cheap SKUs, size caps)
 *   moderate   - allowed but flagged for review (potentially expensive)
 *   dangerous  - requires manual ops review before inclusion
 *   blocked    - never allowed in sandbox (GPUs, HPC, dedicated hosts)
 *
 * baselineHourlyInr is "light student usage" — idle-ish with short bursts.
 * It's intentionally conservative; the cost calculator applies a margin on top.
 *
 * To add a new service: drop a row here. No code deploy needed for the
 * feasibility engine or cost calculator to pick it up.
 */

const aws = {
  // --- Compute ---
  ec2:              { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 2.5,  notes: 't2/t3 micro-medium only' },
  lambda:           { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 0.2,  notes: 'default concurrency cap' },
  ecs:              { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 2.0,  notes: 'Fargate only, small tasks' },
  eks:              { category: 'Compute', riskTier: 'moderate', baselineHourlyInr: 9.0,  notes: 'control plane ~$0.10/hr, flagged for cost' },
  fargate:          { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 2.5,  notes: 'small task sizes' },
  batch:            { category: 'Compute', riskTier: 'moderate', baselineHourlyInr: 3.0,  notes: 'requires review for instance types' },
  lightsail:        { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 1.0 },
  elasticbeanstalk: { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 2.5 },
  appstream:        { category: 'Compute', riskTier: 'moderate', baselineHourlyInr: 5.0 },
  workspaces:       { category: 'Compute', riskTier: 'moderate', baselineHourlyInr: 4.0 },
  sagemaker:        { category: 'ML',      riskTier: 'dangerous', baselineHourlyInr: 15.0, notes: 'expensive by default, needs review' },
  outposts:         { category: 'Compute', riskTier: 'blocked',  baselineHourlyInr: 0,    notes: 'not offered in sandbox' },

  // --- Storage ---
  s3:               { category: 'Storage', riskTier: 'safe',     baselineHourlyInr: 0.5,  notes: 'max 50GB per bucket' },
  ebs:              { category: 'Storage', riskTier: 'safe',     baselineHourlyInr: 0.8,  notes: 'gp2/gp3 only, max 50GB' },
  efs:              { category: 'Storage', riskTier: 'safe',     baselineHourlyInr: 1.0 },
  fsx:              { category: 'Storage', riskTier: 'moderate', baselineHourlyInr: 3.5 },
  glacier:          { category: 'Storage', riskTier: 'safe',     baselineHourlyInr: 0.2 },
  storagegateway:   { category: 'Storage', riskTier: 'moderate', baselineHourlyInr: 2.0 },
  backup:           { category: 'Storage', riskTier: 'safe',     baselineHourlyInr: 0.5 },

  // --- Database ---
  rds:              { category: 'Database', riskTier: 'safe',    baselineHourlyInr: 3.0, notes: 'db.t3.micro/small only' },
  aurora:           { category: 'Database', riskTier: 'moderate', baselineHourlyInr: 6.0, notes: 'serverless v2, min capacity' },
  dynamodb:         { category: 'Database', riskTier: 'safe',    baselineHourlyInr: 0.5 },
  elasticache:      { category: 'Database', riskTier: 'moderate', baselineHourlyInr: 3.5 },
  documentdb:       { category: 'Database', riskTier: 'moderate', baselineHourlyInr: 4.0 },
  neptune:          { category: 'Database', riskTier: 'dangerous', baselineHourlyInr: 8.0 },
  redshift:         { category: 'Analytics', riskTier: 'dangerous', baselineHourlyInr: 20.0, notes: 'expensive, requires justification' },

  // --- Networking ---
  vpc:              { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 0.3 },
  route53:          { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 0.2 },
  cloudfront:       { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 0.5 },
  apigateway:       { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 0.3 },
  elb:              { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 1.5 },
  directconnect:    { category: 'Networking', riskTier: 'blocked', baselineHourlyInr: 0, notes: 'physical circuit, not for sandbox' },
  transitgateway:   { category: 'Networking', riskTier: 'moderate', baselineHourlyInr: 3.0 },
  globalaccelerator:{ category: 'Networking', riskTier: 'moderate', baselineHourlyInr: 2.5 },
  vpn:              { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 2.0 },

  // --- Security / Identity ---
  iam:              { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.1 },
  kms:              { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.2 },
  secretsmanager:   { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.3 },
  cognito:          { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.3 },
  waf:              { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.5 },
  shield:           { category: 'Security', riskTier: 'moderate', baselineHourlyInr: 1.0 },
  guardduty:        { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.5 },
  securityhub:      { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.5 },
  inspector:        { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.5 },
  macie:            { category: 'Security', riskTier: 'moderate', baselineHourlyInr: 1.5 },
  cloudhsm:         { category: 'Security', riskTier: 'blocked', baselineHourlyInr: 0, notes: 'dedicated HSM, not for sandbox' },
  acm:              { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.1 },

  // --- Messaging / Integration ---
  sns:              { category: 'Messaging', riskTier: 'safe',   baselineHourlyInr: 0.2 },
  sqs:              { category: 'Messaging', riskTier: 'safe',   baselineHourlyInr: 0.2 },
  eventbridge:      { category: 'Messaging', riskTier: 'safe',   baselineHourlyInr: 0.3 },
  stepfunctions:    { category: 'Messaging', riskTier: 'safe',   baselineHourlyInr: 0.3 },
  ses:              { category: 'Messaging', riskTier: 'safe',   baselineHourlyInr: 0.2 },

  // --- Monitoring / DevOps ---
  cloudwatch:       { category: 'Monitoring', riskTier: 'safe',  baselineHourlyInr: 0.3 },
  cloudtrail:       { category: 'Monitoring', riskTier: 'safe',  baselineHourlyInr: 0.2 },
  xray:             { category: 'Monitoring', riskTier: 'safe',  baselineHourlyInr: 0.2 },
  cloudformation:   { category: 'DevOps', riskTier: 'safe',      baselineHourlyInr: 0.2 },
  codebuild:        { category: 'DevOps', riskTier: 'safe',      baselineHourlyInr: 1.0 },
  codepipeline:     { category: 'DevOps', riskTier: 'safe',      baselineHourlyInr: 0.3 },
  ssm:              { category: 'DevOps', riskTier: 'safe',      baselineHourlyInr: 0.2 },
  config:           { category: 'DevOps', riskTier: 'safe',      baselineHourlyInr: 0.3 },
  systemsmanager:   { category: 'DevOps', riskTier: 'safe',      baselineHourlyInr: 0.2 },

  // --- Analytics / Big Data ---
  athena:           { category: 'Analytics', riskTier: 'moderate', baselineHourlyInr: 2.0 },
  glue:             { category: 'Analytics', riskTier: 'dangerous', baselineHourlyInr: 8.0 },
  kinesis:          { category: 'Analytics', riskTier: 'moderate', baselineHourlyInr: 3.0 },
  emr:              { category: 'Analytics', riskTier: 'dangerous', baselineHourlyInr: 15.0, notes: 'large clusters, needs review' },
  opensearch:       { category: 'Analytics', riskTier: 'moderate', baselineHourlyInr: 4.0 },
  quicksight:       { category: 'Analytics', riskTier: 'moderate', baselineHourlyInr: 2.0 },

  // --- Cost / Billing ---
  budgets:          { category: 'CostMgmt', riskTier: 'safe',    baselineHourlyInr: 0.0 },
  costexplorer:     { category: 'CostMgmt', riskTier: 'safe',    baselineHourlyInr: 0.0 },
};

const azure = {
  // --- Compute ---
  vm:               { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 3.0, notes: 'B-series only' },
  functions:        { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 0.2 },
  aks:              { category: 'Compute', riskTier: 'moderate', baselineHourlyInr: 8.0, notes: 'small node pool only' },
  appservice:       { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 2.0 },
  containerinstances: { category: 'Compute', riskTier: 'safe',   baselineHourlyInr: 1.5 },
  batch:            { category: 'Compute', riskTier: 'moderate', baselineHourlyInr: 3.0 },
  vmss:             { category: 'Compute', riskTier: 'moderate', baselineHourlyInr: 5.0 },
  avd:              { category: 'Compute', riskTier: 'moderate', baselineHourlyInr: 6.0 },
  servicefabric:    { category: 'Compute', riskTier: 'dangerous', baselineHourlyInr: 8.0 },

  // --- Storage ---
  blobstorage:      { category: 'Storage', riskTier: 'safe',     baselineHourlyInr: 0.4 },
  filestorage:      { category: 'Storage', riskTier: 'safe',     baselineHourlyInr: 0.6 },
  queuestorage:     { category: 'Storage', riskTier: 'safe',     baselineHourlyInr: 0.2 },
  tablestorage:     { category: 'Storage', riskTier: 'safe',     baselineHourlyInr: 0.2 },
  disks:            { category: 'Storage', riskTier: 'safe',     baselineHourlyInr: 0.7 },
  netapp:           { category: 'Storage', riskTier: 'blocked',  baselineHourlyInr: 0, notes: 'premium, not for sandbox' },

  // --- Database ---
  sqldatabase:      { category: 'Database', riskTier: 'safe',    baselineHourlyInr: 3.5, notes: 'Basic/S0 only' },
  cosmosdb:         { category: 'Database', riskTier: 'moderate', baselineHourlyInr: 5.0 },
  mysql:            { category: 'Database', riskTier: 'safe',    baselineHourlyInr: 3.0 },
  postgres:         { category: 'Database', riskTier: 'safe',    baselineHourlyInr: 3.0 },
  mariadb:          { category: 'Database', riskTier: 'safe',    baselineHourlyInr: 3.0 },
  rediscache:       { category: 'Database', riskTier: 'moderate', baselineHourlyInr: 3.0 },
  synapse:          { category: 'Analytics', riskTier: 'dangerous', baselineHourlyInr: 20.0 },
  databricks:       { category: 'Analytics', riskTier: 'dangerous', baselineHourlyInr: 18.0 },

  // --- Networking ---
  vnet:             { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 0.3 },
  loadbalancer:     { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 1.2 },
  applicationgateway:{ category: 'Networking', riskTier: 'moderate', baselineHourlyInr: 3.5 },
  frontdoor:        { category: 'Networking', riskTier: 'moderate', baselineHourlyInr: 3.0 },
  cdn:              { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 0.5 },
  dns:              { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 0.2 },
  vpngateway:       { category: 'Networking', riskTier: 'moderate', baselineHourlyInr: 2.5 },
  expressroute:     { category: 'Networking', riskTier: 'blocked', baselineHourlyInr: 0, notes: 'physical circuit' },

  // --- Security / Identity ---
  entra:            { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.1 },
  keyvault:         { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.2 },
  defender:         { category: 'Security', riskTier: 'moderate', baselineHourlyInr: 1.0 },
  sentinel:         { category: 'Security', riskTier: 'moderate', baselineHourlyInr: 2.0 },

  // --- Monitoring / DevOps ---
  monitor:          { category: 'Monitoring', riskTier: 'safe',  baselineHourlyInr: 0.3 },
  loganalytics:     { category: 'Monitoring', riskTier: 'safe',  baselineHourlyInr: 0.5 },
  appinsights:      { category: 'Monitoring', riskTier: 'safe',  baselineHourlyInr: 0.3 },
  devops:           { category: 'DevOps', riskTier: 'safe',      baselineHourlyInr: 0.2 },
  automation:       { category: 'DevOps', riskTier: 'safe',      baselineHourlyInr: 0.2 },

  // --- Integration ---
  servicebus:       { category: 'Messaging', riskTier: 'safe',   baselineHourlyInr: 0.3 },
  eventgrid:        { category: 'Messaging', riskTier: 'safe',   baselineHourlyInr: 0.2 },
  eventhub:         { category: 'Messaging', riskTier: 'moderate', baselineHourlyInr: 1.5 },
  logicapps:        { category: 'Messaging', riskTier: 'safe',   baselineHourlyInr: 0.3 },
};

const gcp = {
  // --- Compute ---
  computeengine:    { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 2.5, notes: 'e2 small only' },
  cloudfunctions:   { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 0.2 },
  cloudrun:         { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 0.5 },
  gke:              { category: 'Compute', riskTier: 'moderate', baselineHourlyInr: 8.0 },
  appengine:        { category: 'Compute', riskTier: 'safe',     baselineHourlyInr: 1.5 },
  vertexai:         { category: 'ML',      riskTier: 'dangerous', baselineHourlyInr: 15.0 },

  // --- Storage ---
  cloudstorage:     { category: 'Storage', riskTier: 'safe',     baselineHourlyInr: 0.4 },
  persistentdisk:   { category: 'Storage', riskTier: 'safe',     baselineHourlyInr: 0.6 },
  filestore:        { category: 'Storage', riskTier: 'moderate', baselineHourlyInr: 3.0 },

  // --- Database ---
  cloudsql:         { category: 'Database', riskTier: 'safe',    baselineHourlyInr: 3.5, notes: 'db-f1-micro only' },
  spanner:          { category: 'Database', riskTier: 'dangerous', baselineHourlyInr: 20.0 },
  firestore:        { category: 'Database', riskTier: 'safe',    baselineHourlyInr: 0.5 },
  bigtable:         { category: 'Database', riskTier: 'dangerous', baselineHourlyInr: 15.0 },
  memorystore:      { category: 'Database', riskTier: 'moderate', baselineHourlyInr: 3.0 },

  // --- Networking ---
  vpc:              { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 0.3 },
  cloudloadbalancing:{ category: 'Networking', riskTier: 'safe', baselineHourlyInr: 1.5 },
  clouddns:         { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 0.2 },
  cloudcdn:         { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 0.5 },
  cloudnat:         { category: 'Networking', riskTier: 'safe',  baselineHourlyInr: 0.4 },
  interconnect:     { category: 'Networking', riskTier: 'blocked', baselineHourlyInr: 0 },

  // --- Analytics ---
  bigquery:         { category: 'Analytics', riskTier: 'moderate', baselineHourlyInr: 5.0, notes: 'on-demand pricing, capped' },
  dataflow:         { category: 'Analytics', riskTier: 'dangerous', baselineHourlyInr: 10.0 },
  dataproc:         { category: 'Analytics', riskTier: 'dangerous', baselineHourlyInr: 12.0 },
  pubsub:           { category: 'Messaging', riskTier: 'safe',   baselineHourlyInr: 0.3 },

  // --- Security ---
  iam:              { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.1 },
  kms:              { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.2 },
  secretmanager:    { category: 'Security', riskTier: 'safe',    baselineHourlyInr: 0.2 },
  securitycommandcenter: { category: 'Security', riskTier: 'moderate', baselineHourlyInr: 1.0 },

  // --- DevOps / Monitoring ---
  cloudmonitoring:  { category: 'Monitoring', riskTier: 'safe',  baselineHourlyInr: 0.3 },
  cloudlogging:     { category: 'Monitoring', riskTier: 'safe',  baselineHourlyInr: 0.3 },
  cloudbuild:       { category: 'DevOps', riskTier: 'safe',      baselineHourlyInr: 0.5 },
  artifactregistry: { category: 'DevOps', riskTier: 'safe',      baselineHourlyInr: 0.3 },
};

/**
 * Per-provider flat overhead per seat (IAM user, CloudTrail/Activity logs,
 * minimal default storage). Added once on top of module-based costs.
 */
const baselinePerSeatInr = {
  aws: 20,
  azure: 18,
  gcp: 18,
};

/**
 * Services we default-deny even when they aren't in the course.
 * Used by the template generator to harden the sandbox policy.
 */
const defaultDenyList = {
  aws: ['sagemaker', 'redshift', 'emr', 'glue', 'neptune', 'cloudhsm', 'outposts', 'directconnect'],
  azure: ['synapse', 'databricks', 'expressroute', 'netapp', 'servicefabric'],
  gcp: ['spanner', 'bigtable', 'dataflow', 'dataproc', 'vertexai', 'interconnect'],
};

/**
 * Default allowed instance types for each provider.
 */
const defaultAllowedInstanceTypes = {
  aws: ['t2.micro', 't2.small', 't3.micro', 't3.small', 't3.medium'],
  azure: ['Standard_B1s', 'Standard_B1ms', 'Standard_B2s', 'Standard_B2ms'],
  gcp: ['e2-micro', 'e2-small', 'e2-medium', 'e2-standard-2'],
};

/**
 * Preferred region per provider (South India / Mumbai).
 */
const defaultRegions = {
  aws: 'ap-south-1',
  azure: 'southindia',
  gcp: 'asia-south1',
};

module.exports = {
  catalog: { aws, azure, gcp },
  baselinePerSeatInr,
  defaultDenyList,
  defaultAllowedInstanceTypes,
  defaultRegions,
};
