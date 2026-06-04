import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    forceExit: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/engine/**/*.js',
        'src/fleet/**/*.js',
        'src/ai/fallback.js',
        'src/ai/index.js',
        'src/ai/options.js',
        'src/ai/personalities.js',
        'src/ai/state-parser.js',
        'src/rooms.js',
        'src/saves.js',
      ],
      // Pure string-export data files — v8 has no coverable statements in them.
      exclude: [
        'src/fleet/fastplay/bioficer.js',
        'src/fleet/fastplay/phr.js',
        'src/fleet/fastplay/resistance.js',
        'src/fleet/fastplay/scourge.js',
        'src/fleet/fastplay/shaltari.js',
        'src/fleet/fastplay/ucm.js',
      ],
      reporter: ['lcov', 'text'],
      reportsDirectory: 'coverage',
    },
  },
});
