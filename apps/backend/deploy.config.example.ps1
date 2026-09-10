# Deploy configuration for the backend deploy script.
# Copy this file to deploy.config.ps1 and fill in real values.
# deploy.config.ps1 is gitignored — never commit it.

# Absolute path to the SSH private key on THIS machine.
$DEPLOY_SSH_KEY_PATH = "C:\path\to\your-key.pem"

# Server to deploy to.
$DEPLOY_SERVER_IP = "0.0.0.0"
$DEPLOY_SERVER_USER = "ubuntu"

# Absolute path on the server to the REPOSITORY ROOT (not the backend
# package). The backend lives at <this path>/apps/backend. Git fetch and
# reset run here; pnpm install runs here filtered to the backend.
$DEPLOY_REPO_REMOTE_PATH = "/home/ubuntu/dedal"

# PM2 process name used to restart the backend.
$DEPLOY_PM2_PROCESS_NAME = "your-pm2-process-name"

# Health endpoint hit after deploy to confirm the server is up.
$DEPLOY_BACKEND_HEALTH_URL = "https://your-domain.example/api/v1/health"

# Absolute path to the pnpm binary on the server. PM2-managed boxes often
# have a different PATH than an interactive shell; naming the binary avoids
# "command not found" surprises.
$DEPLOY_PNPM_PATH = "/usr/local/bin/pnpm"
