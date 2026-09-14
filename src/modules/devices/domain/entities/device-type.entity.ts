export interface DeviceTypeProps {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class DeviceType {
  constructor(private readonly props: DeviceTypeProps) {}

  get id() {
    return this.props.id;
  }

  get name() {
    return this.props.name;
  }

  get description() {
    return this.props.description;
  }

  get icon() {
    return this.props.icon;
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
