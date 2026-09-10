# Deploy configuration for the frontend deploy script.
# Copy this file to deploy.config.ps1 and fill in real values.
# deploy.config.ps1 is gitignored — never commit it.

# Absolute path to the SSH private key on THIS machine.
$DEPLOY_SSH_KEY_PATH = "C:\path\to\your-key.pem"

# Server to deploy to.
$DEPLOY_SERVER_IP = "0.0.0.0"
$DEPLOY_SERVER_USER = "ubuntu"

# Absolute path on the server where nginx serves the frontend dist.
# This is the EXISTING nginx root — it does NOT move with the monorepo.
$DEPLOY_FRONTEND_REMOTE_PATH = "/home/ubuntu/festpass-frontend-git/dist"

# Public URL of the frontend, used to verify the deployed bundle.
$DEPLOY_FRONTEND_VERIFY_URL = "https://your-domain.example"
