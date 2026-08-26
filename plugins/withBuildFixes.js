const { withProjectBuildGradle, withGradleProperties, withAndroidManifest } = require('@expo/config-plugins');

const SUPPRESS_FLAG = 'suppressKotlinVersionCompatibilityCheck';

const withBuildFixes = (config) => {
  config = withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(SUPPRESS_FLAG)) {
      cfg.modResults.contents += `
subprojects {
    tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
        kotlinOptions {
            freeCompilerArgs = freeCompilerArgs + [
                "-P",
                "plugin:androidx.compose.compiler.plugins.kotlin:suppressKotlinVersionCompatibilityCheck=1.9.25"
            ]
        }
    }
}
`;
    }
    return cfg;
  });

  config = withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const keys = props.map((p) => p.key);
    if (!keys.includes('systemProp.org.gradle.internal.http.socketTimeout')) {
      props.push({ type: 'property', key: 'systemProp.org.gradle.internal.http.socketTimeout', value: '120000' });
    }
    if (!keys.includes('systemProp.org.gradle.internal.http.connectionTimeout')) {
      props.push({ type: 'property', key: 'systemProp.org.gradle.internal.http.connectionTimeout', value: '120000' });
    }
    return cfg;
  });

  // Add Classic Bluetooth permissions required by react-native-bluetooth-classic.
  // Android 12+ permissions (BLUETOOTH_SCAN, BLUETOOTH_CONNECT) come from react-native-ble-plx.
  // The legacy permissions below are required for Android < 12.
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const usesPermission = manifest['uses-permission'] || [];

    const addPermission = (name, extraAttrs = {}) => {
      const exists = usesPermission.find(
        (p) => p.$?.['android:name'] === name
      );
      if (!exists) {
        usesPermission.push({ $: { 'android:name': name, ...extraAttrs } });
      }
    };

    // Classic BT legacy permissions (capped at SDK 30 so they don't apply on Android 12+)
    addPermission('android.permission.BLUETOOTH',       { 'android:maxSdkVersion': '30' });
    addPermission('android.permission.BLUETOOTH_ADMIN', { 'android:maxSdkVersion': '30' });

    manifest['uses-permission'] = usesPermission;
    return cfg;
  });

  return config;
};

module.exports = withBuildFixes;
