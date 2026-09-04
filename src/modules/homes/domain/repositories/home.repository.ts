import { Home } from '../entities/home.entity';

export interface CreateHomeData {
  userId: string;
  name: string;
  stratum: number;
}

export interface UpdateHomeData {
  userId: string;
  homeId: string;
  name?: string;
  stratum?: number;
}

export abstract class HomeRepository {
  abstract findAllByUser(
    userId: string,
  ): Promise<Home[]>;

  abstract findById(
    userId: string,
    homeId: string,
  ): Promise<Home | null>;

  abstract create(
    data: CreateHomeData,
  ): Promise<Home>;

  abstract update(
    data: UpdateHomeData,
  ): Promise<Home>;

  abstract deactivate(
  userId: string,
  homeId: string,
  ): Promise<Home>;

  abstract reactivate(
    userId: string,
    homeId: string,
  ): Promise<Home>;
}