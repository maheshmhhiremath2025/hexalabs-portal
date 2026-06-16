/**
 * Automated Dockerfile Generator + Builder
 *
 * When the container feasibility engine says "missing software X, Y, Z",
 * ops clicks "Build Custom Image" → this service:
 *   1. Calls Claude to generate a production-ready Dockerfile
 *   2. Writes it to a temp directory
 *   3. Runs `docker build` via dockerode
 *   4. Registers the new image in the container catalog
 *   5. Updates the feasibility engine's capability catalog
 *
 * The whole process is tracked as a background job with progress polling.
 */

const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('../plugins/logger');

const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
});

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

/**
 * Use Claude to generate a Dockerfile from a software list.
 */
async function generateDockerfile(softwareList, { courseName, baseImage = 'ubuntu:22.04' } = {}) {
  if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY not set');

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const prompt = `Generate a production-ready Dockerfile for a training lab container with the following requirements:

SOFTWARE TO INSTALL:
${softwareList.map(s => `- ${s}`).join('\n')}

COURSE: ${courseName || 'Custom training lab'}
BASE IMAGE: ${baseImage}

REQUIREMENTS:
1. Use ${baseImage} as the base
2. Install all listed software using apt-get, wget, pip, or official installers
3. Add \`rm -rf /var/lib/apt/lists/*\` after every apt-get install
4. Use \`--no-cache-dir\` for every pip install
5. Install supervisord for process management
6. Install ttyd (version 1.7.7) for browser terminal access on port 7681
7. Create a 'lab' user with sudo NOPASSWD access, password 'Welcome1234!'
8. Install openssh-server for optional SSH
9. Configure supervisord to start: ttyd, sshd, and all installed services
10. Add a welcome message to /etc/motd listing all installed tools
11. EXPOSE ports: 22 7681 and any service-specific ports
12. ENTRYPOINT should be supervisord
13. ENV: DEBIAN_FRONTEND=noninteractive, TZ=Asia/Kolkata

RESPOND WITH ONLY THE DOCKERFILE CONTENT. No explanation, no markdown fences, just the raw Dockerfile.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  let dockerfile = (response.content?.[0]?.text || '').trim();

  // Strip markdown fences if Claude added them despite instructions
  dockerfile = dockerfile.replace(/^```dockerfile?\n?/i, '').replace(/\n?```$/i, '').trim();

  if (!dockerfile.startsWith('FROM')) {
    throw new Error('Claude did not generate a valid Dockerfile (must start with FROM)');
  }

  return dockerfile;
}

/**
 * Build a Docker image from a generated Dockerfile.
 * Returns a promise that resolves when the build completes.
 */
async function buildImage(dockerfile, imageName, imageTag = '1.0', onProgress) {
  // Create a temp directory with the Dockerfile
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getlabs-build-'));
  const dockerfilePath = path.join(tmpDir, 'Dockerfile');
  fs.writeFileSync(dockerfilePath, dockerfile);

  // Also write a .dockerignore
  fs.writeFileSync(path.join(tmpDir, '.dockerignore'), 'node_modules\n.git\n*.log\n');

  const fullTag = `${imageName}:${imageTag}`;

  try {
    // Build using dockerode
    const stream = await docker.buildImage(
      { context: tmpDir, src: ['Dockerfile', '.dockerignore'] },
      {
        t: fullTag,
        platform: 'linux/amd64',
        nocache: false,
      }
    );

    // Follow build output
    return new Promise((resolve, reject) => {
      let lastLog = '';
      docker.modem.followProgress(
        stream,
        (err, output) => {
          // Cleanup temp dir
          try { fs.rmSync(tmpDir, { recursive: true }); } catch {}

          if (err) {
            logger.error(`[dockerfile-gen] Build failed for ${fullTag}: ${err.message}`);
            reject(err);
          } else {
            logger.info(`[dockerfile-gen] Build succeeded: ${fullTag}`);
            resolve({ imageName, imageTag, fullTag, lastLog });
          }
        },
        (event) => {
          if (event.stream) {
            lastLog = event.stream.trim();
            if (onProgress) onProgress(lastLog);
          }
          if (event.error) {
            logger.error(`[dockerfile-gen] Build error: ${event.error}`);
          }
        }
      );
    });
  } catch (err) {
    // Cleanup on error
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    throw err;
  }
}

/**
 * Register a newly built image in the container catalog.
 * Modifies CONTAINER_IMAGES at runtime (persists until restart).
 * For permanent registration, ops should add it to containerService.js.
 */
function registerInCatalog(imageKey, { image, label, software = [], category = 'bigdata' }) {
  const { CONTAINER_IMAGES } = require('./containerService');

  CONTAINER_IMAGES[imageKey] = {
    image,
    label,
    os: 'Ubuntu 22.04',
    category,
    vncPort: 7681,
    protocol: 'http',
    defaultUser: 'lab',
    env: ['LAB_PASSWORD=Welcome1234!'],
    shmSize: '512m',
  };

  logger.info(`[dockerfile-gen] Registered ${imageKey} in catalog: ${image}`);

  // Also register in the capability catalog for feasibility engine
  try {
    const { IMAGE_CAPABILITIES } = require('../data/containerImageCapabilities');
    IMAGE_CAPABILITIES[imageKey] = {
      label,
      category,
      provides: software.map(s => s.toLowerCase()),
      keywords: [],
      addable: [],
      notSupported: [],
    };
    logger.info(`[dockerfile-gen] Registered ${imageKey} in capability catalog`);
  } catch (e) {
    logger.warn(`[dockerfile-gen] Failed to register capabilities: ${e.message}`);
  }

  return true;
}

module.exports = { generateDockerfile, buildImage, registerInCatalog };
