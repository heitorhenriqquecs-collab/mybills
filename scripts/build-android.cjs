const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const javaHome = process.env.JAVA_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Jdk21', 'jdk-21.0.12.1+1');
const androidHome = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const result = spawnSync(path.join(projectRoot, 'android', 'gradlew.bat'), ['assembleDebug'], {
  cwd: path.join(projectRoot, 'android'),
  env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome, ANDROID_SDK_ROOT: androidHome },
  stdio: 'inherit',
  shell: true
});
process.exit(result.status ?? 1);
