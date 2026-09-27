#!/usr/bin/env bash
# Yemek Gelsin — Türkiye VPS'i hazırlığı (00 §12a madde 10; 15 §14). Ubuntu 24.04 LTS, root olarak çalışır; idempotenttir
# (her dağıtımda çalışır, yapılmış adımı atlar). Canlı ortam iş akışı (.github/workflows/deploy-production.yml) yükler ve
# çalıştırır; elle de çalıştırılabilir:
#   sudo bash scripts/vps/bootstrap.sh [--ssh-port 22] [--full]
#
# Yaptıkları:
#   - ilk çalıştırmada (ya da --full ile) apt update + upgrade (etkileşimsiz); sonraki çalıştırmalarda yalnız eksik paket
#     (Docker yükseltmesi çalışan konteynerleri yeniden başlatır; güvenlik yamaları unattended-upgrades ile gelir),
#   - Docker Engine + compose eklentisi (resmi kurulum betiği get.docker.com), Docker log döndürme varsayılanları
#     (json-file, 5 × 20 MB),
#   - git, curl, jq, rclone (yedeğin ikinci konumu için), cron,
#   - UFW: yalnız SSH (sshd'nin dinlediği portlar + --ssh-port), 80/tcp, 443/tcp, 443/udp açık,
#   - fail2ban (sshd jail'i, systemd günlüğü), unattended-upgrades (otomatik güvenlik güncellemeleri; otomatik yeniden
#     başlatma YOK),
#   - saat dilimi Europe/Istanbul (yedek cron'u 03:30 İstanbul; konteynerler UTC kalır),
#   - RAM 6 GB'tan azsa ve takas yoksa 2 GB takas dosyası,
#   - /opt/yemekgelsin/{app,backups} düzeni (backups 700).
# Çıktının son satırları iş akışı için: "HAZIRLIK_TAMAM", gerekiyorsa "YENIDEN_BASLATMA_GEREKLI".

set -Eeuo pipefail

SSH_PORT=22
FULL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh-port) SSH_PORT="${2:?--ssh-port değer ister}"; shift 2 ;;
    --full) FULL=1; shift ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Bilinmeyen seçenek: $1" >&2; exit 2 ;;
  esac
