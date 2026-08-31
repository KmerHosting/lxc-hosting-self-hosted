# LXC Hosting Self-Hosted

A local-first LXC control panel for one Ubuntu 22.04/24.04 KVM VPS or dedicated server. It runs its own LXD runtime, Express app and SQLite 3 database — no Supabase, billing, external account provider, domain, or email service.

The product has no resource, credit, snapshot, or account-plan limits. Containers still use the finite CPU, RAM and disk physically installed on the host.

## Install

Run as `root` on a fresh or controlled Ubuntu KVM/dedicated host:

```bash
curl -fsSL https://raw.githubusercontent.com/KmerHosting/lxc-hosting-self-hosted/main/deploy/install.sh | sudo bash
```

The installer installs Node.js, LXD and required build packages, initializes local LXD defaults, creates a systemd service, and prints a one-time setup token. Open the printed `http://SERVER_IP:1974/setup` URL and submit that token with the first administrator email and password. The token is deleted after successful setup.

A domain is not required. For a permanent public installation, terminate HTTPS with a reverse proxy and restrict access to people you trust. Do not expose the LXD daemon port; the panel talks to the local LXD client only.

## Features

- Local email/password registration and sign-in only
- SQLite 3 authentication and inventory storage
- First-run administrator claim protected by a terminal-generated token
- Ubuntu, Debian, Alpine, Rocky Linux and AlmaLinux image choices
- CPU, RAM and storage stepper controls with no product caps
- Start, stop, restart, delete and unlimited snapshot actions
- Account password changes from the UI; no email reset flow required
- Terminal password recovery: `sudo lxc-hosting-reset-password [email]`

## Operations

```bash
sudo lxc-hosting-doctor
sudo lxc-hosting-reset-password
sudo systemctl status lxc-hosting-self-hosted.service --no-pager
sudo journalctl -u lxc-hosting-self-hosted.service -f
sudo lxc-hosting-uninstall
```

`lxc-hosting-uninstall` removes only the panel and its local SQLite/auth data. It preserves LXD/Incus and every container.

## Security model

This software has authority to create and delete containers on its host. Run it only on a server you administer. Use a long unique password, protect the setup token, and place the UI behind HTTPS before exposing it to the Internet.

## Development

```bash
npm install
npm run dev
```

For local development without system paths, the database and setup token are created under `data/`.
