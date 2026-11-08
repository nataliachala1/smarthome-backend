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

const productionDb = (username: string, database = 'smarthome') =>
  `postgresql://${username}:${'B'.repeat(43)}@postgres-prod.example.com:5432/${database}`;

const productionPairing = () => ({
  NODE_ENV: 'production',
  APP_ENV: 'production',
  SHELLY_MQTT_PRODUCTION_PAIRING_ENABLED: 'true',
  SHELLY_MQTT_PRODUCTION_REVOCATION_WORKER_ENABLED: 'true',
  SHELLY_MQTT_PRODUCTION_AUTH_WORKER_ENABLED: 'true',
  MQTT_ENABLED: 'true',
  MQTT_BROKER_PROVIDER: 'mosquitto',
  MQTT_BROKER_URL: 'mqtts://mosquitto-internal:8883',
  MQTT_DYNSEC_ADMIN_URL: 'mqtts://mosquitto-internal:8883',
  MQTT_USERNAME: 'backend-service',
  MQTT_PASSWORD: 'synthetic-backend-password',
  MQTT_DYNSEC_ADMIN_USERNAME: 'dynsec-admin',
  MQTT_DYNSEC_ADMIN_PASSWORD: 'synthetic-independent-admin-password',
  MQTT_TOPIC_NAMESPACE: 'smarthome/prod/v1',
  MQTT_TLS_CA_FILE: '/run/secrets/prod-broker-root.pem',
  MQTT_DYNSEC_ADMIN_CA_FILE: '/run/secrets/prod-broker-root.pem',
  SHELLY_MQTT_PRODUCTION_DEVICE_BROKER_URL: 'mqtts://mqtt.prod.example.com:8883',
  SHELLY_MQTT_PRODUCTION_DEVICE_CA_FILE: '/run/secrets/prod-broker-root.pem',
  DATABASE_URL: productionDb('smarthome_app_login'),
  DATABASE_IOT_URL: productionDb('smarthome_ingest_login'),
  MQTT_RESERVER_DATABASE_URL: productionDb('smarthome_mqtt_reserver_prod_login'),
  MQTT_LEASE_DATABASE_URL: productionDb('smarthome_mqtt_lease_prod_login'),
  MQTT_CONFIRMER_DATABASE_URL: productionDb('smarthome_mqtt_confirmer_prod_login'),
  MQTT_SECRET_DATABASE_URL: productionDb('smarthome_mqtt_secret_prod_login'),
  MQTT_REVOCATION_DATABASE_URL: productionDb('smarthome_mqtt_revoke_prod_login'),
  MQTT_RPC_DATABASE_URL: productionDb('smarthome_mqtt_rpc_prod_login'),
  MQTT_AUTH_DATABASE_URL: productionDb('smarthome_mqtt_auth_prod_login'),
  MQTT_PREPARATION_AES_KEY_B64URL: Buffer.alloc(32, 9).toString('base64url'),
  MQTT_PREPARATION_AES_KEY_ID: 'prod-mqtt-aes-v1',
});

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

