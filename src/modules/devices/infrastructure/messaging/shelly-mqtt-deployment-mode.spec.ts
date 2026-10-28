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

const vpsDevDatabase = (database = 'smarthome_dev', username = 'app_user') =>
  `postgresql://${username}:synthetic-password@smart-home-smarthomepostgresdev-vrmtpz:5432/${database}`;
const dedicatedDb = (username: string) =>
  `postgresql://${username}:${'A'.repeat(43)}@smart-home-smarthomepostgresdev-vrmtpz:5432/smarthome_dev`;

const vpsPairing = () => ({
  ...vps(),
  MQTT_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_REVOCATION_WORKER_ENABLED: 'true',
  SHELLY_MQTT_VPS_DEV_BROKER_HOST: 'mosquitto-dev',
  DATABASE_URL: vpsDevDatabase(),
  DATABASE_IOT_URL: vpsDevDatabase('smarthome_dev', 'iot_user'),
  MQTT_BROKER_URL: 'mqtts://mosquitto-dev:8883',
  MQTT_USERNAME: 'backend-service',
  MQTT_PASSWORD: 'synthetic-backend-password',
  MQTT_TOPIC_NAMESPACE: 'smarthome/dev/v1',
  MQTT_TLS_CA_FILE: '/run/secrets/mosquitto-dev-ca.pem',
  MQTT_TLS_REJECT_UNAUTHORIZED: 'true',
  MQTT_DYNSEC_ADMIN_URL: 'mqtts://mosquitto-dev:8883',
  MQTT_DYNSEC_ADMIN_USERNAME: 'backend-admin',
  MQTT_DYNSEC_ADMIN_PASSWORD: 'synthetic-admin-password',
  MQTT_DYNSEC_ADMIN_CA_FILE: '/run/secrets/mosquitto-dev-admin-ca.pem',
  SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL:
    'mqtts://mqtt-dev.179-236-82-122.sslip.io:443',
  SHELLY_MQTT_VPS_DEV_DEVICE_CA_FILE: '/run/secrets/shelly-public-ca.pem',
  MQTT_RESERVER_DATABASE_URL: dedicatedDb('smarthome_mqtt_reserver_dev_login'),
  MQTT_LEASE_DATABASE_URL: dedicatedDb('smarthome_mqtt_lease_dev_login'),
  MQTT_CONFIRMER_DATABASE_URL: dedicatedDb('smarthome_mqtt_confirmer_dev_login'),
  MQTT_SECRET_DATABASE_URL: dedicatedDb('smarthome_mqtt_secret_dev_login'),
  MQTT_REVOCATION_DATABASE_URL: dedicatedDb('smarthome_mqtt_revoke_dev_login'),
  MQTT_PREPARATION_AES_KEY_B64URL: Buffer.alloc(32, 7).toString('base64url'),
  MQTT_PREPARATION_AES_KEY_ID: 'dev-mqtt-aes-v1',
});

