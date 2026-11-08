jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

const sendMail = jest.fn<Promise<object>, [Record<string, unknown>]>().mockResolvedValue({});
const createTransport = jest.fn().mockReturnValue({ sendMail });
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport } }));

import { SmtpEmailSender } from './smtp-email-sender';

function config(values: Record<string, string | undefined>) {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] === undefined) {
        throw new Error(`Missing ${key}`);
      }
      return values[key];
    },
  } as never;
}

describe('SmtpEmailSender', () => {
  beforeEach(() => {
    createTransport.mockClear();
    sendMail.mockClear();
  });

  it('uses a generic SMTP server such as Mailpit when SMTP_HOST is set', async () => {
    const sender = new SmtpEmailSender(config({ SMTP_HOST: 'mailpit', SMTP_PORT: '1025', SMTP_SECURE: 'false' }));

    expect(createTransport).toHaveBeenCalledWith({ host: 'mailpit', port: 1025, secure: false, auth: undefined });

    await sender.sendAccountActivationEmail({ to: 'ana@example.com', name: 'Ana', activationUrl: 'https://x/activate' });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ana@example.com', from: 'SmartHome <no-reply@smarthome.local>' }),
    );
    expect(JSON.stringify(sendMail.mock.calls[0][0])).toContain('https://x/activate');
  });

  it('authenticates against the SMTP host when credentials are configured', () => {
    new SmtpEmailSender(
      config({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'bot', SMTP_APP_PASSWORD: 'secret', SMTP_SECURE: 'true', SMTP_FROM: 'Bot <bot@example.com>' }),
    );
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: true,
      auth: { user: 'bot', pass: 'secret' },
    });
  });

  it('falls back to the Gmail service without SMTP_HOST', async () => {
    const sender = new SmtpEmailSender(config({ SMTP_USER: 'team@gmail.com', SMTP_APP_PASSWORD: 'app' }));
    expect(createTransport).toHaveBeenCalledWith({ service: 'gmail', auth: { user: 'team@gmail.com', pass: 'app' } });

    await sender.sendPasswordResetEmail({ to: 'ana@example.com', name: 'Ana', resetUrl: 'https://x/reset' });
    await sender.sendAccountReactivationEmail({ to: 'ana@example.com', name: 'Ana', reactivationUrl: 'https://x/re' });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('requires Gmail credentials when no SMTP host is configured', () => {
    expect(() => new SmtpEmailSender(config({}))).toThrow('Missing SMTP_USER');
  });
});
