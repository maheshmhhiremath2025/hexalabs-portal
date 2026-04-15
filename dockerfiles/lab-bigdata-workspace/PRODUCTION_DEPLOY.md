# Production Deploy — lab-bigdata-workspace

What you do tomorrow to push the image and have your customer test it.

## Prerequisites (one-time)

Pick a registry and authenticate. **Docker Hub is the simplest** — free,
public, no infrastructure to manage. The catalog is currently configured for
Docker Hub under the `getlabs` namespace.

### Option A: Docker Hub (recommended for first push)

```bash
docker login
# username: <your-dockerhub-username>
# password: <your-dockerhub-password-or-PAT>
```

If you don't have a `getlabs` org on Docker Hub yet, either:
1. Create one at https://hub.docker.com/orgs (free), OR
2. Push to your personal namespace and update the catalog entry's `image:`
   field accordingly (e.g. `vinaychandra/lab-bigdata-workspace:1.0`).

### Option B: Azure Container Registry (matches the rest of your Azure infra)

```bash
# One-time: create the registry
az acr create --resource-group <rg> --name getlabsacr --sku Basic

# Login
az acr login --name getlabsacr

# Tell push.sh to use this registry
export REGISTRY=getlabsacr.azurecr.io
```

Then update the catalog entry in [services/containerService.js](../backend/services/containerService.js) to:
```js
image: 'getlabsacr.azurecr.io/getlabs/lab-bigdata-workspace:1.0',
```

### Option C: AWS ECR (if you prefer to keep it on AWS)

```bash
# One-time: create the repo
aws ecr create-repository --repository-name getlabs/lab-bigdata-workspace --region ap-south-1

# Login
aws ecr get-login-password --region ap-south-1 | \
  docker login --username AWS --password-stdin <account>.dkr.ecr.ap-south-1.amazonaws.com

# Tell push.sh to use this registry
export REGISTRY=<account>.dkr.ecr.ap-south-1.amazonaws.com
```

Update the catalog entry to:
```js
image: '<account>.dkr.ecr.ap-south-1.amazonaws.com/getlabs/lab-bigdata-workspace:1.0',
```

## Push the image

From this directory:

```bash
cd dockerfiles/lab-bigdata-workspace
./push.sh 1.0
```

The script will:
1. Build the image for `linux/amd64` (works on Apple Silicon and x86 alike)
2. Run smoke tests inside the built image (Java, Python, Kafka, Spark, MySQL, Cassandra, ttyd)
3. Pause and ask you to confirm before pushing
4. Push both `:1.0` and `:latest` tags
5. Print the pull command for verification

To push a new version later:
```bash
./push.sh 1.1
```

## Verify on the production host

SSH to the production VM and pull the image to confirm registry access:

```bash
docker pull getlabs/lab-bigdata-workspace:1.0
```

Or, if you used a custom registry:

```bash
docker pull <your-registry>/getlabs/lab-bigdata-workspace:1.0
```

You should see all 22 layers download and a final `Status: Downloaded newer image` line.

## Test deploy via the portal

1. Log into the portal as admin/superadmin
2. Sidebar → **Containers** (or whatever it's called after the sidebar reorg)
3. Click **Deploy Containers**
4. In the Image dropdown, scroll to the new **Big Data / Streaming Labs** group
5. Pick **Big Data Lab — Kafka, Spark, MySQL, JDK17, Python 3.10**
6. Set: 1 container, organization, training name
7. Resources: pick `2 vCPU / 6 GB` (matches the per-seat budget for big-data labs)
8. Click Deploy

The backend will:
1. Call `dockerode.pull('getlabs/lab-bigdata-workspace:1.0')` if not already cached
2. Create the container with the env vars from the catalog
3. Bind a port from the 10000-11000 range to ttyd's port 7681
4. Save to the `containers` collection
5. Return the access URL: `http://<host>:<assigned-port>`

Open that URL in a browser → drops you into a pre-configured terminal with
Kafka, Spark, MySQL all reachable on `localhost`.

## Test the customer's flow

For your customer to test:
1. They visit the portal URL you give them
2. They sign in with the credentials you provision (or use an existing user)
3. They click into the lab
4. They get the same pre-configured shell — no setup, no waiting, no SSH keys

The whole experience is < 30 seconds from "click Deploy" to "running kafka-topics.sh".

## If something breaks

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker pull` fails with `pull access denied` | Image is private and host isn't authenticated | `docker login` on the host with registry creds, or make the image public |
| `docker pull` works but container fails to start | First-run init script error | `docker logs <container>` and check for the supervisord errors |
| Terminal opens but Kafka isn't running | `ENABLE_KAFKA` env var not passed through | Verify the catalog entry has `ENABLE_KAFKA=true` in `env[]` |
| Port already in use | Container port range exhausted | Check `CONTAINER_PORT_END` in backend env, or stop dead containers |
| Slow image pull | Image is 1.5 GB | Pre-pull on each host: `docker pull getlabs/lab-bigdata-workspace:1.0` |
| Customer says "kafka-topics command not found" | They're using sh, not bash | `bash` then re-run; the lab user defaults to bash |

## Pre-pull on production hosts (recommended)

The image is 1.5 GB compressed. Pulling it on first deploy adds ~30-90s
depending on host network. Pre-pull on each Docker host as part of your
deploy pipeline:

```bash
# As part of your docker-compose up or host provisioning
docker pull getlabs/lab-bigdata-workspace:1.0
```

You already have a pattern for this in [containerService.js:172](../backend/services/containerService.js#L172) where it pulls on demand if the image isn't cached, but the first student of each batch eats the cold-pull penalty. Pre-pulling makes student-1 as fast as student-25.

## Image size + storage budget per host

| Component | Compressed | Uncompressed |
|---|---|---|
| Layer total (the pull) | 1.46 GB | 4.19 GB |
| Per-running-container overlay | n/a | ~50 MB (small writes) |
| MySQL data dir per container | n/a | ~100 MB after lab setup |

For 25 students on a single host: ~5 GB of writable layers + the 4 GB image = ~10 GB Docker storage. Allocate at least 50 GB for `/var/lib/docker` to give yourself headroom.

## Rollback

If `1.0` has a bug and you need to roll back:
1. Find the previous good tag: `docker images | grep lab-bigdata-workspace`
2. Edit the catalog entry to point at `:0.9` (or whatever the old tag was)
3. Restart backend
4. Existing running containers from `:1.0` keep running until TTL expiry — they don't get retroactively swapped

## How to make the image private

If you want the image private (only your hosts can pull it):
1. Docker Hub: set the repo to private at https://hub.docker.com/r/getlabs/lab-bigdata-workspace/settings
2. ACR: it's private by default (no action needed)
3. ECR: it's private by default (no action needed)

For private images, every Docker host that needs to pull must run `docker login` first (or have a daemon-level credential helper configured).
