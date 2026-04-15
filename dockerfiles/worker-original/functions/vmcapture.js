require('dotenv').config();
const axios = require("axios");

const subscriptionId = process.env.SUBSCRIPTION_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const tenantId = process.env.TENANT_ID;

const getAzureToken = async () => {
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/token`;
    const response = await axios.post(tokenUrl, new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        resource: "https://management.azure.com/"
    }));
    return response.data.access_token;
};

const stopVm = async (token, vmName, resourceGroup) => {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}/deallocate?api-version=2024-07-01`;
    await axios.post(url, {}, { headers: { Authorization: `Bearer ${token}` } });
};

const createGallery = async (token, galleryName, resourceGroup, location) => {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/galleries/${galleryName}?api-version=2022-03-03`;
    const payload = { location, properties: {} };

    try {
        await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
        await axios.put(url, payload, { headers: { Authorization: `Bearer ${token}` } });
    }
};

const createImageDefinition = async (token, galleryName, imageDefinitionName, resourceGroup, location, os) => {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/galleries/${galleryName}/images/${imageDefinitionName}?api-version=2022-03-03`;
    const timestamp = Date.now();  // Ensure uniqueness

    const payload = {
        location,
        properties: {
            osType: os,
            osState: "Specialized",
            hyperVGeneration: "V2",
            identifier: {
                publisher: "synergificsoftware",
                offer: `customOffer-${timestamp}`,  // Unique offer
                sku: `customSku-${timestamp}`  // Unique SKU
            }
        }
    };

    try {
        await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
        await axios.put(url, payload, { headers: { Authorization: `Bearer ${token}` } });
    }
};

const getVmDetails = async (token, vmName, resourceGroup) => {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}?api-version=2024-07-01`;
    const response = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    return response.data.properties.storageProfile.osDisk.managedDisk.id;
};

const createImageVersion = async (token, galleryName, imageDefinitionName, resourceGroup, location, osDiskId) => {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/galleries/${galleryName}/images/${imageDefinitionName}/versions/1.0.0?api-version=2022-03-03`;

    const payload = {
        location,
        properties: {
            storageProfile: {
                osDiskImage: { source: { id: osDiskId } }
            },
            publishingProfile: {
                targetRegions: [{ name: location, regionalReplicaCount: 1 }]
            }
        }
    };

    await axios.put(url, payload, { headers: { Authorization: `Bearer ${token}` } });
};

const captureSpecializedImage = async (vmData) => {
    try {
        const { vmName, os, resourceGroup, location, organization } = vmData;
        const token = await getAzureToken();
        const galleryName = "cloudportal.co.in";
        const imageDefinitionName = `${organization}-${Date.now()}`;

        await stopVm(token, vmName, resourceGroup);
        await createGallery(token, galleryName, resourceGroup, location);
        await createImageDefinition(token, galleryName, imageDefinitionName, resourceGroup, location, os);
        const osDiskId = await getVmDetails(token, vmName, resourceGroup);
        await createImageVersion(token, galleryName, imageDefinitionName, resourceGroup, location, osDiskId);

        const imageUrl = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/galleries/${galleryName}/images/${imageDefinitionName}/versions/1.0.0`;
        return imageUrl;
    } catch (error) {
        console.error("❌ Error:", error.response?.data || error.message);
    }
};

module.exports = { captureSpecializedImage };
