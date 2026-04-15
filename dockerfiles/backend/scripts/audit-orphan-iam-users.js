#!/usr/bin/env node
/**
 * Orphan IAM User Audit
 *
 * Scans AWS IAM for users matching the lab-* pattern and cross-references
 * against the sandboxdeployments and awsusers collections in Mongo. Any
 * IAM user that has NO DB record is an orphan — created before the
 * persistence fix and never tracked.
 *
 * Usage:
 *   cd dockerfiles/backend
 *   MONGO_URI=mongodb://localhost:27017/userdb node scripts/audit-orphan-iam-users.js
 *
 * Modes:
 *   --dry-run    (default) list orphans, don't delete
 *   --delete     actually delete orphan IAM users from AWS
 *
 * The script is safe to run repeatedly — it's read-only by default.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { IAMClient, ListUsersCommand, DeleteLoginProfileCommand,
  ListAttachedUserPoliciesCommand, DetachUserPolicyCommand,
  ListUserPoliciesCommand, DeleteUserPolicyCommand, DeleteUserCommand,
} = require('@aws-sdk/client-iam');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/userdb';
const DELETE_MODE = process.argv.includes('--delete');
const LAB_PREFIX = 'lab-';

async function main() {
  console.log(`Mode: ${DELETE_MODE ? '🔴 DELETE (will remove orphan IAM users from AWS)' : '🟢 DRY RUN (list only)'}`);
  console.log('');

  // Connect to Mongo
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  // Get all known usernames from DB
  const SandboxDeployment = require('../models/sandboxDeployment');
  const awsUser = require('../models/aws');

  const deploymentUsernames = await SandboxDeployment.distinct('aws.iamUsername', { cloud: 'aws' });
  const awsUserUsernames = await awsUser.distinct('userId');
  const knownUsernames = new Set([...deploymentUsernames, ...awsUserUsernames].filter(Boolean));

  console.log(`Known in DB: ${knownUsernames.size} AWS usernames (${deploymentUsernames.length} from sandboxdeployments, ${awsUserUsernames.length} from awsusers)`);

  // List all IAM users from AWS
  const client = new IAMClient({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY,
      secretAccessKey: process.env.AWS_ACCESS_SECRET,
    },
  });

  let marker;
  const allIamUsers = [];
  do {
    const res = await client.send(new ListUsersCommand({ Marker: marker, MaxItems: 100 }));
    allIamUsers.push(...(res.Users || []));
    marker = res.IsTruncated ? res.Marker : null;
  } while (marker);

  const labUsers = allIamUsers.filter(u => u.UserName.startsWith(LAB_PREFIX));
  console.log(`IAM users matching '${LAB_PREFIX}*': ${labUsers.length} (out of ${allIamUsers.length} total)`);
  console.log('');

  // Find orphans
  const orphans = labUsers.filter(u => !knownUsernames.has(u.UserName));
  const tracked = labUsers.filter(u => knownUsernames.has(u.UserName));

  console.log(`✅ Tracked (have DB record): ${tracked.length}`);
  console.log(`⚠️  Orphaned (NO DB record): ${orphans.length}`);
  console.log('');

  if (orphans.length === 0) {
    console.log('No orphans found. All lab IAM users are tracked in the database.');
    await mongoose.disconnect();
    return;
  }

  console.log('--- ORPHAN LIST ---');
  for (const u of orphans) {
    const age = Math.round((Date.now() - new Date(u.CreateDate).getTime()) / 86400000);
    console.log(`  ${u.UserName.padEnd(50)} created ${age}d ago (${u.CreateDate.toISOString().slice(0, 10)})`);
  }
  console.log('');

  if (!DELETE_MODE) {
    console.log('To delete these orphans, run:');
    console.log('  node scripts/audit-orphan-iam-users.js --delete');
    console.log('');
    console.log('⚠️  This will permanently remove these IAM users from your AWS account.');
    await mongoose.disconnect();
    return;
  }

  // DELETE MODE
  console.log('--- DELETING ORPHANS ---');
  let deleted = 0;
  let failed = 0;

  for (const u of orphans) {
    const username = u.UserName;
    try {
      // Detach policies
      try { await client.send(new DeleteLoginProfileCommand({ UserName: username })); } catch {}
      try {
        const { AttachedPolicies } = await client.send(new ListAttachedUserPoliciesCommand({ UserName: username }));
        for (const p of AttachedPolicies || []) {
          await client.send(new DetachUserPolicyCommand({ UserName: username, PolicyArn: p.PolicyArn }));
        }
      } catch {}
      try {
        const { PolicyNames } = await client.send(new ListUserPoliciesCommand({ UserName: username }));
        for (const name of PolicyNames || []) {
          await client.send(new DeleteUserPolicyCommand({ UserName: username, PolicyName: name }));
        }
      } catch {}

      // Delete user
      await client.send(new DeleteUserCommand({ UserName: username }));
      console.log(`  ✅ Deleted: ${username}`);
      deleted++;
    } catch (err) {
      console.log(`  ❌ Failed: ${username} — ${err.message}`);
      failed++;
    }
  }

  console.log('');
  console.log(`Done. Deleted: ${deleted}, Failed: ${failed}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
