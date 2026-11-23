import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emHorarioDePico, agoraBrasilia } from '../src/pico.js';

// Datas em UTC; Brasília = UTC-3.
const quarta20h = new Date('2026-11-25T23:00:00Z'); // qua 20h
const quarta10h = new Date('2026-11-25T13:00:00Z'); // qua 10h
const sabado15h = new Date('2026-11-28T18:00:00Z'); // sáb 15h
const domingo3h = new Date('2026-11-29T06:00:00Z'); // dom 3h

test('hora e dia em Brasília', () => {
  assert.deepEqual(agoraBrasilia(quarta20h), { hora: 20, dia: 3 });
  assert.deepEqual(agoraBrasilia(domingo3h), { hora: 3, dia: 0 });
});

test('pico: noite nos dias úteis e dia todo no fim de semana', () => {
  assert.equal(emHorarioDePico(quarta20h, {}), true);
  assert.equal(emHorarioDePico(quarta10h, {}), false);
  assert.equal(emHorarioDePico(sabado15h, {}), true);
  assert.equal(emHorarioDePico(domingo3h, {}), false);
});

test('pico: configurável e desligável', () => {
  assert.equal(emHorarioDePico(quarta20h, { PICO: '0' }), false);
  assert.equal(emHorarioDePico(quarta10h, { PICO_HORAS_UTEIS: '8-12' }), true);
  assert.equal(emHorarioDePico(quarta20h, { PICO_HORAS_UTEIS: 'xx' }), false);
});
