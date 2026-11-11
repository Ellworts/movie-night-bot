import http from 'http';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const SELF_PING_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (Render free tier sleeps after 15 mins)

export class KeepAliveService {
  private server: http.Server | null = null;
  private pingTimer: NodeJS.Timeout | null = null;

  /**
   * Starts a lightweight HTTP server on `0.0.0.0:PORT` (required by Render Web Services)
   * and schedules an automatic self-ping every 10 minutes if a public URL is configured.
   */
  public start(
    port: number = env.PORT,
    externalUrl: string = env.RENDER_EXTERNAL_URL || env.PUBLIC_URL
  ): void {
    this.server = http.createServer((req, res) => {
      if (req.url === '/' || req.url?.startsWith('/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            status: 'ok',
            service: 'movie-night-bot',
            uptimeSeconds: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    });

    this.server.listen(port, '0.0.0.0', () => {
      logger.info({ port }, 'HTTP health server listening');
    });

    const trimmedUrl = externalUrl.trim().replace(/\/+$/, '');
    if (trimmedUrl) {
      const healthUrl = `${trimmedUrl}/health`;
      logger.info(
        { healthUrl, intervalMinutes: SELF_PING_INTERVAL_MS / 60000 },
        'Self-ping keep-alive enabled'
      );

      this.pingTimer = setInterval(() => {
        void this.pingSelf(healthUrl);
      }, SELF_PING_INTERVAL_MS);
    }
  }

  private async pingSelf(healthUrl: string): Promise<void> {
    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'User-Agent': 'MovieNightBot-KeepAlive/1.0',
        },
      });
      logger.debug({ status: response.status, healthUrl }, 'Self-ping completed');
    } catch (err) {
      logger.warn({ err, healthUrl }, 'Self-ping request failed');
    }
  }

  public async stop(): Promise<void> {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }
  }
}

export const keepAliveService = new KeepAliveService();

