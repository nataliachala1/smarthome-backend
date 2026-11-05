import type { ConfigService } from '@nestjs/config';

jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigServiceMock {},
}));
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import type { IClientOptions } from 'mqtt';
import { MosquittoDynamicSecurityProvider } from './mosquitto-dynamic-security.provider';

type InspectableProvider = {
  settings(): { url: string; options: IClientOptions };
};

function provider(environment: Record<string, string>): InspectableProvider {
  const config = {
    get: (key: string): string | undefined => environment[key],
  } as ConfigService;
  return new MosquittoDynamicSecurityProvider(config) as unknown as InspectableProvider;
}

const base = {
  NODE_ENV: 'development',
  MQTT_DYNSEC_ADMIN_URL: 'mqtts://192.168.1.24:8883',
  MQTT_DYNSEC_ADMIN_USERNAME: 'un-usuario-de-prueba',
  MQTT_DYNSEC_ADMIN_PASSWORD: 'una-contrasena-de-prueba',
};

describe('DynSec admin TLS con CA privada (sin red)', () => {
  it('carga CA PEM confiable sin desactivar verificacion de servidor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smarthome-dynsec-ca-'));
    try {
      const caPath = join(dir, 'ca.crt');
      writeFileSync(caPath, rootCertificates[0], 'utf8');
      const config = provider({ ...base, MQTT_DYNSEC_ADMIN_CA_FILE: caPath }).settings();
      expect(config.url).toBe(base.MQTT_DYNSEC_ADMIN_URL);
      expect(config.options.ca).toEqual(Buffer.from(rootCertificates[0]));
      expect(config.options.rejectUnauthorized).toBe(true);
      expect(config.options.minVersion).toBe('TLSv1.2');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('falla cerrado con CA inexistente o invalida', () => {
    expect(() => provider({ ...base, MQTT_DYNSEC_ADMIN_CA_FILE: 'Z:/no-existe/ca.crt' }).settings())
      .toThrow();
    const dir = mkdtempSync(join(tmpdir(), 'smarthome-dynsec-invalid-'));
    try {
      const path = join(dir, 'invalid.crt');
      writeFileSync(path, 'NO ES UN CERTIFICADO');
      expect(() => provider({ ...base, MQTT_DYNSEC_ADMIN_CA_FILE: path }).settings())
        .toThrow();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('rechaza CA personalizada con transporte sin TLS', () => {
    const config = provider({
      ...base,
      MQTT_DYNSEC_ADMIN_URL: 'mqtt://127.0.0.1:1883',
      MQTT_DYNSEC_ADMIN_CA_FILE: 'C:/no-importa.crt',
    });
    expect(() => config.settings()).toThrow();
  });

  it('conserva TLS publico sin CA configurada', () => {
    const config = provider(base).settings();
    expect(config.options.rejectUnauthorized).toBe(true);
    expect(config.options.ca).toBeUndefined();
  });
});
