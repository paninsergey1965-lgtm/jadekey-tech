#!/usr/bin/env bash
# Xray VLESS + Reality + Vision — установка одной командой (Ubuntu 22/24)
set -e
SNI="${SNI:-dl.google.com}"
NET="${NET:-xhttp}"
XPATH="/$(openssl rand -hex 4 2>/dev/null || echo jk)"
PORT="${PORT:-443}"
export DEBIAN_FRONTEND=noninteractive

apt-get update -y >/dev/null
apt-get install -y curl openssl ca-certificates >/dev/null

bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install >/dev/null

KEYS="$(/usr/local/bin/xray x25519)"
PRIV="$(echo "$KEYS" | grep -i 'private' | awk -F': ' '{print $2}' | tr -d ' \r')"
PUB="$(echo "$KEYS" | grep -iE 'public|password' | head -1 | awk -F': ' '{print $2}' | tr -d ' \r')"
UUID="$(/usr/local/bin/xray uuid)"
SID="$(openssl rand -hex 8)"
IP="$(curl -4 -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"

if [ "$NET" = "xhttp" ]; then
  FLOWJSON=""
  XHTTPJSON="
      \"xhttpSettings\": { \"path\": \"$XPATH\", \"mode\": \"auto\" },"
else
  FLOWJSON=', "flow": "xtls-rprx-vision"'
  XHTTPJSON=""
fi

cat > /usr/local/etc/xray/config.json <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [{
    "listen": "0.0.0.0",
    "port": $PORT,
    "protocol": "vless",
    "settings": {
      "clients": [{ "id": "$UUID"$FLOWJSON }],
      "decryption": "none"
    },
    "streamSettings": {
      "network": "$NET",$XHTTPJSON
      "security": "reality",
      "realitySettings": {
        "dest": "$SNI:443",
        "serverNames": ["$SNI"],
        "privateKey": "$PRIV",
        "shortIds": ["$SID"]
      }
    },
    "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
  }],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "block" }
  ]
}
EOF

# BBR для скорости
grep -q 'tcp_congestion_control=bbr' /etc/sysctl.conf || {
  echo 'net.core.default_qdisc=fq' >> /etc/sysctl.conf
  echo 'net.ipv4.tcp_congestion_control=bbr' >> /etc/sysctl.conf
}
sysctl -p >/dev/null 2>&1 || true

systemctl enable xray >/dev/null 2>&1
systemctl restart xray
sleep 1
systemctl is-active --quiet xray || { echo "XRAY НЕ ЗАПУСТИЛСЯ:"; journalctl -u xray -n 20 --no-pager; exit 1; }

if [ "$NET" = "xhttp" ]; then
  LINK="vless://$UUID@$IP:$PORT?encryption=none&security=reality&sni=$SNI&fp=chrome&pbk=$PUB&sid=$SID&type=xhttp&path=%2F${XPATH#/}&mode=auto#JadeVPN-X"
else
  LINK="vless://$UUID@$IP:$PORT?encryption=none&flow=xtls-rprx-vision&security=reality&sni=$SNI&fp=chrome&pbk=$PUB&sid=$SID&type=tcp#JadeVPN"
fi
echo "$LINK" > /root/vless.txt
echo
echo "===== ГОТОВО. Скопируй строку ниже в V2Box ====="
echo "$LINK"
echo "================================================"
