import {
  requireShellyMqttDeploymentMode,
  selectShellyMqttDeploymentMode,
  selectShellyMqttProviderPlan,
} from './shelly-mqtt-deployment-mode';

const password = 'SYNTHETIC_NOT_A_REAL_SECRET';
const db = (database: string) =>
  `postgresql://dev_user:${password}@postgres-dev:5432/${database}`;

const vps = () => ({
  NODE_ENV: 'production',
  APP_ENV: 'development',
  MQTT_ENABLED: 'false',
  SHELLY_MQTT_DEV_DI_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_TLS_ENABLED: 'true',
  DATABASE_URL: db('smarthome_dev'),
  DATABASE_IOT_URL: db('smarthome_dev'),
});

describe('MQTT - seleccion segura de perfiles de DI', () => {
  it('mantiene desactivada la DI sin opt-in', () => {
    expect(selectShellyMqttDeploymentMode({ NODE_ENV: 'production' })).toBe('off');
    expect(() => requireShellyMqttDeploymentMode({ NODE_ENV: 'production' }))
      .toThrow('MQTT_DEV_DI_DISABLED');
  });

  it('conserva local-dev solo para NODE_ENV development', () => {
    expect(selectShellyMqttDeploymentMode({
      NODE_ENV: 'development', SHELLY_MQTT_DEV_DI_ENABLED: 'true',
    })).toBe('local-dev');
  });

  it('acepta unicamente el opt-in explicito para VPS DEV con la BD DEV', () => {
    expect(selectShellyMqttDeploymentMode(vps())).toBe('vps-dev-tls');
    expect(requireShellyMqttDeploymentMode(vps())).toBe('vps-dev-tls');
  });

  it.each(['DATABASE_URL', 'DATABASE_IOT_URL'] as const)(
    'impide %s conectada a smarthome de produccion', (key) => {
      expect(() => selectShellyMqttDeploymentMode({
        ...vps(), [key]: db('smarthome'),
      })).toThrow('MQTT_DEV_DI_MODE_NOT_ALLOWED');
    },
  );

  it.each([
    { APP_ENV: 'production' },
    { APP_ENV: undefined },
    { MQTT_ENABLED: 'true' },
    { MQTT_ENABLED: undefined },
    { SHELLY_MQTT_VPS_DEV_TLS_ENABLED: 'false' },
    { NODE_ENV: 'test' },
  ])('rechaza seleccion VPS ante combinacion no autorizada: %j', (override) => {
    expect(() => selectShellyMqttDeploymentMode({ ...vps(), ...override }))
      .toThrow('MQTT_DEV_DI_MODE_NOT_ALLOWED');
  });

  it('impide confundir local-dev con perfil VPS activado', () => {
    expect(() => selectShellyMqttDeploymentMode({
      NODE_ENV: 'development',
      SHELLY_MQTT_DEV_DI_ENABLED: 'true',
      SHELLY_MQTT_VPS_DEV_TLS_ENABLED: 'true',
    })).toThrow('MQTT_DEV_DI_MODE_NOT_ALLOWED');
  });

  it('rechaza URL mal formada sin exponerla en el error', () => {
    expect(() => selectShellyMqttDeploymentMode({
      ...vps(), DATABASE_URL: 'not-a-url',
    })).toThrow('MQTT_DEV_DI_MODE_NOT_ALLOWED');
  });

  it('mantiene VPS DEV limitado a DB-only sin coordinadores MQTT', () => {
    expect(selectShellyMqttProviderPlan(vps())).toEqual({
      mode: 'vps-dev-tls',
      localWorkflow: false,
      vpsPgOnly: true,
      localAuthWorker: false,
      vpsAuthPgOnly: false,
    });
  });

  it('permite SQL RPC/auth en VPS solo con el segundo opt-in', () => {
    const env = { ...vps(), SHELLY_MQTT_AUTH_DEV_DI_ENABLED: 'true' };
    expect(selectShellyMqttProviderPlan(env)).toMatchObject({
      vpsPgOnly: true,
      vpsAuthPgOnly: true,
      localWorkflow: false,
      localAuthWorker: false,
    });
  });

  it('mantiene el flujo local y no selecciona PG-only VPS', () => {
    const env = {
      NODE_ENV: 'development',
      SHELLY_MQTT_DEV_DI_ENABLED: 'true',
      SHELLY_MQTT_AUTH_DEV_DI_ENABLED: 'true',
    };
    expect(selectShellyMqttProviderPlan(env)).toMatchObject({
      mode: 'local-dev',
      localWorkflow: true,
      vpsPgOnly: false,
      localAuthWorker: true,
      vpsAuthPgOnly: false,
    });
  });

  it('no registra providers adicionales sin opt-in', () => {
    expect(selectShellyMqttProviderPlan({ NODE_ENV: 'production' })).toEqual({
      mode: 'off',
      localWorkflow: false,
      vpsPgOnly: false,
      localAuthWorker: false,
      vpsAuthPgOnly: false,
    });
  });

});
