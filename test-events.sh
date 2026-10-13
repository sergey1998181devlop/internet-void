#!/usr/bin/env sh
# Тестовые события для The Internet Void.
#
#   ./test-events.sh small     # малый взнос $1
#   ./test-events.sh gamma     # гамма-всплеск $10 (вспышка у всех онлайн)
#   ./test-events.sh image     # загрузка картинки
#   ./test-events.sh storm 10  # залп из 10 событий подряд
#   ./test-events.sh all       # small + gamma + image
#
# BASE=http://host:port ./test-events.sh gamma

set -e
BASE="${BASE:-http://localhost:8080}"
NAMES="VoidWalker|CryptoBro|Lena|Anon|Streamer|Ghost"
TEXTS="секрет, который я никогда никому не рассказывал|сайт моего бывшего университета|мой главный грех 2019 года|переписка, о которой я жалею|бывший работодатель: ooo-toxi.ru"
GAMMA_TEXTS="https://x.com/void|https://t.me/void_channel|https://x.com/competitor"

rnd() { # rnd "a|b|c"
  printf '%s' "$1" | tr '|' '\n' | awk 'BEGIN{srand()}{a[NR]=$0}END{print a[int(rand()*NR)+1]}'
}

small() {
  echo "→ малый взнос \$1"
  curl -sS -X POST "$BASE/api/destroy" \
    -F "text=$(rnd "$TEXTS")" \
    -F "name=$(rnd "$NAMES")" \
    -F "amount=1" \
    -F "clientId=cli_$(date +%s)_$$" | sed 's/^/  /'
  echo
}

gamma() {
  echo "→ гамма-всплеск \$10 (вспышка у всех онлайн)"
  curl -sS -X POST "$BASE/api/gamma" \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"$(rnd "$GAMMA_TEXTS")\",\"name\":\"$(rnd "$NAMES")\",\"amount\":10,\"clientId\":\"cli_$(date +%s)_$$\"}" \
    | sed 's/^/  /'
  echo
}

image() {
  echo "→ загрузка картинки (\$1)"
  TMP="${TMPDIR:-/tmp}/void_test_$$.png"
  python3 - "$TMP" <<'PY'
import sys, zlib, struct
def chunk(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
w = h = 64
raw = b''.join(b'\x00' + bytes(v for x in range(w) for v in ((x*4) % 256, (y*4) % 256, 200)) for y in range(h))
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw))
       + chunk(b'IEND', b''))
open(sys.argv[1], 'wb').write(png)
PY
  curl -sS -X POST "$BASE/api/destroy" \
    -F "text=логотип конкурента" \
    -F "name=LogoKiller" \
    -F "amount=1" \
    -F "clientId=cli_$(date +%s)_$$" \
    -F "file=@$TMP;type=image/png" | sed 's/^/  /'
  echo
  rm -f "$TMP"
}

storm() {
  n="${1:-5}"
  echo "→ залп из $n событий"
  i=0
  while [ "$i" -lt "$n" ]; do
    small
    i=$((i + 1))
  done
}

case "${1:-all}" in
  small) small ;;
  gamma) gamma ;;
  image) image ;;
  storm) storm "$2" ;;
  all) small; gamma; image ;;
  *) echo "usage: $0 {small|gamma|image|storm N|all}"; exit 1 ;;
esac

echo "state:"
curl -sS "$BASE/api/state" | head -c 400
echo
