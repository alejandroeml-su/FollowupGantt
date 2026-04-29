// Re-export del archivo principal de tests para satisfacer la convención
// pedida en el briefing del POC. El runner real está en tests/unit/cpm.test.ts
// porque vitest.config.ts sólo escanea tests/{unit,component}.
//
// Mantener este archivo facilita encontrar los tests de CPM desde el módulo.
export {}
