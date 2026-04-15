export const apiOpenRoutes = {
    dashboardApi: `/admin/dashboard`
};

export const apiRoutes = {
    loginApi: `/user/login`,
    logoutApi: `/user/logout`,
    trainingNameApi: `/azure/trainingName`,
    userTagApi: `/admin/organization`,
    machineApi: `/azure/machines`,
    restartLabsApi: `/azure/machinesRestart`,
    billingApi: `/azure/billing`,
    vmNamesApi: `/azure/vmnames`,
    getLogsApi: `/azure/logs`,
    portsApi: `/azure/ports`,
    schedulesApi: `/azure/schedules`,
    templatesApi: `/azure/templates`,
    killTrainingApi: `/azure/killTraining`,
    accountApi: `/admin/ledger/accounts`, // ✅ Keep this one
    ledgerApi: `/admin/ledger`,
    orderApi: `/admin/ledger/order`,
    addTransaction: `/admin/ledger/addTransaction`,
    paymentVerifyApi: `/admin/ledger/paymentVerify`,
    myUserApi: `/admin/myuser`,
    captureVmApi: `/admin/capture`,
    sandboxApi: `/sandbox/azure`,
    transactionApi: `/admin/ledger/transactions`,

    // ✅ NEW: used by Account.jsx to download invoice PDFs
    // Pattern with :id is supported by the component; backend should return application/pdf
    downloadInvoiceApi: `/admin/ledger/invoice/pdf/:id`
};

export const containerApiRoutes = {
    containers: `/containers`,
    createContainer: `/containers/create`,
    startContainers: `/containers/start`,
    stopContainers: `/containers/stop`,
    deleteContainers: `/containers`,
    containerImages: `/containers/images`,
    costCompare: `/containers/cost-compare`,
};

export const costApiRoutes = {
    costOverview: `/admin/costs/overview`,
    costSummary: `/admin/costs/summary`,
    costLab: `/admin/costs/lab`,
    costOrgLabs: `/admin/costs/labs`,
    costSync: `/admin/costs/sync`,
    costSyncLab: `/admin/costs/sync-lab`,
};

export const superadminApiRoutes = {
    logsApi: `/admin/logs`,
    usersApi: `/admin/users`,
    organizationApi: `/admin/organization`,
    templatesApi: `/admin/template`,
    assignTemplatesApi: `/admin/assignTemplate`,
    quotaApi: `/admin/quota`,
    sandboxUserApi: `/sandbox/user`,
    awsUserApi: `/aws/user`
};

export const gcpUserApiRoutes = {
    trainingApi: `/gcp/training`,
    projectsApi: `/gcp/projects`,
    getLogsApi: `/open/gcpLogs`
};
