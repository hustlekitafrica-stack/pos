const { withProjectBuildGradle, withGradleProperties } = require('@expo/config-plugins');

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

  return config;
};

module.exports = withBuildFixes;
