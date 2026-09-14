export interface DeviceProps {
  id: string;
  homeId: string;
  deviceTypeId: string;
  name: string;
  status: string;
  connectivityStatus: string;
  isOn: boolean;
  currentPowerW: number | null;
  manufacturerDeviceId: string | null;
  transportType: string | null;
  messagingProtocol: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class Device {
  constructor(private readonly props: DeviceProps) {}

  get id() {
    return this.props.id;
  }

  get homeId() {
    return this.props.homeId;
  }

  get deviceTypeId() {
    return this.props.deviceTypeId;
  }

  get name() {
    return this.props.name;
  }

  get status() {
    return this.props.status;
  }

  get connectivityStatus() {
    return this.props.connectivityStatus;
  }

  get isOn() {
    return this.props.isOn;
  }

  get currentPowerW() {
    return this.props.currentPowerW;
  }

  get manufacturerDeviceId() {
    return this.props.manufacturerDeviceId;
  }

  get transportType() {
    return this.props.transportType;
  }

  get messagingProtocol() {
    return this.props.messagingProtocol;
  }

  get createdAt() {
    return this.props.createdAt;
  }

  get updatedAt() {
    return this.props.updatedAt;
  }

  get deletedAt() {
    return this.props.deletedAt;
  }
}
