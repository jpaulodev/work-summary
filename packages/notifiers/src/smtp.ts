import nodemailer, { type Transporter } from 'nodemailer';
import { renderDigest } from './render.js';
import type { Notifier, NotificationPayload, SmtpOptions } from './types.js';

export class SmtpError extends Error {
  override readonly name = 'SmtpError';
}

export class SmtpNotifier implements Notifier {
  readonly id = 'smtp';
  private transporter: Transporter;

  constructor(private readonly opts: SmtpOptions) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: opts.user || opts.pass ? { user: opts.user, pass: opts.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }

  async send(payload: NotificationPayload): Promise<void> {
    const { html, text } = renderDigest(payload);
    try {
      await this.transporter.sendMail({
        from: this.opts.from,
        to: this.opts.to,
        subject: payload.subject,
        html,
        text,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SmtpError(`SMTP send failed: ${msg}`);
    }
  }

  async verify(): Promise<void> {
    try {
      await this.transporter.verify();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SmtpError(`SMTP verify failed: ${msg}`);
    }
  }
}
