import { BadRequestException } from '@nestjs/common';

import { ParseEnergyMonthPipe } from './parse-energy-month.pipe';

describe('ParseEnergyMonthPipe', () => {
  const pipe = new ParseEnergyMonthPipe();

  it.each([['2026-01'], ['2026-11'], ['2026-12']])('acepta %p', (month) => {
    expect(pipe.transform(month)).toBe(month);
  });

  it.each([
    ['2026-00'],
    ['2026-13'],
    ['2026-1'],
    ['2026-11-01'],
    ['nov-2026'],
    [undefined],
  ])('rechaza %p', (month) => {
    expect(() => pipe.transform(month)).toThrow(BadRequestException);
  });
});
