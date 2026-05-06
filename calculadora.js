'use strict';

// ─── PARÁMETROS CONFIGURABLES ────────────────────────────────────────────────

const CONFIG = {
  porcentajeAFP: 11.45,        // % cotización obligatoria AFP
  porcentajeSalud: 7.0,        // % FONASA | reemplazar por monto Isapre si aplica
  porcentajeAFC: {
    indefinido: 0.6,           // % descuento trabajador contrato indefinido
    plazoFijo: 0,              // trabajador no descuenta en contrato a plazo fijo
    obraFaena: 0,              // trabajador no descuenta en contrato por obra/faena
  },
  // Tabla impuesto único de 2da categoría (valores en UTM/mes — abril 2026 ≈ $68,285)
  // Tramos expresados en pesos (UTM * valor). Actualiza utm para recalcular.
  utm: 68285,
  tablaImpuesto: [
    // { desde: UTM, hasta: UTM, factor: tasa, rebaja: UTM }
    { desde: 0,   hasta: 13.5, factor: 0,      rebaja: 0      },
    { desde: 13.5, hasta: 30,  factor: 0.04,   rebaja: 0.54   },
    { desde: 30,  hasta: 50,   factor: 0.08,   rebaja: 1.74   },
    { desde: 50,  hasta: 70,   factor: 0.135,  rebaja: 4.49   },
    { desde: 70,  hasta: 90,   factor: 0.23,   rebaja: 11.14  },
    { desde: 90,  hasta: 120,  factor: 0.304,  rebaja: 17.80  },
    { desde: 120, hasta: 150,  factor: 0.35,   rebaja: 23.32  },
    { desde: 150, hasta: Infinity, factor: 0.40, rebaja: 30.82 },
  ],
};

// ─── TIPOS DE CONTRATO ───────────────────────────────────────────────────────

const TIPOS_CONTRATO = ['indefinido', 'plazoFijo', 'obraFaena'];

// ─── VALIDACIÓN DE INPUTS ────────────────────────────────────────────────────

function validarInputs(inputs) {
  const errores = [];

  if (typeof inputs.sueldoBase !== 'number' || inputs.sueldoBase < 0)
    errores.push('sueldoBase debe ser un número >= 0');

  if (inputs.gratificacion !== undefined && (typeof inputs.gratificacion !== 'number' || inputs.gratificacion < 0))
    errores.push('gratificacion debe ser un número >= 0');

  if (inputs.bonosImponibles !== undefined && (typeof inputs.bonosImponibles !== 'number' || inputs.bonosImponibles < 0))
    errores.push('bonosImponibles debe ser un número >= 0');

  if (inputs.bonosNoImponibles !== undefined && (typeof inputs.bonosNoImponibles !== 'number' || inputs.bonosNoImponibles < 0))
    errores.push('bonosNoImponibles debe ser un número >= 0');

  if (!TIPOS_CONTRATO.includes(inputs.tipoContrato))
    errores.push(`tipoContrato debe ser uno de: ${TIPOS_CONTRATO.join(', ')}`);

  if (errores.length > 0) throw new Error('Inputs inválidos:\n  - ' + errores.join('\n  - '));
}

// ─── MÓDULOS DE CÁLCULO ──────────────────────────────────────────────────────

function calcularAFP(totalImponible, config = CONFIG) {
  const monto = Math.round(totalImponible * config.porcentajeAFP / 100);
  return { porcentaje: config.porcentajeAFP, monto };
}

function calcularSalud(totalImponible, config = CONFIG) {
  const monto = Math.round(totalImponible * config.porcentajeSalud / 100);
  return { porcentaje: config.porcentajeSalud, monto };
}

function calcularAFC(totalImponible, tipoContrato, config = CONFIG) {
  const porcentaje = config.porcentajeAFC[tipoContrato] ?? 0;
  const monto = Math.round(totalImponible * porcentaje / 100);
  const aplica = porcentaje > 0;
  return { porcentaje, monto, aplica };
}

function calcularImpuesto(baseTributable, config = CONFIG) {
  const utm = config.utm;
  const baseEnUTM = baseTributable / utm;

  const tramo = config.tablaImpuesto.find(
    t => baseEnUTM >= t.desde && baseEnUTM < t.hasta
  );

  if (!tramo || tramo.factor === 0) return { monto: 0, tramo: 0, factor: 0, rebaja: 0, baseEnUTM };

  const impuesto = Math.round((baseEnUTM * tramo.factor - tramo.rebaja) * utm);
  return {
    monto: Math.max(0, impuesto),
    factor: tramo.factor,
    rebaja: tramo.rebaja,
    baseEnUTM: Math.round(baseEnUTM * 100) / 100,
  };
}

