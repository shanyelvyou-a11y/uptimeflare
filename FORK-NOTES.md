# Fork notes

Upstream: UptimeFlare by lyc8503 (https://github.com/lyc8503/UptimeFlare), License: see LICENSE (upstream, retained).

Our changes (<1% of codebase): monitoring configuration for our own frontends (uptime.config.ts, 20 frontends in 4 groups), branding (footer/header links and naming), Pro 2.0 layout update. Deployed at status.rapporteur.online.

Sanitized before publishing: the hardcoded bridge-secret default was removed (set it via environment/secret binding instead), and Cloudflare account/D1 database IDs in wrangler.toml were replaced with placeholders.
Binary assets (favicon, screenshots) are not included in this snapshot upload.
