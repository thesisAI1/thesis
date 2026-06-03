// PM2 process definition for the THESIS production box (root@95.179.246.26).
// Captured from the server 2026-06-03 — it had been living ONLY on the box,
// untracked, which made the deployment non-reproducible. Committed here so the
// runtime is in git. NOTE: cwd/script paths are production-absolute
// (/root/thesis-staging/...); they match the deploy checkout location.
//   backend -> `npm start` (tsx src/index.ts) on :4319
//   web     -> `next start -p 80`, proxying the API at :4319
module.exports = {
  apps: [
    {
      name: "thesis-backend",
      cwd: "/root/thesis-staging/packages/backend",
      script: "/usr/bin/npm",
      args: "start",
      exec_mode: "fork",
      env: { NODE_ENV: "production" }
    },
    {
      name: "thesis-web",
      cwd: "/root/thesis-staging/packages/web",
      script: "/root/thesis-staging/node_modules/.bin/next",
      args: "start -p 80",
      interpreter: "node",
      exec_mode: "fork",
      env: { NODE_ENV: "production", THESIS_API_ORIGIN: "http://localhost:4319" }
    }
  ]
}
