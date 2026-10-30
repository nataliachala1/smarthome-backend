import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

import { isEnergyMonth } from '../../application/utils/energy-month';

/** Valida un parámetro de ruta YYYY-MM (mes 01..12). */
@Injectable()
export class ParseEnergyMonthPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isEnergyMonth(value)) {
      throw new BadRequestException(
        'month debe tener formato YYYY-MM con mes entre 01 y 12',
      );
    }

    return value;
  }
}
