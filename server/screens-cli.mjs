// npm run screens                         → (re)capture the Edits screenshots now
// npm run screens -- <shot> <file.png>    → use your own screenshot for <shot> (redacted, never overwritten by capture)
import { captureScreens, importScreen, SCREENS } from './screens.mjs';

const [key, file] = process.argv.slice(2);
try {
  if (key && file) {
    const r = await importScreen(key, file);
    console.log(`✅ ${key} ← ${file}${r.redacted ? ` (${r.redacted} secret region(s) redacted)` : ''}\n   ${r.file}`);
  } else if (key) throw new Error(`usage: npm run screens -- <${Object.keys(SCREENS).join('|')}> <file.png>`);
  else console.log(await captureScreens({ log: console.log, force: true }));
} catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
