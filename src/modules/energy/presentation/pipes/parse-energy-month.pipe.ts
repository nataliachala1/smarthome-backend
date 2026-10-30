import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

import {
  ENERGY_MONTH_MESSAGE,
  isEnergyMonth,
} from '../../application/utils/energy-month';

/** Valida un parámetro de ruta YYYY-MM (año 2000–2099, mes 01..12). */
@Injectable()
export class ParseEnergyMonthPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isEnergyMonth(value)) {
      throw new BadRequestException('month ' + ENERGY_MONTH_MESSAGE);
    }

    return value;
  }
}
