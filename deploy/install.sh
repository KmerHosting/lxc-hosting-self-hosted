#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${LXC_SELF_HOSTED_REPOSITORY:-https://github.com/KmerHosting/lxc-hosting-self-hosted.git}"
BRANCH="${LXC_SELF_HOSTED_BRANCH:-main}"
PORT="${PORT:-1974}"
APP_ROOT="/opt/lxc-hosting-self-hosted"
CONFIG_DIR="/etc/lxc-hosting-self-hosted"
STATE_DIR="/var/lib/lxc-hosting-self-hosted"
ENV_FILE="$CONFIG_DIR/lxc-hosting.env"

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Run this installer with sudo or as root." >&2; exit 1; }
[[ -r /etc/os-release ]] || { echo "Unable to identify the operating system." >&2; exit 1; }
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || { echo "This installer supports Ubuntu 22.04 or 24.04 only." >&2; exit 1; }
dpkg --compare-versions "${VERSION_ID:-0}" ge 22.04 || { echo "Ubuntu 22.04 LTS or newer is required." >&2; exit 1; }
[[ "$(ps -p 1 -o comm= 2>/dev/null | tr -d '[:space:]')" == "systemd" ]] || { echo "systemd must be PID 1." >&2; exit 1; }
[[ "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1024 && "$PORT" -le 65535 ]] || { echo "PORT must be between 1024 and 65535." >&2; exit 1; }

echo "Installing LXC Hosting Self-Hosted on Ubuntu ${VERSION_ID}..."
APT=(apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=45 -o Acquire::https::Timeout=45)
"${APT[@]}" update
DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l "${APT[@]}" install -y ca-certificates curl git build-essential python3 openssl

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])' 2>/dev/null || echo 0)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l "${APT[@]}" install -y nodejs
fi

if ! command -v incus >/dev/null 2>&1 && [[ ! -x /snap/bin/lxc ]]; then
  echo "Installing the local LXD runtime..."
  command -v snap >/dev/null 2>&1 || { echo "snapd is required to install LXD on Ubuntu." >&2; exit 1; }
  snap install lxd
fi
if [[ -x /snap/bin/lxd ]] && ! /snap/bin/lxc storage list --format json >/dev/null 2>&1; then
  echo "Initializing LXD with its local defaults..."
  /snap/bin/lxd init --auto
fi

install -d -m 755 "$APP_ROOT" "$CONFIG_DIR"
install -d -m 700 "$STATE_DIR"
if [[ -d "$APP_ROOT/current/.git" ]]; then
  git -C "$APP_ROOT/current" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_ROOT/current" pull --ff-only origin "$BRANCH"
else
  rm -rf "$APP_ROOT/current"
  git clone --depth 1 --branch "$BRANCH" "$REPOSITORY" "$APP_ROOT/current"
fi
npm --prefix "$APP_ROOT/current" ci --omit=dev

umask 077
if [[ ! -f "$CONFIG_DIR/setup-token" ]]; then openssl rand -hex 16 > "$CONFIG_DIR/setup-token"; fi
if [[ ! -f "$CONFIG_DIR/jwt-secret" ]]; then openssl rand -hex 32 > "$CONFIG_DIR/jwt-secret"; fi
cat > "$ENV_FILE" <<EOF
PORT=$PORT
HOST=0.0.0.0
LXC_SELF_HOSTED_DB=$STATE_DIR/lxc-hosting.db
LXC_SELF_HOSTED_SETUP_TOKEN_FILE=$CONFIG_DIR/setup-token
LXC_SELF_HOSTED_JWT_SECRET_FILE=$CONFIG_DIR/jwt-secret
EOF
chmod 600 "$ENV_FILE" "$CONFIG_DIR/setup-token" "$CONFIG_DIR/jwt-secret"
install -m 644 "$APP_ROOT/current/systemd/lxc-hosting-self-hosted.service" /etc/systemd/system/lxc-hosting-self-hosted.service
install -m 700 "$APP_ROOT/current/deploy/lxc-hosting-reset-password" /usr/local/sbin/lxc-hosting-reset-password
install -m 700 "$APP_ROOT/current/deploy/lxc-hosting-doctor" /usr/local/sbin/lxc-hosting-doctor
install -m 700 "$APP_ROOT/current/deploy/uninstall.sh" /usr/local/sbin/lxc-hosting-uninstall
systemctl daemon-reload
systemctl enable --now lxc-hosting-self-hosted.service

ready=false
for _ in $(seq 1 30); do
  if systemctl is-active --quiet lxc-hosting-self-hosted.service && curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true'; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { journalctl -u lxc-hosting-self-hosted.service -n 100 --no-pager >&2 || true; exit 1; }
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then ufw allow "$PORT/tcp" >/dev/null; fi
server_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1 || true)"
[[ -n "$server_ip" ]] || server_ip="$(hostname -I | tr ' ' '\n' | grep -m1 -E '^[0-9]+(\.[0-9]+){3}$' || true)"
echo
echo "LXC Hosting Self-Hosted is healthy."
echo "Open: http://${server_ip:-SERVER_IP}:$PORT/setup"
echo "Temporary setup token: $(<"$CONFIG_DIR/setup-token")"
echo "The token can be used once, then it is deleted."
echo
echo "No domain is required. For ongoing Internet exposure, put the panel behind HTTPS."
echo "Password recovery: sudo lxc-hosting-reset-password"
echo "Diagnostics:       sudo lxc-hosting-doctor"
