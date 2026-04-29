/**
 * HU-1.3 · Detección de ciclo en grafo de dependencias antes de crear
 * una nueva arista.
 *
 * Dada la lista de dependencias existentes y una nueva (`newPred → newSucc`),
 * decide si añadirla cerraría un ciclo. Implementación: DFS desde
 * `newSucc` siguiendo la dirección `predecessor → successor`. Si se
 * alcanza `newPred`, hay ciclo (porque entonces existe ya el camino
 * `newSucc → ... → newPred`, y la nueva arista cerraría el lazo).
 *
 * Complejidad: O(V + E). El grafo del proyecto promedio es pequeño
 * (decenas a cientos de aristas), así que esto es despreciable.
 */

export interface DependencyEdge {
  predecessorId: string
  successorId: string
}

export function wouldCreateCycle(
  existingDeps: DependencyEdge[],
  newPred: string,
  newSucc: string,
): boolean {
  // Self-loop trivial (el caller lo valida también, pero por seguridad).
  if (newPred === newSucc) return true

  // Adyacencia: predecessor → successor[]
  const adj = new Map<string, string[]>()
  for (const d of existingDeps) {
    const list = adj.get(d.predecessorId)
    if (list) list.push(d.successorId)
    else adj.set(d.predecessorId, [d.successorId])
  }

  // DFS desde newSucc; si llegamos a newPred, la nueva arista cierra ciclo.
  const visited = new Set<string>()
  const stack: string[] = [newSucc]
  while (stack.length) {
    const node = stack.pop() as string
    if (node === newPred) return true
    if (visited.has(node)) continue
    visited.add(node)
    const succs = adj.get(node)
    if (!succs) continue
    for (const s of succs) {
      if (!visited.has(s)) stack.push(s)
    }
  }
  return false
}
