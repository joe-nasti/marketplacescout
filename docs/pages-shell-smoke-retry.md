# Pages shell smoke retry

The primary Pages deploy verifies the version marker immediately after deployment, but GitHub Pages edge nodes can briefly serve a mixed module graph while the deployment converges. The companion `pages-shell-smoke-retry.yml` workflow waits, retries the real headless-Chrome shell render, prints startup diagnostics when needed, and replaces transient red shell/browser/live statuses for the deployed commit once the edge is actually healthy.
