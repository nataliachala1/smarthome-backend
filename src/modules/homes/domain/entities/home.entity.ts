export interface HomeProps {
  id: string;
  createdBy: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class Home {
  constructor(private readonly props: HomeProps) {}

  get id(): string {
    return this.props.id;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get name(): string {
    return this.props.name;
  }

  get status(): string {
    return this.props.status;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt;
  }
}
