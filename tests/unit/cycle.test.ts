import { describe, it, expect } from 'vitest'
import { wouldCreateCycle } from '@/lib/scheduling/cycle'

describe('wouldCreateCycle', () => {
  it('retorna true para self-loop (A → A)', () => {
    expect(wouldCreateCycle([], 'A', 'A')).toBe(true)
  })

  it('retorna false en grafo vacío para arista nueva entre tareas inéditas', () => {
    expect(wouldCreateCycle([], 'A', 'B')).toBe(false)
  })

  it('retorna false al añadir arista a cadena lineal sin cerrar ciclo (A→B→C, nueva A→C)', () => {
    const deps = [
      { predecessorId: 'A', successorId: 'B' },
      { predecessorId: 'B', successorId: 'C' },
    ]
    expect(wouldCreateCycle(deps, 'A', 'C')).toBe(false)
  })

  it('detecta ciclo directo A→B + nueva B→A', () => {
    const deps = [{ predecessorId: 'A', successorId: 'B' }]
    expect(wouldCreateCycle(deps, 'B', 'A')).toBe(true)
  })

  it('detecta ciclo transitivo en cadena A→B→C + nueva C→A', () => {
    const deps = [
      { predecessorId: 'A', successorId: 'B' },
      { predecessorId: 'B', successorId: 'C' },
    ]
    expect(wouldCreateCycle(deps, 'C', 'A')).toBe(true)
  })

  it('detecta ciclo en grafo con bifurcación A→B, A→C, C→D + nueva D→A', () => {
    const deps = [
      { predecessorId: 'A', successorId: 'B' },
      { predecessorId: 'A', successorId: 'C' },
      { predecessorId: 'C', successorId: 'D' },
    ]
    expect(wouldCreateCycle(deps, 'D', 'A')).toBe(true)
  })

  it('no falsea ciclos con aristas paralelas que comparten destino (A→C, B→C + nueva A→B)', () => {
    const deps = [
      { predecessorId: 'A', successorId: 'C' },
      { predecessorId: 'B', successorId: 'C' },
    ]
    expect(wouldCreateCycle(deps, 'A', 'B')).toBe(false)
  })

  it('no entra en bucle infinito si el grafo existente ya tiene ciclo (B→C→B) y agregamos A→B', () => {
    // Caso defensivo: aunque el grafo no debería tener ciclos previos,
    // el algoritmo debe terminar (visited Set evita revisitas).
    const deps = [
      { predecessorId: 'B', successorId: 'C' },
      { predecessorId: 'C', successorId: 'B' },
    ]
    expect(wouldCreateCycle(deps, 'A', 'B')).toBe(false)
  })
})
