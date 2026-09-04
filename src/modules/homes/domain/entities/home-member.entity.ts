export interface HomeMemberProps {
  id: string;
  homeId: string;
  userId: string;
  role: string;
  status: string;
  invitedBy: string | null;
  invitedAt: Date;
  acceptedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class HomeMember {
  readonly id: string;
  readonly homeId: string;
  readonly userId: string;
  readonly role: string;
  readonly status: string;
  readonly invitedBy: string | null;
  readonly invitedAt: Date;
  readonly acceptedAt: Date | null;
  readonly endedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: HomeMemberProps) {
    this.id = props.id;
    this.homeId = props.homeId;
    this.userId = props.userId;
    this.role = props.role;
    this.status = props.status;
    this.invitedBy = props.invitedBy;
    this.invitedAt = props.invitedAt;
    this.acceptedAt = props.acceptedAt;
    this.endedAt = props.endedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}