import { describe, expect, it } from 'vitest';
import { cleanAddress, cleanArabicName, cleanPersonName, combinePhone, parseLocationCode } from './importParsing.js';

const P = ['Marassi', 'Mivida'];

describe('parseLocationCode', () => {
  it.each([
    ['Marassi Arezzo P1 V-V-153', 'Arezzo P1', 'V-V-153', 'Villa'],
    ['Marassi Isola P1 TH-TH-28', 'Isola P1', 'TH-TH-28', 'Townhouse'],
    ['Marassi Verona P1 TH-TH 3-378', 'Verona P1', 'TH-TH 3-378', 'Townhouse'],
    ['Marassi Marina Residences-21EM-3-1', 'Marina Residences', '21EM-3-1', 'Chalet'],
    ['Marassi Marina 2-8G-2-2', 'Marina 2', '8G-2-2', 'Chalet'],
    ['Marassi Blanca P2-210-G-2', 'Blanca P2', '210-G-2', 'Chalet'],
    ['Marassi Blanca P3-V-V-319', 'Blanca P3', 'V-V-319', 'Villa'],
    ['Marassi The Address Beach-SA-SL-20', 'The Address Beach', 'SA-SL-20', 'Apartment'],
    ['Marassi Lea-4A-G-6', 'Lea', '4A-G-6', 'Chalet'],
    ['Marassi Marina Front-10-Sky-G-1', 'Marina Front', '10-Sky-G-1', null],
    ['Marassi Skaia DV-DV-6', 'Skaia', 'DV-DV-6', null],
    ['Marassi Marassi Bay V-V-64', 'Marassi Bay', 'V-V-64', 'Villa'],
  ])('%s', (code, phase, unit, type) => {
    expect(parseLocationCode(code, P)).toEqual({ project: 'Marassi', phase, unit_number: unit, property_type: type });
  });

  it('leaves the project empty when the prefix is unknown', () => {
    expect(parseLocationCode('Somewhere V-V-1', P)?.project).toBeNull();
  });
});

describe('combinePhone', () => {
  it('handles Egyptian numbers with and without country code', () => {
    expect(combinePhone('Egypt: 0020', '1112199940').phone).toBe('01112199940');
    expect(combinePhone('Egypt: 0020', '01223236000').phone).toBe('01223236000');
    expect(combinePhone('20', '1225231922').phone).toBe('01225231922');
    expect(combinePhone('', '+201001234567').phone).toBe('01001234567');
  });
  it('keeps foreign numbers international', () => {
    expect(combinePhone('United Arab Emirates: 00971', '501234567').phone).toBe('+971501234567');
    expect(combinePhone('Saudi Arabia: 00966', '0551234567').phone).toBe('+966551234567');
  });
  it('ignores cells holding only a country label and splits double numbers', () => {
    expect(combinePhone('Egypt: 0020', 'Egypt: 0020').phone).toBeNull();
    expect(combinePhone('Egypt: 0020', 'Egypt: 00201121933330').phone).toBe('01121933330');
    expect(combinePhone('Egypt: 0020', 'Egypt: 0020 1145569233').phone).toBe('01145569233');
    expect(combinePhone('Egypt: 0020', '1001234567 - 01221234567')).toEqual({ phone: '01001234567', extra: '01221234567' });
    expect(combinePhone('Egypt: 0020', '01066055521-01277755497')).toEqual({ phone: '01066055521', extra: '01277755497' });
    expect(combinePhone('Egypt: 0020', '01060988967///01001157072')).toEqual({ phone: '01060988967', extra: '01001157072' });
    expect(combinePhone('United Arab Emirates: 00971', '506327284-504820687')).toEqual({ phone: '+971506327284', extra: '+971504820687' });
    expect(combinePhone('Egypt: 0020', '1001234567‬').phone).toBe('01001234567');
  });
});

describe('cleaners', () => {
  it('tidies Arabic names and addresses', () => {
    expect(cleanArabicName(' / عصام  عبد العزيز ')).toBe('عصام عبد العزيز');
    expect(cleanArabicName(' /    ')).toBeNull();
    expect(cleanAddress(' 175 ش طيبة, ,<br>Alex  Egypt')).toBe('175 ش طيبة, Alex Egypt');
    expect(cleanPersonName('Omari NULL Ricketts')).toBe('Omari Ricketts');
    expect(cleanPersonName('samy Ahmed el-sayed')).toBe('Samy Ahmed El-sayed');
    expect(cleanPersonName('Abu Dhabi Islamic Bank (ADIB)')).toBe('Abu Dhabi Islamic Bank (ADIB)');
  });
});
