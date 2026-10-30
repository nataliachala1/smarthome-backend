export class EnergyReadAccessDeniedError extends Error {
  constructor() {
    super(
      'Sin permisos para consultar la configuración energética de este hogar',
    );
    this.name = 'EnergyReadAccessDeniedError';
  }
}

export class EnergyManageAccessDeniedError extends Error {
  constructor() {
    super(
      'Solo el propietario de un hogar activo puede modificar la configuración energética',
    );
    this.name = 'EnergyManageAccessDeniedError';
  }
}

export class HomeEnergyTariffAlreadyExistsError extends Error {
  constructor() {
    super('Ya existe una tarifa con esa fecha de vigencia para este hogar');
    this.name = 'HomeEnergyTariffAlreadyExistsError';
  }
}
