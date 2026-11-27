import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Run every test in a time zone that is neither UTC nor the developer's own (Buenos Aires, UTC-3, no
// daylight saving), so code that mixes up local time and UTC fails the same way on every machine.
process.env['TZ'] = 'America/Argentina/Buenos_Aires';

// Testing Library only cleans up automatically when test globals are enabled; do it explicitly.
afterEach(() => {
  cleanup();
});
