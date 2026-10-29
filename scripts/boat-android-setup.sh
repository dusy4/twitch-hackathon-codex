#!/usr/bin/env bash
set -euo pipefail

# Run only inside an explicitly provisioned, disposable Boat QA VM. No account keys needed.
qa_root="${RAIDRIFT_QA_ROOT:-/home/user/raidrift-qa}"
apk_path="${RAIDRIFT_APK:-$qa_root/raidrift-capture-debug.apk}"
test -f "$apk_path" || { echo 'Upload the APK before running setup.' >&2; exit 2; }
test -c /dev/kvm || { echo 'KVM is unavailable; this is not the accelerated Android test environment.' >&2; exit 3; }
mkdir -p "$qa_root/evidence" "$qa_root/downloads"
sudo apt-get update -qq
sudo apt-get install -y -qq openjdk-17-jre-headless unzip curl python3 acl
if ! test -r /dev/kvm || ! test -w /dev/kvm; then sudo setfacl -m "u:$(id -un):rw" /dev/kvm; fi
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME="$qa_root/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_USER_HOME="$qa_root/android-user"
export ANDROID_AVD_HOME="$qa_root/avds"
mkdir -p "$ANDROID_HOME/cmdline-tools" "$ANDROID_USER_HOME" "$ANDROID_AVD_HOME"
tools_zip="$qa_root/downloads/android-commandline-linux-11076708.zip"
if ! test -f "$tools_zip"; then curl --fail --location --retry 3 -o "$tools_zip" https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip; fi
echo "d313adb7aedccf6cf0cfca51ec180f0059f5f8f8  $tools_zip" | sha1sum --check -
if ! test -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"; then
    mkdir -p "$qa_root/downloads/android-tools"
    unzip -q -o "$tools_zip" -d "$qa_root/downloads/android-tools"
    mv "$qa_root/downloads/android-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi
sdk="$ANDROID_HOME/cmdline-tools/latest/bin"
# This pinned, official pre-CLI SDK manager remains the documented Boat emulator setup.
set +o pipefail
yes | "$sdk/sdkmanager" --licenses > "$qa_root/evidence/sdk-licenses.log"
license_status=$?
set -o pipefail
test "$license_status" = 0
"$sdk/sdkmanager" 'platform-tools' 'emulator' 'system-images;android-30;google_apis;x86_64'
adb="$ANDROID_HOME/platform-tools/adb"
"$ANDROID_HOME/emulator/emulator-check" accel > "$qa_root/evidence/kvm-check.txt"
if ! test -f "$ANDROID_AVD_HOME/raidrift_qa.ini"; then
    echo no | "$sdk/avdmanager" create avd -n raidrift_qa -k 'system-images;android-30;google_apis;x86_64' -d pixel_6
fi
python3 - "$ANDROID_AVD_HOME/raidrift_qa.avd/config.ini" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]); entries={}
for line in p.read_text().splitlines():
    if '=' in line:
        key,value=line.split('=',1); entries[key]=value
entries.update({'hw.camera.back':'virtualscene','hw.camera.front':'none','hw.lcd.width':'720','hw.lcd.height':'1280','hw.lcd.density':'320','hw.ramSize':'3072','hw.cpu.ncore':'2','hw.gpu.enabled':'yes','hw.gpu.mode':'swangle','showDeviceFrame':'no','fastboot.forceColdBoot':'yes'})
p.write_text('\n'.join(f'{k}={v}' for k,v in entries.items())+'\n')
PY
if ! "$adb" devices | grep -q '^emulator-'; then
    nohup "$ANDROID_HOME/emulator/emulator" -avd raidrift_qa -no-window -no-audio -gpu swangle -no-snapshot -no-boot-anim -camera-back virtualscene -accel on -memory 3072 -cores 2 -no-metrics > "$qa_root/evidence/emulator.log" 2>&1 &
    echo "$!" > "$qa_root/emulator.pid"
fi
timeout 120 "$adb" wait-for-device
booted=0
for attempt in $(seq 1 90); do
    if test "$("$adb" shell getprop sys.boot_completed | tr -d '\r')" = 1; then booted=1; break; fi
    sleep 2
done
test "$booted" = 1 || { echo 'Android failed to boot within the QA bound.' >&2; exit 4; }
# API 30 on emulator 37 can select an unreachable virtual Wi-Fi route. Its emulated
# mobile network remains usable; this is not a physical cellular field test.
"$adb" shell svc wifi disable
# API 34 r14 exposes virtualscene as camera 10; the emulator ARCore profile needs 0.
# API 30 r16 exposes the compatible camera. Keep the topology probe as an explicit gate.
"$adb" shell dumpsys media.camera > "$qa_root/evidence/camera-topology.txt"
grep -q 'Device 0 maps to "0"' "$qa_root/evidence/camera-topology.txt" || {
    echo 'The virtual camera HAL is incompatible with the emulator ARCore profile (camera 0 absent).' >&2
    exit 5
}
arcore_apk="$qa_root/downloads/arcore-1.57.0-emulator.apk"
if ! test -f "$arcore_apk"; then curl --fail --location --retry 3 -o "$arcore_apk" https://github.com/google-ar/arcore-android-sdk/releases/download/1.57.0/Google_Play_Services_for_AR_1.57.0_x86_for_emulator.apk; fi
echo "92741f6f873c232a07173b50adeee6b1c2f5a048bc071c80cf741b0cde0f73c4  $arcore_apk" | sha256sum --check -
"$adb" install -r "$arcore_apk"
"$adb" install -r "$apk_path"
"$adb" shell settings put global window_animation_scale 0
"$adb" shell settings put global transition_animation_scale 0
"$adb" shell settings put global animator_duration_scale 0
"$adb" shell am start -W -n world.raidrift.capture.android/world.raidrift.capture.MainActivity
sleep 5
"$adb" exec-out screencap -p > "$qa_root/evidence/initial-preview.png"
"$adb" shell uiautomator dump /sdcard/raidrift-ui.xml
"$adb" pull /sdcard/raidrift-ui.xml "$qa_root/evidence/initial-ui.xml"
"$adb" shell pidof world.raidrift.capture.android > "$qa_root/evidence/app-pid.txt"
"$adb" shell getprop ro.build.fingerprint > "$qa_root/evidence/android-fingerprint.txt"
sha256sum "$apk_path" > "$qa_root/evidence/apk-sha256.txt"
printf '%s\n' 'Android QA environment is ready. Initial screenshot is evidence for inspection, not an automatic AR pass.'
