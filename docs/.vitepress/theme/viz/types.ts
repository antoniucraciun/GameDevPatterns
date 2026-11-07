// Theme colours handed to every visualizer's draw function, read from VitePress CSS variables
// so canvases follow light and dark mode.
export interface VizColors {
  bg: string
  fg: string
  muted: string
  faint: string
  grid: string
  brand: string
  brandSoft: string
  green: string
  greenSoft: string
  yellow: string
  yellowSoft: string
  red: string
  redSoft: string
}

/** Canvas can't read CSS variables, so name the font stack directly. */
export const VIZ_FONT = '12px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

export interface VizPointer {
  type: 'down' | 'move' | 'up' | 'leave'
  x: number
  y: number
  w: number
  h: number
  pressed: boolean
}

/** Small deterministic PRNG so every visitor sees the same starting state. */
export function makeRandom(seed = 1) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}