function calcularLiquido(inputs, config = CONFIG) {
  validarInputs(inputs);

  const {
    sueldoBase,
    gratificacion = 0,
    bonosImponibles = 0,
    bonosNoImponibles = 0,
    tipoContrato,
    otrosDescuentos = 0,
  } = inputs;

  // ── Haberes ────────────────────────────────────────────────────────────────
  const totalImponible = sueldoBase + gratificacion + bonosImponibles;
  const totalNoImponible = bonosNoImponibles;
  const totalHaberes = totalImponible + totalNoImponible;

  // ── Leyes sociales ─────────────────────────────────────────────────────────
  const afp = calcularAFP(totalImponible, config);
  const salud = calcularSalud(totalImponible, config);
  const afc = calcularAFC(totalImponible, tipoContrato, config);
  const leyesSociales = afp.monto + salud.monto + afc.monto;

  // ── Impuesto único ─────────────────────────────────────────────────────────
  const baseTributable = totalImponible - leyesSociales;
  const impuesto = calcularImpuesto(baseTributable, config);

  // ── Totales ────────────────────────────────────────────────────────────────
  const totalDescuentos = leyesSociales + impuesto.monto + otrosDescuentos;
  const sueldoLiquido = totalHaberes - totalDescuentos;

  return {
    haberes: {
      sueldoBase,
      gratificacion,
      bonosImponibles,
      totalImponible,
      bonosNoImponibles,
      totalHaberes,
    },
    descuentos: {
      afp: { porcentaje: afp.porcentaje, monto: afp.monto },
      salud: { porcentaje: salud.porcentaje, monto: salud.monto },
      afc: { porcentaje: afc.porcentaje, monto: afc.monto, aplica: afc.aplica },
      impuesto: { monto: impuesto.monto, baseEnUTM: impuesto.baseEnUTM, factor: impuesto.factor },
      otrosDescuentos,
      totalDescuentos,
    },
    leyesSociales,
    baseTributable,
    sueldoLiquido,
  };
}

// ─── FORMATEO DE SALIDA ───────────────────────────────────────────────────────

function fmt(n) {
  return '$' + n.toLocaleString('es-CL');
}

function imprimirLiquidacion(resultado, inputs) {
  const { haberes, descuentos, baseTributable, sueldoLiquido } = resultado;

  console.log('\n' + '═'.repeat(52));
  console.log('         LIQUIDACIÓN DE REMUNERACIONES');
  console.log('         Contrato: ' + inputs.tipoContrato.toUpperCase());
  console.log('═'.repeat(52));

  console.log('\nHABERES IMPONIBLES');
  console.log(`  Sueldo base          ${fmt(haberes.sueldoBase).padStart(16)}`);
  if (haberes.gratificacion)
    console.log(`  Gratificación        ${fmt(haberes.gratificacion).padStart(16)}`);
  if (haberes.bonosImponibles)
    console.log(`  Bonos imponibles     ${fmt(haberes.bonosImponibles).padStart(16)}`);
  console.log(`  Total imponible      ${fmt(haberes.totalImponible).padStart(16)}`);

  if (haberes.bonosNoImponibles) {
    console.log('\nHABERES NO IMPONIBLES');
    console.log(`  Bonos no imponibles  ${fmt(haberes.bonosNoImponibles).padStart(16)}`);
  }

  console.log(`\n  TOTAL HABERES        ${fmt(haberes.totalHaberes).padStart(16)}`);

  console.log('\nDESCUENTOS');
  console.log(`  AFP (${descuentos.afp.porcentaje}%)         ${fmt(descuentos.afp.monto).padStart(16)}`);
  console.log(`  Salud (${descuentos.salud.porcentaje}%)          ${fmt(descuentos.salud.monto).padStart(16)}`);
  if (descuentos.afc.aplica)
    console.log(`  AFC (${descuentos.afc.porcentaje}%)           ${fmt(descuentos.afc.monto).padStart(16)}`);
  else
    console.log(`  AFC                       No aplica`);
  console.log(`  Base tributable      ${fmt(baseTributable).padStart(16)}`);
  console.log(`  Impuesto único       ${fmt(descuentos.impuesto.monto).padStart(16)}`);
  if (descuentos.otrosDescuentos)
    console.log(`  Otros descuentos     ${fmt(descuentos.otrosDescuentos).padStart(16)}`);

  console.log('─'.repeat(52));
  console.log(`  TOTAL DESCUENTOS     ${fmt(descuentos.totalDescuentos).padStart(16)}`);
  console.log('═'.repeat(52));
  console.log(`  SUELDO LÍQUIDO       ${fmt(sueldoLiquido).padStart(16)}`);
  console.log('═'.repeat(52) + '\n');
}

// ─── EJEMPLO CON DATOS REALES ─────────────────────────────────────────────────

const inputs = {
  sueldoBase: 1298388,
  gratificacion: 209396,
  bonosImponibles: 0,
  bonosNoImponibles: 0,
  tipoContrato: 'indefinido',
  otrosDescuentos: 0,
};

const resultado = calcularLiquido(inputs);
imprimirLiquidacion(resultado, inputs);

// ─── EXPORTS (para uso como módulo) ──────────────────────────────────────────

module.exports = {
  calcularAFP,
  calcularSalud,
  calcularAFC,
  calcularImpuesto,
  calcularLiquido,
  imprimirLiquidacion,
  CONFIG,
};
