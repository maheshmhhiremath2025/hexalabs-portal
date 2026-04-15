const nodemailer = require('nodemailer');
const VM = require('../models/vm');
const Container = require('../models/container');
const { logger } = require('../plugins/logger');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

const FROM = `"Synergific Cloud Portal" <${process.env.GMAIL_USER}>`;

const CC_RECIPIENTS = 'itops@synergificsoftware.com, vinay.chandra@synergificsoftware.com';

async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({ from: FROM, to, cc: CC_RECIPIENTS, subject, html });
    logger.info(`Email sent to ${to}: ${subject}`);
  } catch (err) {
    logger.error(`Email failed to ${to}: ${err.message}`);
  }
}

/**
 * Notify user when their VM/container is ready.
 */
async function notifyInstanceReady({ email, name, type, accessUrl, password, organization, trainingName }) {
  const subject = `Your ${type === 'container' ? 'Container' : 'VM'} is Ready - ${name}`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #11192a; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="color: white; margin: 0; font-size: 18px;">GetLabs Cloud Portal</h2>
      </div>
      <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="color: #374151; margin: 0 0 16px;">Hi,</p>
        <p style="color: #374151; margin: 0 0 16px;">
          Your <strong>${type === 'container' ? 'container' : 'virtual machine'}</strong> is ready to use.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Instance</td><td style="padding: 8px 0; font-weight: 600; color: #111827;">${name}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Organization</td><td style="padding: 8px 0; color: #111827;">${organization}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Training</td><td style="padding: 8px 0; color: #111827;">${trainingName}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Password</td><td style="padding: 8px 0; font-family: monospace; color: #111827;">${password}</td></tr>
        </table>
        ${accessUrl ? `<a href="${accessUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 8px;">Open Desktop</a>` : ''}
        <p style="color: #9ca3af; font-size: 12px; margin: 24px 0 0;">This is an automated message from GetLabs Cloud Portal.</p>
      </div>
    </div>`;
  await sendEmail(email, subject, html);
}

/**
 * Notify user when quota is running low (80%+).
 */
async function notifyQuotaLow({ email, name, consumed, total, organization }) {
  const pct = Math.round((consumed / total) * 100);
  const subject = `Quota Alert: ${name} at ${pct}% usage`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #f59e0b; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="color: white; margin: 0; font-size: 18px;">Quota Warning</h2>
      </div>
      <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="color: #374151;">Your instance <strong>${name}</strong> has used <strong>${pct}%</strong> of its allocated quota.</p>
        <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="color: #6b7280; font-size: 14px;">Used</span>
            <span style="font-weight: 600;">${consumed.toFixed(1)} hours</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #6b7280; font-size: 14px;">Total</span>
            <span style="font-weight: 600;">${total} hours</span>
          </div>
          <div style="background: #e5e7eb; height: 8px; border-radius: 4px; margin-top: 12px; overflow: hidden;">
            <div style="background: ${pct > 90 ? '#ef4444' : '#f59e0b'}; height: 100%; width: ${pct}%; border-radius: 4px;"></div>
          </div>
        </div>
        <p style="color: #6b7280; font-size: 13px;">Contact your administrator to increase quota if needed.</p>
      </div>
    </div>`;
  await sendEmail(email, subject, html);
}

/**
 * Notify user when VM was auto-stopped due to idle.
 */