describe('MQTT: safe selection of DI profiles', () => {
  it('keeps DI disabled without opt-in', () => {
    expect(selectShellyMqttDeploymentMode({ NODE_ENV: 'production' })).toBe('off');
    expect(() => requireShellyMqttDeploymentMode({ NODE_ENV: 'production' }))
      .toThrow('MQTT_DEV_DI_DISABLED');
  });

  it('keeps local-dev only for NODE_ENV development', () => {
    expect(selectShellyMqttDeploymentMode({
      NODE_ENV: 'development', SHELLY_MQTT_DEV_DI_ENABLED: 'true',
    })).toBe('local-dev');
  });

  it('accepts the VPS DEV PG-only opt-in with both DBs in DEV', () => {
    expect(selectShellyMqttDeploymentMode(vps())).toBe('vps-dev-tls');
    expect(requireShellyMqttDeploymentMode(vps())).toBe('vps-dev-tls');
  });

  it.each(['DATABASE_URL', 'DATABASE_IOT_URL'] as const)(
    'prevents %s connected to the production smarthome DB', (key) => {
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

  it('allows the VPS DEV MQTT transport only with its own opt-in', () => {
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

  it('does not accept MQTT=true in VPS DEV without a specific transport authorization', () => {
    expect(() => selectShellyMqttDeploymentMode({
      ...vps(), MQTT_ENABLED: 'true',
    })).toThrow('MQTT_DEV_DI_MODE_NOT_ALLOWED');
  });

  it('prevents confusing local-dev with an enabled VPS profile', () => {
    expect(() => selectShellyMqttDeploymentMode({
      NODE_ENV: 'development',
      SHELLY_MQTT_DEV_DI_ENABLED: 'true',
      SHELLY_MQTT_VPS_DEV_TLS_ENABLED: 'true',
    })).toThrow('MQTT_DEV_DI_MODE_NOT_ALLOWED');
  });

  it('rejects a malformed URL without exposing it in the error', () => {
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
      productionPairing: false,
      productionAuthWorker: false,
      productionRevocationWorker: false,
    });
  });

  it('allows SQL RPC/auth on VPS only with the second opt-in', () => {
    const env = { ...vps(), SHELLY_MQTT_AUTH_DEV_DI_ENABLED: 'true' };
    expect(selectShellyMqttProviderPlan(env)).toMatchObject({
      vpsPgOnly: true,
      vpsPairing: false,
      vpsAuthPgOnly: true,
      localWorkflow: false,
      localAuthWorker: false,
      vpsAuthWorker: false,
      vpsRevocationWorker: false,
      productionPairing: false,
      productionAuthWorker: false,
      productionRevocationWorker: false,
    });
  });

  it('keeps the local flow and does not select VPS pairing', () => {
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
      productionPairing: false,
      productionAuthWorker: false,
      productionRevocationWorker: false,
    });
  });

  it('registers no additional providers in Production without opt-in', () => {
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
      productionPairing: false,
      productionAuthWorker: false,
      productionRevocationWorker: false,
    });
  });

  it('enables vpsPairing only if the revocation worker and the configuration are ready', () => {
    expect(selectShellyMqttProviderPlan(vpsPairing())).toEqual({
      mode: 'vps-dev-tls',
      localWorkflow: false,
      vpsPgOnly: true,
      vpsPairing: true,
      localAuthWorker: false,
      vpsAuthPgOnly: false,
      vpsAuthWorker: false,
      vpsRevocationWorker: true,
      productionPairing: false,
      productionAuthWorker: false,
      productionRevocationWorker: false,
    });
  });

  it.each(['DATABASE_URL', 'DATABASE_IOT_URL'] as const)(
    'allows sslmode=require in the general connection %s', (key) => {
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
  ])('rejects the unauthorized parameter %s in both general connections', (query) => {
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
    'keeps rejecting parameters in the specialized connection %s', (key, username) => {
      const env = {
        ...vpsPairing(),
        [key]: `${dedicatedDb(username)}?sslmode=require`,
      };

      expect(selectShellyMqttProviderPlan(env).vpsPairing).toBe(false);
    },
  );

  it('registers the VPS authentication worker only with both opt-ins', () => {
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

  it('does not enable the VPS worker if pairing fails or its explicit opt-in is missing', () => {
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

  it('does not enable vpsPairing when its own opt-in is missing', () => {
    const env = {
      ...vpsPairing(), SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED: undefined,
    };
    expect(selectShellyMqttProviderPlan(env).vpsPairing).toBe(false);
  });

  it('keeps bootstrap and pairing off if the revocation worker is not authorized', () => {
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
  ])('rejects the full VPS profile on an unauthorized base DB or TLS: %j', (override) => {
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

  it('rejects incompatible transport flags before selecting pairing', () => {
    expect(() => selectShellyMqttProviderPlan({
      ...vpsPairing(), SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED: 'false',
    })).toThrow('MQTT_DEV_DI_MODE_NOT_ALLOWED');
  });

  it('keeps the production Mosquitto profile off by default', () => {
    expect(selectShellyMqttProviderPlan({
      NODE_ENV: 'production', APP_ENV: 'production',
    })).toMatchObject({
      mode: 'off', productionPairing: false,
      productionAuthWorker: false, productionRevocationWorker: false,
    });
  });

  it('selects production only with Mosquitto TLS, isolated production logins, revocation, auth and its own key', () => {
    expect(selectShellyMqttProviderPlan(productionPairing())).toMatchObject({
      mode: 'production-mosquitto',
      productionPairing: true,
      productionAuthWorker: true,
      productionRevocationWorker: true,
      vpsPairing: false,
      vpsAuthWorker: false,
    });
  });

  it.each([
    { SHELLY_MQTT_PRODUCTION_REVOCATION_WORKER_ENABLED: 'false' },
    { SHELLY_MQTT_PRODUCTION_AUTH_WORKER_ENABLED: 'false' },
    { SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED: 'true' },
    { SHELLY_MQTT_VPS_DEV_AUTH_WORKER_ENABLED: 'true' },
    { SHELLY_MQTT_VPS_DEV_REVOCATION_WORKER_ENABLED: 'true' },
    { MQTT_BROKER_PROVIDER: 'flespi' },
    { MQTT_BROKER_URL: 'mqtt://mqtt.prod.example.com:1883' },
    { MQTT_DYNSEC_ADMIN_URL: 'mqtts://other.prod.example.com:8883' },
    { SHELLY_MQTT_PRODUCTION_DEVICE_BROKER_URL: 'mqtts://mosquitto-internal:8883' },
    { MQTT_DYNSEC_ADMIN_PASSWORD: 'synthetic-backend-password' },
    { MQTT_DYNSEC_ADMIN_USERNAME: 'invalid admin' },
    { MQTT_TOPIC_NAMESPACE: 'smarthome/dev/v1' },
    { MQTT_RESERVER_DATABASE_URL: productionDb('smarthome_mqtt_reserver_dev_login') },
    { MQTT_SECRET_DATABASE_URL: productionDb('smarthome_mqtt_secret_prod_login', 'smarthome_dev') },
    { MQTT_REVOCATION_DATABASE_URL: undefined },
    { MQTT_PREPARATION_AES_KEY_ID: 'dev-mqtt-aes-v1' },
    { SHELLY_MQTT_PRODUCTION_DEVICE_BROKER_URL: 'mqtts://mqtt-dev.179-236-82-122.sslip.io:443' },
    { SHELLY_MQTT_PRODUCTION_DEVICE_CA_FILE: '/run/secrets/mosquitto-dev-device-ca.pem',
      SHELLY_MQTT_VPS_DEV_DEVICE_CA_FILE: '/run/secrets/mosquitto-dev-device-ca.pem' },
  ])('rejects an incomplete or reused production profile: %j', (override) => {
    expect(() => selectShellyMqttProviderPlan({ ...productionPairing(), ...override }))
      .toThrow('MQTT_PRODUCTION_PAIRING_NOT_ALLOWED');
  });
});
