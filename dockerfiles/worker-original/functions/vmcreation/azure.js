require('dotenv').config()
const { ClientSecretCredential} = require("@azure/identity");
const { ComputeManagementClient} = require('@azure/arm-compute');
const { NetworkManagementClient } = require("@azure/arm-network");

const subscriptionId = process.env.SUBSCRIPTION_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const tenantId = process.env.TENANT_ID;

const subnetName = 'default2';
const adminUsername = 'labuser';
const adminPassword = 'Welcome1234!';

const credentials = new ClientSecretCredential(tenantId, clientId, clientSecret);

const computeClient = new ComputeManagementClient(credentials, subscriptionId);
const networkClient = new NetworkManagementClient(credentials, subscriptionId);

// rate Useremail usetag, trainingName, allocated hours os
async function createVirtualMachine(vmName, vmTemplate) {
    const {location, imageId, resourceGroup, vmSize, vnet, licence, official, planPublisher, product, version} = vmTemplate;
    const nicName = vmName + "-nic";
    const publicIpName = vmName + "-public-IP";
    const publicIpParameters = {
        location: location,
        publicIPAllocationMethod: "Static"
    };
    
    try {
        // Creating and storing public IP
        const PublicIpResponse = await networkClient.publicIPAddresses.beginCreateOrUpdate(resourceGroup, publicIpName, publicIpParameters);
        const publicIp = await PublicIpResponse.pollUntilDone();

        // Get vnet and subnet
        const virtualNetwork = await networkClient.virtualNetworks.get(resourceGroup, vnet);
        const subnet = virtualNetwork.subnets.find(subnet => subnet.name === subnetName);

        // Create and store NIC
        const nicParameters = {
            location: location,
            ipConfigurations: [{
                name: 'ipConfig1',
                privateIPAllocationMethod: "Dynamic",
                subnet: {
                    id: subnet.id
                },
                publicIpAddress: {
                    id: publicIp.id
                }
            }]
        }
        const nicResponse = await networkClient.networkInterfaces.beginCreateOrUpdate(resourceGroup, nicName, nicParameters);
        const nic = await nicResponse.pollUntilDone();

        // Create NSG and associate it with NIC
        await createNSGAndAssociate(vmName, resourceGroup, location, nicName, publicIp, subnet);

        // Initialize VM parameters
        let vmParameters = {
            location: location,
            hardwareProfile: {
                vmSize: vmSize,
            },
            storageProfile: {
                osDisk: {
                    createOption: 'FromImage',
                    managedDisk: {
                        storageAccountType: 'StandardSSD_LRS'
                    }
                },
                imageReference: official ? null : { // Only set imageReference if not using a custom captured image
                    id: imageId,
                }
            },
            networkProfile: {
                networkInterfaces: [
                    {
                        id: nic.id,
                    },
                ],
            },
            securityProfile: {
                secureBootEnabled: true,
                virtualTpmEnabled: true,
                integrityMonitoringEnabled: true
            },
            priority: 'Spot',
            evictionPolicy: 'Deallocate',
            billingProfile: {
                maxPrice: 2.0
            }
        };

        if (official) {
            // If using a captured custom image, set the imageId directly and avoid plan details
            vmParameters.storageProfile.imageReference = { id: imageId };

           

            // Plan details are only necessary if the image is a marketplace image, not a captured one
            if (planPublisher && product) {
                vmParameters.plan = {
                    publisher: planPublisher,
                    product: product,
                    name: product
                };
            }
        }

        if (licence !== "none") {
            vmParameters.licenseType = licence;
             // Add OS profile for official images (customized marketplace images)
           
            
        }

        // Create the VM
        const vmResponse = await computeClient.virtualMachines.beginCreateOrUpdate(resourceGroup, vmName, vmParameters);
        const vmResult = await vmResponse.pollUntilDone();
        
        // Fetch the public IP address
        const vmPublicIpAddress = await getPublicIpAddress(resourceGroup, publicIpName);

        // Return VM details
        const vmInformation = {
            vmName: vmName,
            publicIpAddress: vmPublicIpAddress,
            resourceGroup: resourceGroup, 
            adminUsername: adminUsername,
            adminPassword: adminPassword
        };
        return vmInformation;
        
    } catch (error) {
        console.log(`Error creating VM: ${vmName}`, error);
        return null;
    }
}


async function getPublicIpAddress(resourceGroup, publicIpName) {
    const publicIp = await networkClient.publicIPAddresses.get(resourceGroup, publicIpName);
    return publicIp.ipAddress;
}

async function createNSGAndAssociate (vmName, resourceGroup, location, nicName, publicIp, subnet){
    const nsgName = `${vmName}-nsg`;

    const nsgParameters = {
        location: location,
        securityRules: [
            {
                name: 'allow-22',
                priority: 1000,
                direction: 'Inbound',
                access: 'Allow',
                protocol: 'Tcp',
                sourcePortRange: '*',
                sourceAddressPrefix: '*',
                destinationPortRange: '22',
                destinationAddressPrefix: '*'
            },
            {
                name: 'allow-3389',
                priority: 1001,
                direction: 'Inbound',
                access: 'Allow',
                protocol: 'Tcp',
                sourcePortRange: '*',
                sourceAddressPrefix: '*',
                destinationPortRange: '3389',
                destinationAddressPrefix: '*'
            }
        ]
    };
    const nsgResponse = await networkClient.networkSecurityGroups.beginCreateOrUpdate(resourceGroup, nsgName, nsgParameters);
    const nsg = await nsgResponse.pollUntilDone();
    const ipConfiguration = {
        name: 'ipConfig1',
        privateIPAllocationMethod: 'Dynamic',
        subnet: {
            id: subnet.id
        },
        publicIPAddress: {
            id: publicIp.id
        }
    };

    const nicUpdateParameters = {
        location: location,
        ipConfigurations: [ipConfiguration],
        networkSecurityGroup: {
            id: nsg.id
        }
    };

    const nicUpdateResponse = await networkClient.networkInterfaces.beginCreateOrUpdate(resourceGroup, nicName, nicUpdateParameters);
    await nicUpdateResponse.pollUntilDone();
}

module.exports = {createVirtualMachine};