async function notifyAutoShutdown({ email, name, idleMinutes, organization }) {
  const subject = `Auto-Stopped: ${name} (idle for ${idleMinutes} min)`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #6b7280; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="color: white; margin: 0; font-size: 18px;">Instance Auto-Stopped</h2>
      </div>
      <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="color: #374151;">Your instance <strong>${name}</strong> was automatically stopped because it was idle for ${idleMinutes} minutes.</p>
        <p style="color: #374151;">This saves costs while the instance is not in use. You can restart it anytime from the Lab Console.</p>
        <p style="color: #9ca3af; font-size: 12px; margin: 24px 0 0;">Auto-shutdown is enabled for this instance. Contact your admin to change this setting.</p>
      </div>
    </div>`;
  await sendEmail(email, subject, html);
}

/**
 * Cron: Check all running VMs for quota warnings.
 * Sends email at 80% and 95% usage thresholds.
 */
async function checkQuotaWarnings() {
  try {
    const vms = await VM.find({ isAlive: true, isRunning: true, 'quota.total': { $gt: 0 } });

    for (const vm of vms) {
      const pct = (vm.quota.consumed / vm.quota.total) * 100;

      // Send warning at 80% (check if we haven't already by looking at remarks)
      if (pct >= 80 && pct < 95 && !vm.remarks?.includes('Quota80')) {
        await notifyQuotaLow({ email: vm.email, name: vm.name, consumed: vm.quota.consumed, total: vm.quota.total, organization: vm.organization });
        vm.remarks = (vm.remarks || '') + ' | Quota80';
        await vm.save();
      }

      // Critical warning at 95%
      if (pct >= 95 && !vm.remarks?.includes('Quota95')) {
        await notifyQuotaLow({ email: vm.email, name: vm.name, consumed: vm.quota.consumed, total: vm.quota.total, organization: vm.organization });
        vm.remarks = (vm.remarks || '') + ' | Quota95';
        await vm.save();
      }
    }
  } catch (err) {
    logger.error(`Quota warning check error: ${err.message}`);
  }
}

/**
 * Send a full lab welcome email to a student with credentials, what's
 * installed, quick-start commands, and lab duration.
 *
 * Adapts the "What's installed" and "Quick start" sections based on the
 * container image category/key. bigdata images get Kafka/Spark/MySQL guides,
 * kali images get pentest tool guides, etc.
 *
 * Called automatically from handleCreateContainers after each container is
 * created (if the student email is provided).
 */
async function notifyLabWelcomeEmail({
  email, name, accessUrl, password, organization, trainingName,
  imageKey, imageLabel, hostIp, sshPort, vncPort, expiresAt, cpus, memoryMb,
}) {
  const expiresStr = expiresAt
    ? new Date(expiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
    : 'Contact your trainer';

  // Build the "What's installed" section based on image type.
  // If the image is bigdata, show Kafka/Spark/MySQL/Cassandra.
  // For kali, show pentest tools. For general: just the OS.
  const isBigData = (imageKey || '').includes('bigdata');
  const isCassandra = (imageKey || '').includes('cassandra');
  const isKali = (imageKey || '').includes('kali');
  const isJupyter = (imageKey || '').includes('jupyter');
  const isRds = (imageKey || '').includes('rds') || (imageKey || '').includes('windows');

  let installedSection = '';
  let quickStartSection = '';

  if (isRds) {
    installedSection = `
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">OS</td><td style="padding:4px 12px;font-size:13px;color:#111;">Windows Server 2022</td></tr>
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">Access</td><td style="padding:4px 12px;font-size:13px;color:#111;">RDP (Remote Desktop) or Browser via Guacamole</td></tr>
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">Session</td><td style="padding:4px 12px;font-size:13px;color:#111;">Isolated RDS session — your own desktop, other users can't see your work</td></tr>
    `;
    quickStartSection = `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0;">
        <div style="font-weight:600;color:#166534;font-size:14px;margin-bottom:10px;">How to connect</div>
        <div style="font-size:13px;color:#374151;line-height:1.8;">
          <div><strong>Option 1 — Browser (recommended):</strong> Click "Open in Browser" from the Lab Console in the portal. No software needed.</div>
          <div style="margin-top:8px;"><strong>Option 2 — RDP client:</strong></div>
          <div style="font-family:monospace;font-size:12px;margin-top:4px;">
            <div>Host: ${hostIp}</div>
            <div>Port: 3389</div>
            <div>Username: ${password ? name.split(' — ')[1] || 'labuser' : 'labuser'}</div>
            <div>Password: ${password}</div>
          </div>
          <div style="margin-top:8px;color:#6b7280;font-size:12px;">On Windows: search "Remote Desktop Connection". On Mac: install "Microsoft Remote Desktop" from the App Store.</div>
        </div>
      </div>
    `;
  } else if (isBigData) {
    installedSection = `
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">Java</td><td style="padding:4px 12px;font-size:13px;color:#111;">JDK 17 (Eclipse Temurin)</td></tr>
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">Python</td><td style="padding:4px 12px;font-size:13px;color:#111;">3.10 + pip + PySpark</td></tr>
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">Kafka</td><td style="padding:4px 12px;font-size:13px;color:#111;">3.7 (KRaft) on localhost:9092</td></tr>
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">Spark</td><td style="padding:4px 12px;font-size:13px;color:#111;">3.5.1 + spark-submit + pyspark</td></tr>
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">MySQL</td><td style="padding:4px 12px;font-size:13px;color:#111;">8.0 on localhost:3306 (db: labdb)</td></tr>
      ${isCassandra ? '<tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">Cassandra</td><td style="padding:4px 12px;font-size:13px;color:#111;">4.1.5 on localhost:9042</td></tr>' : ''}
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">Tools</td><td style="padding:4px 12px;font-size:13px;color:#111;">git, vim, tmux, htop, curl, wget</td></tr>
    `;
    quickStartSection = `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0;">
        <div style="font-weight:600;color:#166534;font-size:14px;margin-bottom:10px;">Quick start commands</div>
        <div style="font-family:monospace;font-size:12px;color:#374151;line-height:1.8;">
          <div><span style="color:#9ca3af;">#</span> Verify everything works:</div>
          <div>java -version && python3 --version</div>
          <div>kafka-topics.sh --version</div>
          <div>spark-submit --version 2>&1 | head -2</div>
          <div>mysql -ulab -p${password} -e "SELECT 1"</div>
          ${isCassandra ? '<div>cqlsh -e "DESCRIBE KEYSPACES"</div>' : ''}
          <div style="margin-top:8px;"><span style="color:#9ca3af;">#</span> Create a Kafka topic:</div>
          <div>kafka-topics.sh --bootstrap-server localhost:9092 --create --topic test --partitions 3</div>
          <div style="margin-top:8px;"><span style="color:#9ca3af;">#</span> Spark interactive shell:</div>
          <div>pyspark    <span style="color:#9ca3af;"># Python</span></div>
          <div>spark-shell  <span style="color:#9ca3af;"># Scala</span></div>
          <div style="margin-top:8px;"><span style="color:#9ca3af;">#</span> MySQL:</div>
          <div>mysql -ulab -p${password} labdb</div>
          <div style="margin-top:8px;"><span style="color:#9ca3af;">#</span> Service control:</div>
          <div>sudo supervisorctl status</div>
        </div>
      </div>
    `;
  } else if (isKali) {
    installedSection = `
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">OS</td><td style="padding:4px 12px;font-size:13px;color:#111;">Kali Linux (rolling)</td></tr>
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">Tools</td><td style="padding:4px 12px;font-size:13px;color:#111;">Nmap, Metasploit, Burp Suite, Wireshark, SQLMap, Hydra, John, Nikto, Dirb</td></tr>
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">Languages</td><td style="padding:4px 12px;font-size:13px;color:#111;">Python 3, Ruby, Perl</td></tr>
    `;
  } else if (isJupyter) {
    installedSection = `
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">Jupyter</td><td style="padding:4px 12px;font-size:13px;color:#111;">JupyterLab (browser-based notebooks)</td></tr>
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">Python libs</td><td style="padding:4px 12px;font-size:13px;color:#111;">NumPy, Pandas, SciPy, scikit-learn, Matplotlib</td></tr>
    `;
  } else {
    installedSection = `
      <tr><td style="padding:4px 12px;color:#6b7280;font-size:13px;">OS</td><td style="padding:4px 12px;font-size:13px;color:#111;">${imageLabel || 'Linux Desktop'}</td></tr>
    `;
  }

  const subject = `[GetLabs] ${trainingName || name} — Your Lab Environment is Ready to Use`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#374151;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#11192a 0%,#1e3a5f 100%);padding:24px 28px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;font-weight:700;">Your Lab is Ready</h1>
        <p style="color:#93c5fd;margin:6px 0 0;font-size:14px;">${trainingName || 'GetLabs Cloud Training'}</p>
      </div>

      <!-- Body -->
      <div style="padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;background:white;">
        <p style="margin:0 0 20px;font-size:15px;">Hi, your training environment is provisioned and ready to use. Just click the button below to open your lab — no setup, no installs.</p>

        <!-- Access button -->
        <div style="text-align:center;margin:24px 0;">
          <a href="${accessUrl}" style="display:inline-block;background:#2563eb;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.3px;">
            Open Lab in Browser
          </a>
        </div>

        <!-- Credentials table -->
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin:20px 0;">
          <div style="padding:10px 16px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">
            Your Credentials
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 16px;color:#6b7280;font-size:13px;width:120px;">Access URL</td><td style="padding:8px 16px;font-size:13px;"><a href="${accessUrl}" style="color:#2563eb;">${accessUrl}</a></td></tr>
            <tr style="background:#f9fafb;"><td style="padding:8px 16px;color:#6b7280;font-size:13px;">Username</td><td style="padding:8px 16px;font-size:13px;font-weight:600;">lab</td></tr>
            <tr><td style="padding:8px 16px;color:#6b7280;font-size:13px;">Password</td><td style="padding:8px 16px;font-family:monospace;font-size:14px;font-weight:600;letter-spacing:0.5px;">${password}</td></tr>
            ${sshPort ? `<tr style="background:#f9fafb;"><td style="padding:8px 16px;color:#6b7280;font-size:13px;">SSH</td><td style="padding:8px 16px;font-family:monospace;font-size:12px;">ssh lab@${hostIp} -p ${sshPort}</td></tr>` : ''}
            <tr><td style="padding:8px 16px;color:#6b7280;font-size:13px;">Lab expires</td><td style="padding:8px 16px;font-size:13px;color:#b91c1c;font-weight:600;">${expiresStr}</td></tr>
          </table>
        </div>

        <!-- What's installed -->
        ${installedSection ? `
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin:20px 0;">
          <div style="padding:10px 16px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">
            What's Pre-installed
          </div>
          <table style="width:100%;border-collapse:collapse;">
            ${installedSection}
          </table>
        </div>
        ` : ''}

        <!-- Quick start -->
        ${quickStartSection}

        <!-- Troubleshooting -->
        <div style="margin:20px 0;padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
          <div style="font-weight:600;color:#92400e;font-size:13px;margin-bottom:6px;">If something isn't working:</div>
          <ol style="margin:0;padding-left:18px;font-size:12px;color:#78350f;line-height:1.7;">
            <li>Run <code style="background:#fef3c7;padding:2px 4px;border-radius:3px;">sudo supervisorctl status</code> — all services should say RUNNING</li>
            <li>Restart any stopped service: <code style="background:#fef3c7;padding:2px 4px;border-radius:3px;">sudo supervisorctl restart kafka</code></li>
            <li>If the terminal tab disconnects, just refresh the browser — your session is preserved</li>
            <li>If nothing helps, reply to this email</li>
          </ol>
        </div>

        <p style="color:#9ca3af;font-size:11px;margin:24px 0 0;padding-top:16px;border-top:1px solid #f3f4f6;">
          This is an automated message from GetLabs Cloud Portal · ${organization || ''}
        </p>
      </div>
    </div>`;

  await sendEmail(email, subject, html);
}