done
[[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] || { echo "Geçersiz SSH portu: $SSH_PORT" >&2; exit 2; }

BASE=/opt/yemekgelsin
MARKER="$BASE/.hazirlik-v1"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1
APT=(apt-get -y -q -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

log() { printf '[hazırlık] %s %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[hazırlık] HATA: %s\n' "$*" >&2; exit 1; }
trap 'die "satır $LINENO başarısız (çıkış $?)"' ERR

[[ $EUID -eq 0 ]] || die "root olarak çalıştırın (sudo bash $0)."
# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  log "UYARI: Ubuntu 24.04 bekleniyordu, bulunan: ${PRETTY_NAME:-bilinmiyor}. Devam ediliyor."
elif [[ "${VERSION_ID:-}" != "24.04" ]]; then
  log "UYARI: Ubuntu ${VERSION_ID:-?} (önerilen 24.04 LTS). Devam ediliyor."
fi

first_run=0
[[ -f "$MARKER" ]] || first_run=1

# --- Paketler ------------------------------------------------------------------------------------------------
if [[ $first_run -eq 1 || $FULL -eq 1 ]]; then
  log "apt update + upgrade (etkileşimsiz; ilk kurulum ya da --full)"
  "${APT[@]}" update
  "${APT[@]}" upgrade
fi

want=(ca-certificates curl git jq gnupg cron ufw fail2ban python3-systemd unattended-upgrades rclone)
missing=()
for p in "${want[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
if [[ ${#missing[@]} -gt 0 ]]; then
  log "paketler kuruluyor: ${missing[*]}"
  [[ $first_run -eq 1 || $FULL -eq 1 ]] || "${APT[@]}" update
  "${APT[@]}" install --no-install-recommends "${missing[@]}"
fi

# --- Docker ------------------------------------------------------------------------------------------------
# Log döndürme varsayılanı Docker ilk açılmadan önce yazılır (compose servisleri kendi sınırını da verir)
if [[ ! -f /etc/docker/daemon.json ]]; then
  install -d -m 755 /etc/docker
  cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
JSON
  log "Docker log döndürme varsayılanı yazıldı (/etc/docker/daemon.json)"
  docker_config_changed=1
else
  docker_config_changed=0
  if ! jq -e '."log-opts"' /etc/docker/daemon.json >/dev/null 2>&1; then
    tmp=$(mktemp)
    jq '. + {"log-driver": (."log-driver" // "json-file"), "log-opts": {"max-size": "20m", "max-file": "5"}}' /etc/docker/daemon.json >"$tmp"
    install -m 644 "$tmp" /etc/docker/daemon.json
    rm -f "$tmp"
    docker_config_changed=1
    log "Docker log döndürme ayarı mevcut daemon.json'a eklendi"
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  log "Docker Engine kuruluyor (get.docker.com)"
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
  docker_config_changed=0
fi
if ! docker compose version >/dev/null 2>&1; then
  log "Docker compose eklentisi kuruluyor"
  "${APT[@]}" update
  "${APT[@]}" install docker-compose-plugin
fi
systemctl enable --now docker >/dev/null 2>&1 || true
if [[ $docker_config_changed -eq 1 ]]; then
  if [[ -z "$(docker ps -q 2>/dev/null)" ]]; then
    systemctl restart docker
  else
    log "UYARI: daemon.json değişti ama çalışan konteyner var; Docker yeniden başlatılmadı (sonraki bakımda: systemctl restart docker)."
  fi
fi

# --- Saat dilimi (yedek cron'u İstanbul saatine göre; konteynerler UTC) -----------------------------------------
if [[ "$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null)" != "Europe/Istanbul" ]]; then
  timedatectl set-timezone Europe/Istanbul 2>/dev/null || ln -sf /usr/share/zoneinfo/Europe/Istanbul /etc/localtime
  systemctl restart cron >/dev/null 2>&1 || true
  log "saat dilimi Europe/Istanbul yapıldı"
fi
systemctl enable --now cron >/dev/null 2>&1 || true

# --- Takas (RAM < 6 GB ve takas yoksa 2 GB) ---------------------------------------------------------------------
mem_kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
if [[ "$mem_kb" -lt $((6 * 1024 * 1024)) && -z "$(swapon --noheadings --show 2>/dev/null)" ]]; then
  log "2 GB takas dosyası oluşturuluyor (RAM $((mem_kb / 1024)) MB)"
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  fi
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -qE '^/swapfile\s' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  printf 'vm.swappiness=10\n' >/etc/sysctl.d/99-yemekgelsin.conf
  sysctl -q -p /etc/sysctl.d/99-yemekgelsin.conf || true
fi

# --- Güvenlik duvarı (UFW) --------------------------------------------------------------------------------------
# Kural önce eklenir, sonra etkinleştirilir: açık SSH oturumu kopmaz. Docker'ın yayımladığı 80/443 zaten açık.
# SSH portu: iş akışının bağlandığı port (--ssh-port) sshd'nin dinlediği port olmayabilir (NAT/port yönlendirmeli VPS:
# dışarıda 2222 → içeride 22). Kilitlenmemek için sshd'nin GERÇEKTEN dinlediği portlar (sshd -T, Ubuntu 24.04 soket
# etkinleştirmesi ssh.socket, ss) ve --ssh-port birlikte açılır. Dinlenen port bulunamazsa UFW etkinleştirilmez.
sshd_ports() {
  {
    sshd -T 2>/dev/null | awk '$1 == "port" {print $2}' || true
    if systemctl is-active --quiet ssh.socket 2>/dev/null; then
      systemctl show ssh.socket -p Listen --value 2>/dev/null | grep -oE ':[0-9]+ \(Stream\)' | tr -dc '0-9\n' || true
    fi
    ss -H -ltnp 2>/dev/null | awk '/"sshd"/ {n = split($4, a, ":"); print a[n]}' || true
  } | grep -E '^[0-9]{1,5}$' | sort -un || true
}
mapfile -t SSHD_PORTS < <(sshd_ports)
SSH_ALLOW=("${SSHD_PORTS[@]}")
ssh_port_listed=0
for p in "${SSHD_PORTS[@]}"; do [[ "$p" == "$SSH_PORT" ]] && ssh_port_listed=1; done
[[ $ssh_port_listed -eq 1 ]] || SSH_ALLOW+=("$SSH_PORT")
if [[ ${#SSHD_PORTS[@]} -gt 0 && $ssh_port_listed -eq 0 ]]; then
  log "UYARI: iş akışı ${SSH_PORT} portuna bağlanıyor ama sshd ${SSHD_PORTS[*]} portunda dinliyor (NAT/port yönlendirme); hepsi açılır."
fi
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
for p in "${SSH_ALLOW[@]}"; do ufw allow "${p}/tcp" comment 'SSH' >/dev/null; done
ufw allow 80/tcp comment 'HTTP (Caddy)' >/dev/null
ufw allow 443/tcp comment 'HTTPS (Caddy)' >/dev/null
ufw allow 443/udp comment 'HTTP/3 (Caddy)' >/dev/null
if ! ufw status | grep -q '^Status: active'; then
  if [[ ${#SSHD_PORTS[@]} -eq 0 ]]; then
    log "UYARI: sshd'nin dinlediği port bulunamadı (sshd -T/ssh.socket/ss); kilitlenmemek için UFW ETKİNLEŞTİRİLMEDİ. Kurallar eklendi; portu doğrulayıp 'ufw enable' ile elle açın (15 §14)."
  else
    ufw --force enable >/dev/null
    log "UFW etkinleştirildi (SSH ${SSH_ALLOW[*]}/tcp, 80/tcp, 443/tcp, 443/udp)"
  fi
fi

# --- fail2ban (SSH kaba kuvvet koruması) ---------------------------------------------------------------------------
jail=/etc/fail2ban/jail.d/yemekgelsin-sshd.local
ssh_ports_csv=$(IFS=,; echo "${SSH_ALLOW[*]}")
jail_body="# Yemek Gelsin (scripts/vps/bootstrap.sh): SSH parola denemelerine karşı
[sshd]
enabled = true
port = ${ssh_ports_csv}
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
"
if [[ "$(cat "$jail" 2>/dev/null)" != "${jail_body%$'\n'}" ]]; then
  printf '%s' "$jail_body" >"$jail"
  systemctl enable fail2ban >/dev/null 2>&1 || true
  systemctl restart fail2ban
  log "fail2ban sshd jail'i yazıldı (5 hatalı deneme / 10 dk → 1 saat yasak)"
else
  systemctl enable --now fail2ban >/dev/null 2>&1 || true
fi

# --- Otomatik güvenlik güncellemeleri ---------------------------------------------------------------------------
auto=/etc/apt/apt.conf.d/20auto-upgrades
auto_body='APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
'
if [[ "$(cat "$auto" 2>/dev/null)" != "${auto_body%$'\n'}" ]]; then
  printf '%s' "$auto_body" >"$auto"
  log "unattended-upgrades açıldı (yalnız güvenlik güncellemeleri; otomatik yeniden başlatma yok)"
fi
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

# --- Dizinler ---------------------------------------------------------------------------------------------------
install -d -m 755 "$BASE"
install -d -m 755 "$BASE/app"
install -d -m 700 "$BASE/backups"

date -u +%FT%TZ >"$MARKER"
log "Docker: $(docker --version | sed 's/,.*//') · $(docker compose version --short 2>/dev/null || docker compose version)"
log "disk: $(df -h / | awk 'NR==2 {print $4 " boş / " $2}') · RAM: $((mem_kb / 1024)) MB · takas: $(swapon --noheadings --show=SIZE 2>/dev/null | head -1 || echo yok)"
echo "HAZIRLIK_TAMAM"
[[ -f /var/run/reboot-required ]] && echo "YENIDEN_BASLATMA_GEREKLI"
exit 0
