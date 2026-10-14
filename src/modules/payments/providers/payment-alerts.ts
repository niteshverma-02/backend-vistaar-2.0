import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

/**
 * Tells finance and tech the moment payment keys change, so a change nobody
 * expected is caught in minutes. A Slack incoming webhook; the text carries
 * only masked values. A failed alert never fails the change — it is logged.
 */
@Injectable()
export class PaymentAlerts {
  private readonly logger = new Logger(PaymentAlerts.name);
  private readonly url: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.url = config.get('PAYMENTS_ALERT_WEBHOOK_URL', { infer: true });
  }

  async send(text: string): Promise<void> {
    // Always in the log too, so the change is on record without Slack.
    this.logger.warn(`[payment-credentials] ${text}`);
    if (!this.url) return;
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `:lock: Vistaar payments — ${text}` }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) this.logger.error(`payment alert answered ${res.status}`);
    } catch (error) {
      this.logger.error(`payment alert not sent: ${String(error)}`);
    }
  }
}