/**
 * Send a deployment summary email to ops after a batch of containers are
 * created. Includes a credentials table with all N containers so ops has
 * a single reference document.
 */
async function notifyOpsDeploySummary({
  opsEmail, trainingName, organization, imageLabel,
  containers, // [{ name, email, accessUrl, password, sshPort }]
}) {
  const subject = `[GetLabs] Deploy Complete — ${trainingName} (${containers.length} seat${containers.length === 1 ? '' : 's'})`;

  const rows = containers.map((c, i) => `
    <tr style="border-bottom:1px solid #f3f4f6;${i % 2 ? 'background:#f9fafb;' : ''}">
      <td style="padding:6px 10px;font-size:12px;color:#6b7280;">${i + 1}</td>
      <td style="padding:6px 10px;font-size:12px;">${c.email || '—'}</td>
      <td style="padding:6px 10px;font-size:12px;"><a href="${c.accessUrl}" style="color:#2563eb;">${c.accessUrl}</a></td>
      <td style="padding:6px 10px;font-size:12px;font-family:monospace;">${c.password}</td>
      <td style="padding:6px 10px;font-size:12px;font-family:monospace;">${c.sshPort || '—'}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:700px;margin:0 auto;">
      <div style="background:#11192a;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="color:white;margin:0;font-size:18px;">Batch Deploy Complete</h2>
        <p style="color:#93c5fd;margin:4px 0 0;font-size:13px;">${trainingName} · ${organization} · ${containers.length} containers · ${imageLabel || ''}</p>
      </div>
      <div style="padding:20px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">All ${containers.length} containers are running. Below is the master credentials table. Welcome emails have been sent to each student email (where provided).</p>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f3f4f6;">
                <th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">#</th>
                <th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">Student</th>
                <th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">URL</th>
                <th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">Password</th>
                <th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">SSH Port</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
        <p style="color:#9ca3af;font-size:11px;margin:20px 0 0;">This is your ops record. Keep it handy for support requests during the training.</p>
      </div>
    </div>`;

  await sendEmail(opsEmail, subject, html);
}

/**
 * Send a welcome onboarding email to a student when their cloud sandbox is provisioned.
 * Includes portal login credentials + cloud sandbox credentials.
 */
async function notifySandboxWelcomeEmail({
  email, cloud, portalUrl, portalPassword,
  sandboxUsername, sandboxPassword, sandboxAccessUrl,
  region, expiresAt, templateName,
  allowedServices = [], blockedServices = [],
  compartmentName, resourceGroupName, projectId,
}) {
  const cloudLabel = { aws: 'Amazon Web Services (AWS)', azure: 'Microsoft Azure', gcp: 'Google Cloud Platform (GCP)', oci: 'Oracle Cloud Infrastructure (OCI)' }[cloud] || cloud.toUpperCase();
  const cloudColor = { aws: '#FF9900', azure: '#0078D4', gcp: '#4285F4', oci: '#F80000' }[cloud] || '#2563EB';
  const cloudBgGradient = {
    aws: 'linear-gradient(135deg, #232F3E 0%, #FF9900 100%)',
    azure: 'linear-gradient(135deg, #0078D4 0%, #00BCF2 100%)',
    gcp: 'linear-gradient(135deg, #4285F4 0%, #34A853 100%)',
    oci: 'linear-gradient(135deg, #312D2A 0%, #F80000 100%)',
  }[cloud] || `linear-gradient(135deg, ${cloudColor}, #1e293b)`;
  const cloudBadgeColor = { aws: '#FF9900', azure: '#00BCF2', gcp: '#34A853', oci: '#F80000' }[cloud] || '#2563EB';
  const cloudShortLabel = { aws: 'AWS', azure: 'AZURE', gcp: 'GCP', oci: 'OCI' }[cloud] || cloud.toUpperCase();
  const expiresStr = expiresAt ? new Date(expiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : 'Contact your administrator';
  const portalLink = portalUrl || 'https://portal.synergificsoftware.com';

  const cloudResource = compartmentName ? `Compartment: ${compartmentName}` :
                        resourceGroupName ? `Resource Group: ${resourceGroupName}` :
                        projectId ? `Project: ${projectId}` : '';

  const allowedList = allowedServices.slice(0, 10).map(s =>
    `<li style="padding:2px 0;font-size:13px;color:#374151;">${s.service || s}${s.restrictions ? ` <span style="color:#9ca3af;">(${s.restrictions})</span>` : ''}</li>`
  ).join('');

  const blockedList = blockedServices.slice(0, 6).map(s =>
    `<li style="padding:2px 0;font-size:13px;color:#374151;">${s.service || s}${s.reason ? ` <span style="color:#9ca3af;">- ${s.reason}</span>` : ''}</li>`
  ).join('');

  const subject = `Welcome to ${templateName || 'Cloud Lab'} - Your ${cloudLabel} Sandbox is Ready`;

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
    <!-- Header -->
    <div style="background:${cloudBgGradient};border-radius:12px 12px 0 0;padding:32px 24px;text-align:center;">
      <div style="display:inline-block;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);border-radius:20px;padding:4px 14px;margin-bottom:12px;">
        <span style="font-size:11px;font-weight:700;color:#ffffff;letter-spacing:1.5px;">${cloudShortLabel}</span>
      </div>
      <div style="font-size:24px;font-weight:700;color:#ffffff;margin-bottom:4px;">Welcome to Your Cloud Lab</div>
      <div style="font-size:14px;color:rgba(255,255,255,0.85);">${templateName || 'Cloud Training Sandbox'}</div>
    </div>

    <!-- Body -->
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">

      <div style="font-size:15px;color:#374151;line-height:1.6;margin-bottom:20px;">
        Hi ${email.split('@')[0]},<br><br>
        Your <strong>${cloudLabel}</strong> sandbox has been provisioned and is ready to use. Below are your login credentials for both the training portal and the cloud console.
      </div>

      <!-- Step 1: Portal Login -->
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:16px;">
        <div style="font-weight:600;color:#1e40af;font-size:14px;margin-bottom:10px;">Step 1 - Log in to the Training Portal</div>
        <table style="width:100%;font-size:13px;">
          <tr><td style="padding:4px 0;color:#6b7280;width:100px;">Portal URL</td><td style="color:#111;"><a href="${portalLink}" style="color:#2563eb;">${portalLink}</a></td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Email</td><td style="color:#111;font-family:monospace;">${email}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Password</td><td style="color:#111;font-family:monospace;font-weight:600;">${portalPassword}</td></tr>
        </table>
        <div style="font-size:11px;color:#6b7280;margin-top:8px;">After logging in, go to "My Sandboxes" to view your cloud credentials, allowed services, and expiry timer.</div>
      </div>

      <!-- Step 2: Cloud Console -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="display:inline-block;background:${cloudColor};color:#ffffff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;letter-spacing:0.5px;">${cloudShortLabel}</span>
          <span style="font-weight:600;color:#166534;font-size:14px;">Step 2 - Access Your ${cloudLabel} Console</span>
        </div>
        <table style="width:100%;font-size:13px;">
          <tr><td style="padding:4px 0;color:#6b7280;width:100px;">Console URL</td><td style="color:#111;"><a href="${sandboxAccessUrl}" style="color:#2563eb;">${sandboxAccessUrl}</a></td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Username</td><td style="color:#111;font-family:monospace;">${sandboxUsername}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Password</td><td style="color:#111;font-family:monospace;font-weight:600;">${sandboxPassword}</td></tr>
          ${region ? `<tr><td style="padding:4px 0;color:#6b7280;">Region</td><td style="color:#111;">${region}</td></tr>` : ''}
          ${cloudResource ? `<tr><td style="padding:4px 0;color:#6b7280;">Resource</td><td style="color:#111;font-family:monospace;font-size:12px;">${cloudResource}</td></tr>` : ''}
        </table>
      </div>

      <!-- Expiry -->
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
        <div style="font-size:13px;color:#92400e;">
          <strong>Lab Expires:</strong> ${expiresStr} IST<br>
          <span style="font-size:12px;">All resources will be automatically cleaned up at this time. Save your work before expiry.</span>
        </div>
      </div>

      ${allowedList ? `
      <!-- Allowed Services -->
      <div style="margin-bottom:12px;">
        <div style="font-weight:600;font-size:13px;color:#374151;margin-bottom:6px;">Allowed Services</div>
        <ul style="margin:0;padding-left:18px;list-style-type:none;">
          ${allowedList}
        </ul>
      </div>` : ''}

      ${blockedList ? `
      <!-- Restricted Services -->
      <div style="margin-bottom:16px;">
        <div style="font-weight:600;font-size:13px;color:#374151;margin-bottom:6px;">Restricted Services</div>
        <ul style="margin:0;padding-left:18px;list-style-type:none;">
          ${blockedList}
        </ul>
        <div style="font-size:11px;color:#9ca3af;margin-top:4px;">These services are restricted to control costs. Contact your administrator if you need access.</div>
      </div>` : ''}

      <!-- Footer -->
      <div style="border-top:1px solid #e5e7eb;padding-top:16px;text-align:center;">
        <div style="font-size:12px;color:#9ca3af;">
          Need help? Reply to this email or contact your trainer.<br>
          <strong>Synergific Cloud Portal</strong> - Enterprise Cloud Training Labs
        </div>
      </div>
    </div>
  </div>`;

  await sendEmail(email, subject, html);
}

/**
 * Universal branded welcome email for all resource types:
 * VM, workspace (container), windows-desktop (RDS), ROSA, ARO.
 *
 * Each type gets its own gradient header, badge, and access instructions.
 */
async function notifyResourceWelcomeEmail({
  email, resourceType,
  portalPassword,
  accessUrl, accessUsername, accessPassword,
  resourceName, trainingName, organization, imageLabel,
  cpus, memoryMb,
  expiresAt,
  hostIp, sshPort, vncPort,
  clusterName, namespace, consoleUrl,
}) {
  // -- branding per resource type ----------------------------------------
  const brandMap = {
    vm: {
      gradient: 'linear-gradient(135deg, #0078D4 0%, #00BCF2 100%)',
      badge: 'VM',
      label: 'Virtual Machine',
    },
    workspace: {
      gradient: 'linear-gradient(135deg, #2496ED 0%, #1a7bc7 100%)',
      badge: 'WORKSPACE',
      label: 'Container Workspace',
    },
    'windows-desktop': {
      gradient: 'linear-gradient(135deg, #0078D4 0%, #00BCF2 100%)',
      badge: 'WINDOWS',
      label: 'Windows Desktop (RDS)',
    },
    rosa: {
      gradient: 'linear-gradient(135deg, #EE0000 0%, #CC0000 100%)',
      badge: 'ROSA',
      label: 'Red Hat OpenShift on AWS',
    },
    aro: {
      gradient: 'linear-gradient(135deg, #0078D4 0%, #EE0000 100%)',
      badge: 'ARO',
      label: 'Azure Red Hat OpenShift',
    },
  };

  const brand = brandMap[resourceType] || brandMap.vm;
  const portalLink = 'https://portal.synergificsoftware.com';
  const expiresStr = expiresAt
    ? new Date(expiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
    : 'Contact your administrator';

  // -- Step 2: resource-specific access section --------------------------
  let accessSection = '';
  const isOpenShift = resourceType === 'rosa' || resourceType === 'aro';

  if (isOpenShift) {
    accessSection = `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="display:inline-block;background:${resourceType === 'rosa' ? '#EE0000' : '#0078D4'};color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;letter-spacing:0.5px;">${brand.badge}</span>
          <span style="font-weight:600;color:#166534;font-size:14px;">Step 2 - Access Your OpenShift Cluster</span>
        </div>
        <table style="width:100%;font-size:13px;">
          ${consoleUrl ? `<tr><td style="padding:4px 0;color:#6b7280;width:110px;">Console URL</td><td style="color:#111;"><a href="${consoleUrl}" style="color:#2563eb;">${consoleUrl}</a></td></tr>` : ''}
          ${clusterName ? `<tr><td style="padding:4px 0;color:#6b7280;">Cluster</td><td style="color:#111;">${clusterName}</td></tr>` : ''}
          ${namespace ? `<tr><td style="padding:4px 0;color:#6b7280;">Namespace</td><td style="color:#111;font-family:monospace;">${namespace}</td></tr>` : ''}
          <tr><td style="padding:4px 0;color:#6b7280;">Username</td><td style="color:#111;font-family:monospace;">${accessUsername || ''}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Password</td><td style="color:#111;font-family:monospace;font-weight:600;">${accessPassword || ''}</td></tr>
        </table>
        <div style="font-size:11px;color:#6b7280;margin-top:8px;">Log in to the OpenShift console with the credentials above. Your namespace is isolated -- other students cannot see your work.</div>
      </div>`;
  } else if (resourceType === 'windows-desktop') {
    accessSection = `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:16px;">
        <div style="font-weight:600;color:#166534;font-size:14px;margin-bottom:10px;">Step 2 - Access Your Windows Desktop</div>
        <table style="width:100%;font-size:13px;">
          ${accessUrl ? `<tr><td style="padding:4px 0;color:#6b7280;width:110px;">Browser URL</td><td style="color:#111;"><a href="${accessUrl}" style="color:#2563eb;">${accessUrl}</a></td></tr>` : ''}
          <tr><td style="padding:4px 0;color:#6b7280;">Username</td><td style="color:#111;font-family:monospace;">${accessUsername || ''}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Password</td><td style="color:#111;font-family:monospace;font-weight:600;">${accessPassword || ''}</td></tr>
        </table>
        <div style="font-size:11px;color:#6b7280;margin-top:8px;">Click "Open in Browser" to connect via Guacamole (no software needed), or use an RDP client to connect directly.</div>
      </div>`;
  } else {
    // VM or workspace
    accessSection = `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:16px;">
        <div style="font-weight:600;color:#166534;font-size:14px;margin-bottom:10px;">Step 2 - Access Your ${brand.label}</div>
        <table style="width:100%;font-size:13px;">
          ${accessUrl ? `<tr><td style="padding:4px 0;color:#6b7280;width:110px;">Browser URL</td><td style="color:#111;"><a href="${accessUrl}" style="color:#2563eb;">${accessUrl}</a></td></tr>` : ''}
          <tr><td style="padding:4px 0;color:#6b7280;">Username</td><td style="color:#111;font-family:monospace;">${accessUsername || 'lab'}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Password</td><td style="color:#111;font-family:monospace;font-weight:600;">${accessPassword || ''}</td></tr>
          ${sshPort ? `<tr><td style="padding:4px 0;color:#6b7280;">SSH</td><td style="color:#111;font-family:monospace;font-size:12px;">ssh ${accessUsername || 'lab'}@${hostIp} -p ${sshPort}</td></tr>` : ''}
        </table>
        <div style="font-size:11px;color:#6b7280;margin-top:8px;">Click the browser URL above to open your lab -- no installs needed.</div>
      </div>`;
  }

  // -- Specs section (VM / workspace only) -------------------------------
  let specsSection = '';
  if ((resourceType === 'vm' || resourceType === 'workspace') && (cpus || memoryMb || imageLabel)) {
    specsSection = `
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:16px;">
        <div style="padding:10px 16px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">
          Resource Specs
        </div>
        <table style="width:100%;border-collapse:collapse;">
          ${imageLabel ? `<tr><td style="padding:6px 16px;color:#6b7280;font-size:13px;width:100px;">Image</td><td style="padding:6px 16px;font-size:13px;color:#111;">${imageLabel}</td></tr>` : ''}
          ${cpus ? `<tr><td style="padding:6px 16px;color:#6b7280;font-size:13px;">CPUs</td><td style="padding:6px 16px;font-size:13px;color:#111;">${cpus} vCPU</td></tr>` : ''}
          ${memoryMb ? `<tr><td style="padding:6px 16px;color:#6b7280;font-size:13px;">Memory</td><td style="padding:6px 16px;font-size:13px;color:#111;">${memoryMb >= 1024 ? (memoryMb / 1024).toFixed(1) + ' GB' : memoryMb + ' MB'}</td></tr>` : ''}
        </table>
      </div>`;
  }

  const subject = `[GetLabs] ${trainingName || resourceName} - Your ${brand.label} is Ready`;

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
    <!-- Header -->
    <div style="background:${brand.gradient};border-radius:12px 12px 0 0;padding:32px 24px;text-align:center;">
      <div style="display:inline-block;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);border-radius:20px;padding:4px 14px;margin-bottom:12px;">
        <span style="font-size:11px;font-weight:700;color:#ffffff;letter-spacing:1.5px;">${brand.badge}</span>
      </div>
      <div style="font-size:24px;font-weight:700;color:#ffffff;margin-bottom:4px;">Your ${brand.label} is Ready</div>
      <div style="font-size:14px;color:rgba(255,255,255,0.85);">${trainingName || 'GetLabs Cloud Training'}</div>
    </div>

    <!-- Body -->
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
      <div style="font-size:15px;color:#374151;line-height:1.6;margin-bottom:20px;">
        Hi there,<br><br>
        Your <strong>${brand.label}</strong>${resourceName ? ' (' + resourceName + ')' : ''} has been provisioned and is ready to use. Below are your login credentials.
      </div>

      <!-- Step 1: Portal Login -->
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:16px;">
        <div style="font-weight:600;color:#1e40af;font-size:14px;margin-bottom:10px;">Step 1 - Log in to the Training Portal</div>
        <table style="width:100%;font-size:13px;">
          <tr><td style="padding:4px 0;color:#6b7280;width:100px;">Portal URL</td><td style="color:#111;"><a href="${portalLink}" style="color:#2563eb;">${portalLink}</a></td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Email</td><td style="color:#111;font-family:monospace;">${email}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Password</td><td style="color:#111;font-family:monospace;font-weight:600;">${portalPassword || 'Welcome1234!'}</td></tr>
        </table>
        <div style="font-size:11px;color:#6b7280;margin-top:8px;">After logging in, go to "My Labs" to view your resources and credentials.</div>
      </div>

      <!-- Step 2: Resource Access -->
      ${accessSection}

      ${specsSection}

      <!-- Expiry -->
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
        <div style="font-size:13px;color:#92400e;">
          <strong>Lab Expires:</strong> ${expiresStr} IST<br>
          <span style="font-size:12px;">All resources will be automatically cleaned up at this time. Save your work before expiry.</span>
        </div>
      </div>

      <!-- Footer -->
      <div style="border-top:1px solid #e5e7eb;padding-top:16px;text-align:center;">
        <div style="font-size:12px;color:#9ca3af;">
          Need help? Reply to this email or contact your trainer.<br>
          <strong>Synergific Cloud Portal</strong> - Enterprise Cloud Training Labs
        </div>
      </div>
    </div>
  </div>`;

  await sendEmail(email, subject, html);
}

module.exports = {
  sendEmail,
  notifyInstanceReady,
  notifyQuotaLow,
  notifyAutoShutdown,
  checkQuotaWarnings,
  notifyLabWelcomeEmail,
  notifyOpsDeploySummary,
  notifySandboxWelcomeEmail,
  notifyResourceWelcomeEmail,
};
