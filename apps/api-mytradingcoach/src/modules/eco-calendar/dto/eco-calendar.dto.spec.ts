import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AnalyzeResultDto, SavePinsDto } from './eco-calendar.dto';
import { EcoCalendarController } from '../eco-calendar.controller';

const errorsOf = async (cls: new () => object, body: unknown) =>
  (await validate(plainToInstance(cls, body) as object, { whitelist: true, forbidNonWhitelisted: true }))
    .map((e) => e.property);

const paramTypes = (method: string) =>
  Reflect.getMetadata('design:paramtypes', EcoCalendarController.prototype, method) as unknown[];

// C11 (#1045) : corps lus par `@Body('champ')` sans validation.
describe('SavePinsDto', () => {
  it('liste de clés « nom:devise » : acceptée', async () => {
    expect(await errorsOf(SavePinsDto, { pins: ['Non Farm Payrolls:USD', 'CPI:EUR'] })).toEqual([]);
    expect(await errorsOf(SavePinsDto, { pins: [] })).toEqual([]);
  });

  it('pas un tableau, plus de 50 épingles, épingle non texte ou trop longue : refusée', async () => {
    expect(await errorsOf(SavePinsDto, { pins: 'NFP:USD' })).toEqual(['pins']);
    expect(await errorsOf(SavePinsDto, { pins: Array.from({ length: 51 }, (_, i) => `E${i}:USD`) })).toEqual(['pins']);
    expect(await errorsOf(SavePinsDto, { pins: [42] })).toEqual(['pins']);
    expect(await errorsOf(SavePinsDto, { pins: ['x'.repeat(121)] })).toEqual(['pins']);
  });

  it('PATCH pins lit le corps par ce DTO', () => {
    expect(paramTypes('savePins')).toContain(SavePinsDto);
  });
});

describe('AnalyzeResultDto', () => {
  it('nom d’annonce : accepté', async () => {
    expect(await errorsOf(AnalyzeResultDto, { eventName: 'Non Farm Payrolls' })).toEqual([]);
  });

  it('absent, vide, non texte ou trop long : 400 au lieu d’un 500 dans stripPeriod', async () => {
    expect(await errorsOf(AnalyzeResultDto, {})).toEqual(['eventName']);
    expect(await errorsOf(AnalyzeResultDto, { eventName: '' })).toEqual(['eventName']);
    expect(await errorsOf(AnalyzeResultDto, { eventName: ['NFP'] })).toEqual(['eventName']);
    expect(await errorsOf(AnalyzeResultDto, { eventName: 'x'.repeat(201) })).toEqual(['eventName']);
  });

  it('POST analyze-result lit le corps par ce DTO', () => {
    expect(paramTypes('analyzeResult')).toContain(AnalyzeResultDto);
  });
});
