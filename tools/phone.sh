#!/usr/bin/env bash
# Remote install/debug helper for the phone over Wi-Fi adb.
# Usage: tools/phone.sh connect|install|launch|log
set -euo pipefail

PORT=5555
APP_ID=io.rollins.slimveld
APK=android/app/build/outputs/apk/debug/app-debug.apk
cd "$(dirname "$0")/.."

wifi_serial() {
  adb devices | awk -v port="$PORT" '$2=="device" && $1 ~ ":"port"$" {print $1; exit}'
}

usb_serial() {
  adb devices | awk '$2=="device" && $1 !~ /:/ {print $1; exit}'
}

connect() {
  local s
  s=$(wifi_serial)
  if [ -n "$s" ]; then echo "$s"; return; fi
  local usb ip
  usb=$(usb_serial)
  if [ -z "$usb" ]; then
    echo "No device: plug in USB once to (re)pair Wi-Fi adb, or check the phone is on this network." >&2
    exit 1
  fi
  ip=$(adb -s "$usb" shell ip route | awk '/wlan0/ {print $9}' | head -1)
  if [ -z "$ip" ]; then echo "Phone has no Wi-Fi IP (is Wi-Fi on?)." >&2; exit 1; fi
  adb -s "$usb" tcpip "$PORT" >&2
  sleep 2
  adb connect "$ip:$PORT" >&2
  wifi_serial
}

case "${1:-install}" in
  connect)
    s=$(connect); echo "Connected: $s" ;;
  install)
    s=$(connect)
    npm run android:apk
    adb -s "$s" install -r "$APK"
    adb -s "$s" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null
    echo "Installed and launched on $s" ;;
  launch)
    s=$(connect)
    adb -s "$s" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null ;;
  log)
    s=$(connect)
    adb -s "$s" logcat -s Capacitor:V "Capacitor/Console:V" chromium:V ;;
  *)
    echo "Usage: tools/phone.sh connect|install|launch|log" >&2; exit 1 ;;
esac
