const path = require("path");

const repoRoot = __dirname;

module.exports = {
  apps: [
    {
      name: "meridian",
      script: path.join(repoRoot, "dist/entrypoints/daemon.js"),
      cwd: repoRoot,
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_restarts: 10,
      min_uptime: "10s",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
        MERIDIAN_AUTONOMOUS: "true",
      },
    },
    {
      // Next.js dashboard. Reads the daemon over the in-container localhost
      // bridge (BRIDGE_URL default http://127.0.0.1:8787) and reads state
      // files directly from MERIDIAN_ROOT (=/opt/data, set in compose).
      // BRIDGE_TOKEN / MERIDIAN_ROOT are inherited from the container env.
      name: "meridian-web",
      script: path.join(repoRoot, "dashboard/web/node_modules/next/dist/bin/next"),
      args: "start -p 3000",
      cwd: path.join(repoRoot, "dashboard/web"),
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
