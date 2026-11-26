import { loadVoices, englishVoices, koreanVoices, defaultVoices } from './tts.js';
import { track } from './motivate.js';
import { state, saveSettings, ensurePersistent, deliver } from './core.js';
import { render } from './ui.js';
import './view-home.js';
import './view-scene.js';
import './view-study.js';
import './view-settings.js';

// ---------- boot ----------
async function boot() {
  // Draw first so the app never opens on a blank screen; voices arrive later.
  render();
  if ('speechSynthesis' in window) {
    await loadVoices();
    const d = defaultVoices();
    for (const k of Object.keys(d)) if (!state.settings.voices[k] || !englishVoices().concat(koreanVoices()).some((v) => v.name === state.settings.voices[k])) state.settings.voices[k] = d[k];
    saveSettings();
    if (location.hash.startsWith('#/settings')) render(); // refresh the voice pickers
  }
  if (state.script) { ensurePersistent(); deliver(track('open')); }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
