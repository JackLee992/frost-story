#!/usr/bin/env bash
set -euo pipefail

signing_dir="${FROST_STORY_SIGNING_DIR:-${HOME}/.frost-story}"
properties_file="${signing_dir}/release-signing.properties"
keystore_file="${signing_dir}/frost-story-release.jks"

if [[ -f "${properties_file}" && -f "${keystore_file}" ]]; then
  echo "release signing already configured at ${properties_file}"
  exit 0
fi

mkdir -p "${signing_dir}"
chmod 700 "${signing_dir}"
password="$(openssl rand -hex 24)"
keytool_bin="${JAVA_HOME:+${JAVA_HOME}/bin/keytool}"
if [[ ! -x "${keytool_bin}" ]]; then
  keytool_bin="/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool"
fi
if [[ ! -x "${keytool_bin}" ]]; then
  echo "Android Studio JDK keytool was not found" >&2
  exit 1
fi

"${keytool_bin}" -genkeypair -noprompt \
  -keystore "${keystore_file}" \
  -storepass "${password}" \
  -keypass "${password}" \
  -alias froststory \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -dname "CN=Frost Story, OU=Release, O=Frost Story, L=Shanghai, ST=Shanghai, C=CN"

tmp_file="${properties_file}.tmp"
umask 077
printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=froststory\nkeyPassword=%s\n' \
  "${keystore_file}" "${password}" "${password}" > "${tmp_file}"
mv "${tmp_file}" "${properties_file}"
chmod 600 "${properties_file}" "${keystore_file}"
unset password

echo "created release key and private Gradle properties under ${signing_dir}"
echo "back up that directory securely; losing it prevents APK updates"
