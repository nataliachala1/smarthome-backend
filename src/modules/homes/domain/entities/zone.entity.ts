export interface ZoneProps {
  id: string;
  homeId: string;
  name: string;
  type: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class Zone {
  readonly id: string;
  readonly homeId: string;
  readonly name: string;
  readonly type: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;

  constructor(props: ZoneProps) {
    this.id = props.id;
    this.homeId = props.homeId;
    this.name = props.name;
    this.type = props.type;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.deletedAt = props.deletedAt;
  }
}