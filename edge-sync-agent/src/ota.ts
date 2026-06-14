import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import * as winston from 'winston';
import { Config } from './config';
import { NetworkMonitor } from './network';

export interface OtaManifest {
  version: string;
  url: string;
  checksum: string;
  checksumType: 'sha256' | 'md5';
  size: number;
  releaseNotes: string;
  minVersion?: string;
  forceUpdate?: boolean;
}

export class OtaManager {
  private logger: winston.Logger;
  private config: Config['ota'];
  private cloudConfig: Config['cloud'];
  private network: NetworkMonitor;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentVersion: string;

  constructor(
    config: Config,
    network: NetworkMonitor,
    logger: winston.Logger
  ) {
    this.config = config.ota;
    this.cloudConfig = config.cloud;
    this.network = network;
    this.logger = logger.child({ component: 'ota' });
    this.currentVersion = require('../package.json').version;

    // Ensure download directory exists
    if (!fs.existsSync(this.config.downloadDir)) {
      fs.mkdirSync(this.config.downloadDir, { recursive: true });
    }
  }

  start(): void {
    this.timer = setInterval(() => this.checkForUpdate(), this.config.checkIntervalMs);
    this.logger.info('OTA manager started', {
      currentVersion: this.currentVersion,
      checkIntervalMs: this.config.checkIntervalMs,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkForUpdate(): Promise<OtaManifest | null> {
    if (!this.network.isOnline()) {
      this.logger.debug('Skipping OTA check — offline');
      return null;
    }

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.cloudConfig.apiKey}`,
          'X-Device-Id': this.cloudConfig.deviceId,
          'X-Current-Version': this.currentVersion,
          'X-Platform': `${process.platform}-${process.arch}`,
          'X-Node-Version': process.version,
        },
        timeout: 15000,
      });

      if (response.status === 204) {
        this.logger.debug('No OTA update available');
        return null;
      }

      if (!response.ok) {
        this.logger.warn('OTA check failed', { status: response.status });
        return null;
      }

      const manifest = (await response.json()) as OtaManifest;
      this.logger.info('OTA update available', {
        current: this.currentVersion,
        target: manifest.version,
        size: manifest.size,
      });

      return manifest;
    } catch (err: any) {
      this.logger.debug('OTA check error', { error: err.message });
      return null;
    }
  }

  async downloadUpdate(manifest: OtaManifest): Promise<string | null> {
    if (!this.network.isOnline()) {
      this.logger.warn('Cannot download OTA — offline');
      return null;
    }

    const destPath = path.join(this.config.downloadDir, `edge-sync-agent-${manifest.version}.tar.gz`);

    // Check if already downloaded
    if (fs.existsSync(destPath)) {
      const stat = fs.statSync(destPath);
      if (stat.size === manifest.size) {
        this.logger.info('Update already downloaded', { version: manifest.version });
        return destPath;
      }
    }

    this.logger.info('Downloading OTA update', {
      version: manifest.version,
      url: manifest.url,
      size: manifest.size,
    });

    try {
      const response = await fetch(manifest.url, {
        headers: {
          'Authorization': `Bearer ${this.cloudConfig.apiKey}`,
        },
        timeout: 300000, // 5 min for large downloads
      });

      if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status}`);
      }

      const buffer = await response.buffer();
      fs.writeFileSync(destPath, buffer);

      // Verify checksum
      const hash = crypto.createHash(manifest.checksumType || 'sha256')
        .update(buffer)
        .digest('hex');

      if (hash !== manifest.checksum) {
        fs.unlinkSync(destPath);
        this.logger.error('OTA checksum mismatch', {
          expected: manifest.checksum,
          actual: hash,
        });
        return null;
      }

      this.logger.info('OTA download complete and verified', {
        version: manifest.version,
        path: destPath,
      });

      return destPath;
    } catch (err: any) {
      this.logger.error('OTA download failed', { error: err.message });
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      return null;
    }
  }

  async applyUpdate(archivePath: string, manifest: OtaManifest): Promise<boolean> {
    this.logger.info('Applying OTA update', { version: manifest.version });

    const appDir = path.join(__dirname, '..');
    const backupDir = path.join(this.config.downloadDir, `backup-${this.currentVersion}`);

    try {
      // Backup current installation
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // Backup key files
      for (const file of ['package.json', 'dist']) {
        const src = path.join(appDir, file);
        const dest = path.join(backupDir, file);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }

      // Extract archive
      const { execSync } = require('child_process');
      execSync(`tar -xzf "${archivePath}" -C "${appDir}"`, { timeout: 60000 });

      // Install dependencies
      execSync('npm install --production', {
        cwd: appDir,
        timeout: 120000,
        env: { ...process.env, NODE_ENV: 'production' },
      });

      this.logger.info('OTA update applied successfully', {
        version: manifest.version,
        restartRequired: true,
      });

      // Signal restart (systemd will restart us)
      this.logger.info('Initiating graceful restart...');
      setTimeout(() => {
        process.exit(0); // systemd will restart
      }, 5000);

      return true;
    } catch (err: any) {
      this.logger.error('OTA apply failed, rolling back', { error: err.message });

      // Rollback
      try {
        if (fs.existsSync(backupDir)) {
          fs.cpSync(backupDir, appDir, { recursive: true });
          this.logger.info('Rollback completed');
        }
      } catch (rollbackErr: any) {
        this.logger.error('Rollback failed!', { error: rollbackErr.message });
      }

      return false;
    }
  }
}
