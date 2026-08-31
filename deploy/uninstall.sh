#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Run this command as root." >&2; exit 1; }
read -r -p "Type REMOVE to delete the panel, its SQLite database, and local account metadata (LXC containers stay): " confirm </dev/tty
[[ "$confirm" == "REMOVE" ]] || { echo "Cancelled."; exit 0; }
systemctl disable --now lxc-hosting-self-hosted.service 2>/dev/null || true
rm -f /etc/systemd/system/lxc-hosting-self-hosted.service /usr/local/sbin/lxc-hosting-reset-password /usr/local/sbin/lxc-hosting-doctor /usr/local/sbin/lxc-hosting-uninstall
rm -rf /opt/lxc-hosting-self-hosted /etc/lxc-hosting-self-hosted /var/lib/lxc-hosting-self-hosted
systemctl daemon-reload
echo "Panel and local state removed. LXC/Incus runtime and containers were preserved."
