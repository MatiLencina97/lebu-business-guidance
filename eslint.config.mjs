import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  // Lebu usa efectos para hidratar/sincronizar estado externo, refs como mutex de sync
  // y timestamps dentro de handlers. Estas tres reglas del React compiler no reflejan
  // errores de runtime en esa arquitectura; el resto de Hooks/Core Web Vitals sigue activo.
  {
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