describe('MQTT: seleccion segura de perfiles DI', () => {
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

  it('acepta el opt-in VPS DEV PG-only con ambas DB en DEV', () => {
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

  it('permite VPS DEV MQTT transport solo con su opt-in propio', () => {
    const env = { ...vps(), MQTT_ENABLED: 'true',
      SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED: 'true' };
    expect(selectShellyMqttProviderPlan(env)).toMatchObject({
      mode: 'vps-dev-tls',
      vpsPgOnly: true,
      vpsPairing: false,
      localWorkflow: false,
      localAuthWorker: false,
    });
  });

  it('no admite MQTT=true en VPS DEV sin autorizacion especifica de transporte', () => {
    expect(() => selectShellyMqttDeploymentMode({
      ...vps(), MQTT_ENABLED: 'true',
    })).toThrow('MQTT_DEV_DI_MODE_NOT_ALLOWED');
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

  it('mantiene VPS DEV en SQL-only por defecto', () => {
    expect(selectShellyMqttProviderPlan(vps())).toEqual({
      mode: 'vps-dev-tls',
      localWorkflow: false,
      vpsPgOnly: true,
      vpsPairing: false,
      localAuthWorker: false,
      vpsAuthPgOnly: false,
      vpsAuthWorker: false,
      vpsRevocationWorker: false,
    });
  });

  it('permite SQL RPC/auth en VPS solo con el segundo opt-in', () => {
    const env = { ...vps(), SHELLY_MQTT_AUTH_DEV_DI_ENABLED: 'true' };
    expect(selectShellyMqttProviderPlan(env)).toMatchObject({
      vpsPgOnly: true,
      vpsPairing: false,
      vpsAuthPgOnly: true,
      localWorkflow: false,
      localAuthWorker: false,
      vpsAuthWorker: false,
      vpsRevocationWorker: false,
    });
  });

  it('mantiene el flujo local y no selecciona pairing VPS', () => {
    const env = {
      NODE_ENV: 'development',
      SHELLY_MQTT_DEV_DI_ENABLED: 'true',
      SHELLY_MQTT_AUTH_DEV_DI_ENABLED: 'true',
      SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED: 'true',
    };
    expect(selectShellyMqttProviderPlan(env)).toMatchObject({
      mode: 'local-dev',
      localWorkflow: true,
      vpsPgOnly: false,
      vpsPairing: false,
      localAuthWorker: true,
      vpsAuthPgOnly: false,
      vpsAuthWorker: false,
      vpsRevocationWorker: false,
    });
  });

  it('no registra providers adicionales en Production sin opt-in', () => {
    expect(selectShellyMqttProviderPlan({
      NODE_ENV: 'production', APP_ENV: 'production',
      SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED: 'true',
    })).toEqual({
      mode: 'off',
      localWorkflow: false,
      vpsPgOnly: false,
      vpsPairing: false,
      localAuthWorker: false,
      vpsAuthPgOnly: false,
      vpsAuthWorker: false,
      vpsRevocationWorker: false,
    });
  });

  it('activa vpsPairing solo si el worker de revocacion y la configuración están preparados', () => {
    expect(selectShellyMqttProviderPlan(vpsPairing())).toEqual({
      mode: 'vps-dev-tls',
      localWorkflow: false,
      vpsPgOnly: true,
      vpsPairing: true,
      localAuthWorker: false,
      vpsAuthPgOnly: false,
      vpsAuthWorker: false,
      vpsRevocationWorker: true,
    });
  });

  it.each(['DATABASE_URL', 'DATABASE_IOT_URL'] as const)(
    'permite sslmode=require en la conexion general %s', (key) => {
      const env = {
        ...vpsPairing(),
        [key]: `${vpsDevDatabase()}?sslmode=require`,
      };

      expect(selectShellyMqttProviderPlan(env).vpsPairing).toBe(true);
      expect(selectShellyMqttProviderPlan(env).vpsRevocationWorker).toBe(true);
    },
  );

  it.each([
    '?sslmode=verify-ca',
    '?sslmode=require&application_name=backend',
    '?application_name=backend',
    '?SSLMode=require',
    '?sslmode=require&',
  ])('rechaza el parámetro no autorizado %s en ambas conexiones generales', (query) => {
    for (const key of ['DATABASE_URL', 'DATABASE_IOT_URL'] as const) {
      const env = {
        ...vpsPairing(),
        [key]: `${vpsDevDatabase()}${query}`,
      };

      expect(selectShellyMqttProviderPlan(env).vpsPairing).toBe(false);
      expect(selectShellyMqttProviderPlan(env).vpsRevocationWorker).toBe(false);
    }
  });

  it.each([
    ['MQTT_RESERVER_DATABASE_URL', 'smarthome_mqtt_reserver_dev_login'],
    ['MQTT_LEASE_DATABASE_URL', 'smarthome_mqtt_lease_dev_login'],
    ['MQTT_CONFIRMER_DATABASE_URL', 'smarthome_mqtt_confirmer_dev_login'],
    ['MQTT_SECRET_DATABASE_URL', 'smarthome_mqtt_secret_dev_login'],
    ['MQTT_REVOCATION_DATABASE_URL', 'smarthome_mqtt_revoke_dev_login'],
  ] as const)(
    'continúa rechazando parámetros en la conexión especializada %s', (key, username) => {
      const env = {
        ...vpsPairing(),
        [key]: `${dedicatedDb(username)}?sslmode=require`,
      };

      expect(selectShellyMqttProviderPlan(env).vpsPairing).toBe(false);
    },
  );

  it('registra el worker de autenticación VPS solo con ambos opt-ins', () => {
    const env = {
      ...vpsPairing(),
      SHELLY_MQTT_AUTH_DEV_DI_ENABLED: 'true',
      SHELLY_MQTT_VPS_DEV_AUTH_WORKER_ENABLED: 'true',
    };
    expect(selectShellyMqttProviderPlan(env)).toMatchObject({
      vpsPairing: true,
      vpsAuthPgOnly: false,
      vpsAuthWorker: true,
      vpsRevocationWorker: true,
      localWorkflow: false,
      localAuthWorker: false,
    });
  });

  it('no activa el worker VPS si falla el pairing o falta su opt-in explícito', () => {
    const env = {
      ...vpsPairing(),
      SHELLY_MQTT_AUTH_DEV_DI_ENABLED: 'true',
      SHELLY_MQTT_VPS_DEV_AUTH_WORKER_ENABLED: 'true',
    };
    expect(selectShellyMqttProviderPlan({
      ...env, SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED: 'false',
    }).vpsAuthWorker).toBe(false);
    expect(selectShellyMqttProviderPlan({
      ...env, SHELLY_MQTT_VPS_DEV_AUTH_WORKER_ENABLED: undefined,
    }).vpsAuthWorker).toBe(false);
  });

  it('no activa vpsPairing cuando falta el opt-in propio', () => {
    const env = {
      ...vpsPairing(), SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED: undefined,
    };
    expect(selectShellyMqttProviderPlan(env).vpsPairing).toBe(false);
  });

  it('mantiene bootstrap y pairing apagados si el worker de revocación no está autorizado', () => {
    const env = {
      ...vpsPairing(), SHELLY_MQTT_VPS_DEV_REVOCATION_WORKER_ENABLED: 'false',
    };
    expect(selectShellyMqttProviderPlan(env)).toMatchObject({
      vpsPairing: false, vpsRevocationWorker: false, vpsAuthWorker: false,
    });
  });

  it.each([
    { DATABASE_URL: vpsDevDatabase('smarthome') },
    { DATABASE_IOT_URL: undefined },
    { SHELLY_MQTT_VPS_DEV_TLS_ENABLED: 'false' },
  ])('rechaza el perfil VPS completo ante DB o TLS base no autorizados: %j', (override) => {
    expect(() => selectShellyMqttProviderPlan({ ...vpsPairing(), ...override }))
      .toThrow('MQTT_DEV_DI_MODE_NOT_ALLOWED');
  });

  it.each([
    { MQTT_ENABLED: 'false' },
    { MQTT_TLS_REJECT_UNAUTHORIZED: 'false' },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { SHELLY_MQTT_VPS_DEV_BROKER_HOST: 'unexpected-broker' },
    { MQTT_BROKER_URL: 'mqtt://mosquitto-dev:1883' },
    { MQTT_BROKER_URL: 'mqtts://other-broker:8883' },
    { MQTT_BROKER_URL: 'mqtts://mosquitto-dev:1884' },
    { MQTT_USERNAME: undefined },
    { MQTT_PASSWORD: undefined },
    { MQTT_TOPIC_NAMESPACE: 'smarthome/production/v1' },
    { MQTT_TLS_CA_FILE: undefined },
    { MQTT_DYNSEC_ADMIN_URL: 'mqtt://mosquitto-dev:1883' },
    { MQTT_DYNSEC_ADMIN_USERNAME: undefined },
    { MQTT_DYNSEC_ADMIN_PASSWORD: undefined },
    { MQTT_DYNSEC_ADMIN_USERNAME: 'backend-service' },
    { MQTT_DYNSEC_ADMIN_PASSWORD: 'synthetic-backend-password' },
    { MQTT_DYNSEC_ADMIN_CA_FILE: undefined },
    { SHELLY_MQTT_VPS_DEV_DEVICE_BROKER_URL: 'mqtts://mosquitto-dev:8883' },
    { SHELLY_MQTT_VPS_DEV_DEVICE_CA_FILE: undefined },
    { SHELLY_MQTT_VPS_DEV_DEVICE_CA_FILE: '/run/secrets/mosquitto-dev-ca.pem' },
    { SHELLY_MQTT_VPS_DEV_DEVICE_CA_FILE: '/run/secrets/mosquitto-dev-admin-ca.pem' },
    { MQTT_RESERVER_DATABASE_URL: dedicatedDb('smarthome_mqtt_lease_dev_login') },
    { MQTT_LEASE_DATABASE_URL: undefined },
    { MQTT_CONFIRMER_DATABASE_URL: dedicatedDb('smarthome_mqtt_lease_dev_login') },
    { MQTT_SECRET_DATABASE_URL: dedicatedDb('smarthome_mqtt_secret_dev_login').replace('/smarthome_dev', '/smarthome') },
    { MQTT_REVOCATION_DATABASE_URL: dedicatedDb('smarthome_mqtt_lease_dev_login') },
    { MQTT_REVOCATION_DATABASE_URL: undefined },
    { MQTT_PREPARATION_AES_KEY_B64URL: undefined },
    { MQTT_PREPARATION_AES_KEY_ID: 'unexpected-key' },
  ])('mantiene vpsPairing apagado ante precondicion insegura: %j', (override) => {
    expect(selectShellyMqttProviderPlan({ ...vpsPairing(), ...override })
      .vpsPairing).toBe(false);
  });

  it('rechaza flags de transporte incompatibles antes de seleccionar pairing', () => {
    expect(() => selectShellyMqttProviderPlan({
      ...vpsPairing(), SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED: 'false',
    })).toThrow('MQTT_DEV_DI_MODE_NOT_ALLOWED');
  });
});
