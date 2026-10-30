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

export class EnergyGoalRequiresValueError extends Error {
  constructor() {
    super(
      'Debe indicar el presupuesto mensual (COP), la meta de consumo (kWh) o ambos',
    );
    this.name = 'EnergyGoalRequiresValueError';
  }
}

export class EnergyGoalConcurrentWriteError extends Error {
  constructor() {
    super('El objetivo del mes se modificó al mismo tiempo; intente de nuevo');
    this.name = 'EnergyGoalConcurrentWriteError';
  }
}
