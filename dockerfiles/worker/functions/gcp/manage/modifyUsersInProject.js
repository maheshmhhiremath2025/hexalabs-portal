const { ProjectsClient } = require('@google-cloud/resource-manager');
const { logger } = require('./../../../plugins/logger'); // Using the existing logger

// Replace with the correct path to your service account key file
const keyFilename = './../../../trail-krishan-prefix-0-8f758fd2d555.json';
const credentials = require(keyFilename);

async function modifyUsersInProject(projectId, userEmails, addUser, roles) {
    const client = new ProjectsClient({
        credentials: credentials,
    });

    const resource = `projects/${projectId}`;

    try {
        // Fetch the current IAM policy
        const [policy] = await client.getIamPolicy({ resource: resource });

        // Ensure "Service Usage Admin" and "IAM Service Account User" roles are included
        const requiredRoles = [
           // 'roles/serviceUsageAdmin',
            'roles/iam.serviceAccountUser'
        ];

        requiredRoles.forEach(requiredRole => {
            if (!roles.includes(requiredRole)) {
                roles.push(requiredRole);
            }
        });

        roles.forEach(role => {
            // Find or create the role binding for each role
            let bindingIndex = policy.bindings.findIndex(b => b.role === role);
            if (bindingIndex === -1 && addUser) {
                // Role does not exist and users need to be added, create new binding
                policy.bindings.push({
                    role: role,
                    members: []
                });
                bindingIndex = policy.bindings.length - 1;
            }

            if (bindingIndex !== -1) {
                // Modify members based on addUser flag
                userEmails.forEach(userEmail => {
                    const member = `user:${userEmail}`;
                    const memberIndex = policy.bindings[bindingIndex].members.indexOf(member);
                    if (addUser && memberIndex === -1) {
                        policy.bindings[bindingIndex].members.push(member);  // Add user
                    } else if (!addUser && memberIndex !== -1) {
                        policy.bindings[bindingIndex].members.splice(memberIndex, 1);  // Remove user
                    }
                });

                // Clean up if no members left
                if (policy.bindings[bindingIndex].members.length === 0) {
                    policy.bindings.splice(bindingIndex, 1);
                }
            }
        });

        // Set the updated policy
        const [updatedPolicy] = await client.setIamPolicy({
            resource: resource,
            policy: policy,
        });

        logger.info(`${addUser ? 'Added' : 'Removed'} users ${userEmails.join(', ')} with roles ${roles.join(', ')} from project ${projectId}.`);
        return updatedPolicy;
    } catch (err) {
        logger.error('Failed to update IAM policy:', err);
        return null;
    }
}

module.exports = {
    modifyUsersInProject,
};
