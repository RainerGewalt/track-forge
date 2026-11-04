#!/usr/bin/env bash

set -euo pipefail

player_host="${1:-}"
certificate_directory="deploy/certs"

if [[ -z "$player_host" ]]; then
  echo "Usage: npm run player:certificate -- <LAN IP or hostname>" >&2
  exit 1
fi

if [[ "$player_host" =~ ^[0-9a-fA-F:.]+$ ]]; then
  player_san="IP:$player_host"
else
  player_san="DNS:$player_host"
fi

mkdir -p "$certificate_directory"

for certificate_file in local-ca.crt local-ca.key player.crt player.key; do
  if [[ -d "$certificate_directory/$certificate_file" ]]; then
    echo "$certificate_directory/$certificate_file is a directory, created by Docker before the certificate existed." >&2
    echo "Remove it, then run this again: sudo rmdir $certificate_directory/$certificate_file && sudo chown $(id -u):$(id -g) $certificate_directory" >&2
    exit 1
  fi
done

if [[ -s "$certificate_directory/local-ca.key" && -s "$certificate_directory/local-ca.crt" ]]; then
  echo "Reusing the existing local certificate authority."
elif [[ -e "$certificate_directory/local-ca.key" || -e "$certificate_directory/local-ca.crt" ]]; then
  echo "The local certificate authority is incomplete. Restore or remove both local-ca files first." >&2
  exit 1
else
  openssl req \
    -x509 \
    -newkey rsa:3072 \
    -sha256 \
    -nodes \
    -days 3650 \
    -subj "/CN=Track Forge Local CA" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -keyout "$certificate_directory/local-ca.key" \
    -out "$certificate_directory/local-ca.crt"
fi

openssl req \
  -newkey rsa:2048 \
  -sha256 \
  -nodes \
  -subj "/CN=$player_host" \
  -keyout "$certificate_directory/player.key" \
  -out "$certificate_directory/player.csr"

openssl x509 \
  -req \
  -sha256 \
  -days 825 \
  -in "$certificate_directory/player.csr" \
  -CA "$certificate_directory/local-ca.crt" \
  -CAkey "$certificate_directory/local-ca.key" \
  -CAcreateserial \
  -extfile <(printf '%s\n' \
    "basicConstraints=critical,CA:FALSE" \
    "keyUsage=critical,digitalSignature,keyEncipherment" \
    "extendedKeyUsage=serverAuth" \
    "subjectKeyIdentifier=hash" \
    "authorityKeyIdentifier=keyid,issuer" \
    "subjectAltName=$player_san,IP:127.0.0.1,DNS:localhost") \
  -out "$certificate_directory/player.crt"

rm -f "$certificate_directory/player.csr" "$certificate_directory/local-ca.srl"
chmod 600 "$certificate_directory/local-ca.key" "$certificate_directory/player.key"

echo "Created a certificate for $player_host."
echo "Keep $certificate_directory/local-ca.key private."
echo "Install $certificate_directory/local-ca.crt as a trusted local CA on each playback device."
