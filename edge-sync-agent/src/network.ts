import * as os from 'os';
import * as dns from 'dns';
import { promisify } from 'util';
import * as winston from 'winston';

const dnsLookup = promisify(dns.lookup);

export interface NetworkStatus {
  online: boolean;
  interface: string;
  ip: string;
  latencyMs: number;
  lastCheck: Date;
}

export class NetworkMonitor {
  private logger: winston.Logger;
  private lastStatus: NetworkStatus | null = null;
  private checkHosts = ['8.8.8.8', '1.1.1.1', '208.67.222.222'];

  constructor(logger: winston.Logger) {
    this.logger = logger.child({ component: 'network' });
  }

  async check(): Promise<NetworkStatus> {
    const start = Date.now();
    let online = false;
    let ip = 'unknown';
    let iface = 'unknown';

    // Check DNS resolution as connectivity test
    for (const host of this.checkHosts) {
      try {
        await dnsLookup(host);
        online = true;
        break;
      } catch {
        continue;
      }
    }

    // Get local IP and interface
    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (!addr.internal && addr.family === 'IPv4') {
          ip = addr.address;
          iface = name;
          break;
        }
      }
      if (ip !== 'unknown') break;
    }

    const status: NetworkStatus = {
      online,
      interface: iface,
      ip,
      latencyMs: Date.now() - start,
      lastCheck: new Date(),
    };

    // Log transitions
    if (this.lastStatus && this.lastStatus.online !== status.online) {
      if (status.online) {
        this.logger.info('Network connectivity restored', { interface: iface, ip });
      } else {
        this.logger.warn('Network connectivity lost — entering offline mode');
      }
    }

    this.lastStatus = status;
    return status;
  }

  isOnline(): boolean {
    return this.lastStatus?.online ?? false;
  }

  getLastStatus(): NetworkStatus | null {
    return this.lastStatus;
  }
}
