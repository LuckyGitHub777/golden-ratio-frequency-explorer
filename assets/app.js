(() => {
  'use strict';

  const PHI = (1 + Math.sqrt(5)) / 2;
  const GOLDEN_ANGLE = 360 / (PHI * PHI);
  const SPEED_OF_SOUND = 343;
  const MIN_PLAYBACK_HZ = 20;
  const MAX_PLAYBACK_HZ = 20000;

  const state = {
    anchor: 440,
    exponent: 0,
    volume: 0.08,
    audioContext: null,
    activeNodes: new Set(),
    sustained: null,
    sequenceTimers: [],
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    exponent: $('exponent'),
    exponentOutput: $('exponentOutput'),
    customAnchor: $('customAnchor'),
    volume: $('volume'),
    volumeOutput: $('volumeOutput'),
    frequencyValue: $('frequencyValue'),
    ratioValue: $('ratioValue'),
    centsValue: $('centsValue'),
    periodValue: $('periodValue'),
    wavelengthValue: $('wavelengthValue'),
    anchorFormula: $('anchorFormula'),
    exponentFormula: $('exponentFormula'),
    ratioVisualLabel: $('ratioVisualLabel'),
    referenceBadge: $('referenceBadge'),
    frequencyGrid: $('frequencyGrid'),
    octaveGrid: $('octaveGrid'),
    playButton: $('playButton'),
    playScaleButton: $('playScaleButton'),
    stopButton: $('stopButton'),
    copyButton: $('copyButton'),
    downloadCsvButton: $('downloadCsvButton'),
    audioStatus: $('audioStatus'),
    playbackStatus: $('playbackStatus'),
    playbackDot: $('playbackDot'),
    spiralCanvas: $('spiralCanvas'),
  };

  const ratioFor = (n) => PHI ** n;
  const frequencyFor = (n) => state.anchor * ratioFor(n);
  const centsForRatio = (ratio) => 1200 * Math.log2(ratio);
  const canPlay = (frequency) => Number.isFinite(frequency) && frequency >= MIN_PLAYBACK_HZ && frequency <= MAX_PLAYBACK_HZ;

  function formatFrequency(frequency) {
    const digits = frequency >= 1000 ? 2 : 3;
    return frequency.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function formatAnchor(anchor) {
    return Number.isInteger(anchor) ? String(anchor) : anchor.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function octaveFoldedSet() {
    const steps = [];
    for (let n = 0; n < 12; n += 1) {
      const pitchClass = (n * Math.log2(PHI)) % 1;
      const ratio = 2 ** pitchClass;
      steps.push({ sourceExponent: n, ratio, cents: 1200 * pitchClass });
    }
    steps.sort((a, b) => a.ratio - b.ratio);
    return steps;
  }

  function scaleIsPlayable() {
    return octaveFoldedSet().every((note) => canPlay(state.anchor * note.ratio));
  }

  function referenceLabel() {
    if (state.anchor === 440) return '440 Hz · ISO A4 reference';
    if (state.anchor === 432) return '432 Hz · creative reference';
    return `${formatAnchor(state.anchor)} Hz · custom reference`;
  }

  function updatePlaybackAvailability() {
    const selected = frequencyFor(state.exponent);
    const playable = canPlay(selected);
    els.playButton.disabled = !playable;
    els.playbackDot.classList.toggle('unavailable', !playable);

    if (playable) {
      els.playbackStatus.textContent = 'Playback available for this frequency. Hardware response varies.';
    } else {
      els.playbackStatus.textContent = 'Math-only selection: playback is limited to 20–20,000 Hz.';
    }

    const setPlayable = scaleIsPlayable();
    els.playScaleButton.disabled = !setPlayable;
    els.playScaleButton.title = setPlayable ? '' : 'The complete 12-step set extends outside the 20–20,000 Hz playback window for this anchor.';
  }

  function syncSustainedTone() {
    if (!state.sustained || !state.audioContext) return;
    const frequency = frequencyFor(state.exponent);
    if (!canPlay(frequency)) {
      stopSustained('Tone stopped because the selected frequency is outside the playback window.');
      return;
    }
    state.sustained.oscillator.frequency.setTargetAtTime(frequency, state.audioContext.currentTime, 0.018);
    announce(`Playing continuous ${formatFrequency(frequency)} hertz tone.`);
  }

  function updateReadout({ syncAudio = true } = {}) {
    const ratio = ratioFor(state.exponent);
    const frequency = state.anchor * ratio;
    els.frequencyValue.textContent = formatFrequency(frequency);
    els.ratioValue.textContent = ratio.toFixed(9);
    els.centsValue.textContent = `${centsForRatio(ratio).toFixed(3)} cents`;
    els.periodValue.textContent = `${(1000 / frequency).toFixed(4)} ms`;
    els.wavelengthValue.textContent = `${(SPEED_OF_SOUND / frequency).toFixed(4)} m`;
    els.exponentOutput.textContent = `n = ${state.exponent >= 0 ? '+' : ''}${state.exponent}`;
    els.anchorFormula.textContent = formatAnchor(state.anchor);
    els.exponentFormula.textContent = String(state.exponent);
    els.volumeOutput.textContent = state.volume.toFixed(2);
    els.ratioVisualLabel.textContent = `× ${ratio.toFixed(6)}`;
    els.referenceBadge.textContent = referenceLabel();

    els.frequencyGrid.querySelectorAll('.frequency-node').forEach((node) => {
      node.classList.toggle('active', Number(node.dataset.exponent) === state.exponent);
    });

    updatePlaybackAvailability();
    if (syncAudio) syncSustainedTone();
    updateUrl();
  }

  function renderGrid() {
    els.frequencyGrid.innerHTML = '';
    for (let n = -6; n <= 6; n += 1) {
      const frequency = frequencyFor(n);
      const ratio = ratioFor(n);
      const playable = canPlay(frequency);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `frequency-node${playable ? '' : ' unplayable'}`;
      button.dataset.exponent = String(n);
      button.setAttribute('aria-label', `phi exponent ${n}, ${formatFrequency(frequency)} hertz, ratio ${ratio.toFixed(6)}${playable ? '' : ', math only, outside playback window'}`);
      button.innerHTML = `<span class="n">φ<sup>${n}</sup></span><span class="hz">${formatFrequency(frequency)} Hz</span><span class="ratio">ratio ${ratio.toFixed(6)}</span>`;
      button.addEventListener('click', () => {
        state.exponent = n;
        els.exponent.value = String(n);
        const wasSustained = Boolean(state.sustained);
        updateReadout();
        if (!wasSustained && playable) playOneShot(frequency, 0.72);
        if (!playable) announce(`${formatFrequency(frequency)} hertz is shown mathematically but is outside the 20 to 20,000 hertz playback window.`);
      });
      els.frequencyGrid.appendChild(button);
    }
    updateReadout({ syncAudio: false });
  }

  function renderOctaveSet() {
    els.octaveGrid.innerHTML = '';
    const notes = octaveFoldedSet();
    notes.forEach((note, index) => {
      const item = document.createElement('div');
      item.className = 'octave-step';
      item.style.setProperty('--intensity', String(0.025 + (index / 11) * 0.065));
      item.setAttribute('aria-label', `step ${index + 1}, source exponent ${note.sourceExponent}, ratio ${note.ratio.toFixed(9)}, ${note.cents.toFixed(3)} cents`);
      item.innerHTML = `<span class="degree">${String(index + 1).padStart(2, '0')}</span><span class="cents">${note.cents.toFixed(1)}¢</span><span class="source">from φ<sup>${note.sourceExponent}</sup></span>`;
      els.octaveGrid.appendChild(item);
    });
  }

  function getAudioContext() {
    if (!state.audioContext) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) throw new Error('Web Audio is not supported in this browser.');
      state.audioContext = new AudioContextCtor();
    }
    if (state.audioContext.state === 'suspended') {
      void state.audioContext.resume();
    }
    return state.audioContext;
  }

  function toneNode(frequency, startAt, duration, gainLevel = state.volume) {
    if (!canPlay(frequency)) return null;
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startAt);

    const attack = 0.025;
    const release = 0.055;
    const targetGain = Math.max(0.0001, Math.min(gainLevel, 0.20));
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(targetGain, startAt + attack);

    // Web Audio requires start() before stop(); schedule start first.
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(startAt);

    if (duration != null) {
      const releaseStart = Math.max(startAt + attack, startAt + duration - release);
      gain.gain.setValueAtTime(targetGain, releaseStart);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.stop(startAt + duration + 0.01);
    }

    state.activeNodes.add(oscillator);
    oscillator.addEventListener('ended', () => state.activeNodes.delete(oscillator), { once: true });
    return { oscillator, gain };
  }

  function playOneShot(frequency, duration = 0.8) {
    if (!canPlay(frequency)) return;
    const ctx = getAudioContext();
    toneNode(frequency, ctx.currentTime + 0.01, duration);
    announce(`Playing ${formatFrequency(frequency)} hertz.`);
  }

  function toggleSustainedTone() {
    if (state.sustained) {
      stopSustained();
      return;
    }
    const frequency = frequencyFor(state.exponent);
    if (!canPlay(frequency)) {
      announce('This selection is outside the 20 to 20,000 hertz playback window.');
      return;
    }
    const ctx = getAudioContext();
    const node = toneNode(frequency, ctx.currentTime + 0.01, null);
    if (!node) return;
    state.sustained = node;
    els.playButton.querySelector('.play-icon').textContent = '■';
    els.playButton.querySelector('.play-label').textContent = 'Stop tone';
    announce(`Playing continuous ${formatFrequency(frequency)} hertz tone.`);
  }

  function stopSustained(message = 'Tone stopped.') {
    if (!state.sustained) return;
    const ctx = state.audioContext;
    const { oscillator, gain } = state.sustained;
    if (ctx) {
      const now = ctx.currentTime;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
        oscillator.stop(now + 0.05);
      } catch (_) { /* already stopped */ }
    }
    state.sustained = null;
    els.playButton.querySelector('.play-icon').textContent = '▶';
    els.playButton.querySelector('.play-label').textContent = 'Play tone';
    if (message) announce(message);
  }

  function playScale() {
    if (!scaleIsPlayable()) {
      announce('The complete 12-step set extends outside the playback window for this anchor. Choose a lower anchor to hear the full set.');
      return;
    }
    stopAll(false);
    const ctx = getAudioContext();
    const notes = octaveFoldedSet();
    const spacing = 0.46;
    notes.forEach((note, index) => {
      toneNode(state.anchor * note.ratio, ctx.currentTime + 0.05 + index * spacing, 0.37, Math.min(state.volume, 0.08));
    });
    const timer = window.setTimeout(() => announce('Twelve-step octave-folded phi set complete.'), (notes.length * spacing + 0.45) * 1000);
    state.sequenceTimers.push(timer);
    announce('Playing the twelve-step experimental octave-folded phi set.');
  }

  function stopAll(announceStop = true) {
    stopSustained(announceStop ? 'Tone stopped.' : '');
    state.sequenceTimers.forEach((id) => clearTimeout(id));
    state.sequenceTimers = [];
    const ctx = state.audioContext;
    if (ctx) {
      state.activeNodes.forEach((oscillator) => {
        try { oscillator.stop(ctx.currentTime + 0.01); } catch (_) { /* already stopped */ }
      });
      state.activeNodes.clear();
    }
    if (announceStop) announce('Audio stopped.');
  }

  function announce(message) {
    els.audioStatus.textContent = message;
  }

  function setAnchor(value, custom = false) {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 20 || next > 20000) return false;
    state.anchor = next;
    els.customAnchor.value = String(next);
    document.querySelectorAll('[data-anchor]').forEach((button) => {
      const active = custom ? button.dataset.anchor === 'custom' : Number(button.dataset.anchor) === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    els.customAnchor.disabled = !custom;
    renderGrid();
    return true;
  }

  function updateUrl() {
    try {
      const url = new URL(window.location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      url.searchParams.set('anchor', String(state.anchor));
      url.searchParams.set('n', String(state.exponent));
      history.replaceState(null, '', url);
    } catch (_) { /* URL persistence is progressive enhancement */ }
  }

  function loadUrlState() {
    const params = new URLSearchParams(window.location.search);
    const anchor = Number(params.get('anchor'));
    const exponent = Number(params.get('n'));
    if (Number.isFinite(anchor) && anchor >= 20 && anchor <= 20000) state.anchor = anchor;
    if (Number.isInteger(exponent) && exponent >= -6 && exponent <= 6) state.exponent = exponent;

    els.exponent.value = String(state.exponent);
    els.customAnchor.value = String(state.anchor);
    const preset = state.anchor === 432 || state.anchor === 440;
    document.querySelectorAll('[data-anchor]').forEach((button) => {
      const active = preset ? Number(button.dataset.anchor) === state.anchor : button.dataset.anchor === 'custom';
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    els.customAnchor.disabled = preset;
  }

  async function copyFrequency() {
    const frequency = frequencyFor(state.exponent);
    const text = `${formatFrequency(frequency)} Hz · anchor ${formatAnchor(state.anchor)} Hz · φ^${state.exponent}`;
    try {
      await navigator.clipboard.writeText(text);
      els.copyButton.textContent = 'Copied';
      window.setTimeout(() => { els.copyButton.textContent = 'Copy selected frequency'; }, 1200);
    } catch (_) {
      window.prompt('Copy frequency:', text);
    }
  }

  function csvContent() {
    const rows = [['exponent', 'ratio', 'frequency_hz', 'cents_from_anchor', 'period_ms', 'wavelength_air_343m_s_m']];
    for (let n = -6; n <= 6; n += 1) {
      const ratio = ratioFor(n);
      const frequency = state.anchor * ratio;
      rows.push([
        n,
        ratio.toFixed(12),
        frequency.toFixed(9),
        centsForRatio(ratio).toFixed(6),
        (1000 / frequency).toFixed(9),
        (SPEED_OF_SOUND / frequency).toFixed(9),
      ]);
    }
    return rows.map((row) => row.join(',')).join('\n');
  }

  function downloadCsv() {
    const blob = new Blob([csvContent()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchorLabel = formatAnchor(state.anchor).replace('.', '_');
    const link = document.createElement('a');
    link.href = url;
    link.download = `golden-ratio-frequency-ladder-${anchorLabel}Hz.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function drawSpiral() {
    const canvas = els.spiralCanvas;
    const context = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssSize = Math.max(280, Math.min(canvas.clientWidth || 560, 760));
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssSize, cssSize);

    const center = cssSize / 2;
    const maxR = cssSize * 0.44;
    const growth = (2 * Math.log(PHI)) / Math.PI; // radius × φ every quarter turn
    const thetaMax = Math.PI * 5.35;
    const scale = maxR / Math.exp(growth * thetaMax);

    const gradient = context.createRadialGradient(center, center, 0, center, center, maxR);
    gradient.addColorStop(0, 'rgba(255,230,163,0.96)');
    gradient.addColorStop(0.54, 'rgba(217,184,95,0.54)');
    gradient.addColorStop(1, 'rgba(139,113,50,0.03)');
    context.strokeStyle = gradient;
    context.lineWidth = 1.35;
    context.beginPath();
    for (let i = 0; i <= 1000; i += 1) {
      const theta = (i / 1000) * thetaMax;
      const radius = scale * Math.exp(growth * theta);
      const x = center + radius * Math.cos(theta);
      const y = center + radius * Math.sin(theta);
      if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();

    context.strokeStyle = 'rgba(241,216,143,0.075)';
    context.lineWidth = 1;
    for (let i = 1; i <= 6; i += 1) {
      context.beginPath();
      context.arc(center, center, (maxR / 6) * i, 0, Math.PI * 2);
      context.stroke();
    }

    context.fillStyle = 'rgba(241,216,143,0.48)';
    context.font = '10px system-ui';
    context.fillText(`golden angle ${GOLDEN_ANGLE.toFixed(6)}°`, 16, cssSize - 17);
  }

  document.querySelectorAll('[data-anchor]').forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.dataset.anchor;
      if (value === 'custom') {
        els.customAnchor.disabled = false;
        setAnchor(els.customAnchor.value || state.anchor, true);
        els.customAnchor.focus();
      } else {
        setAnchor(Number(value), false);
      }
    });
  });

  els.customAnchor.addEventListener('input', () => {
    setAnchor(els.customAnchor.value, true);
  });
  els.customAnchor.addEventListener('blur', () => {
    if (!setAnchor(els.customAnchor.value, true)) els.customAnchor.value = String(state.anchor);
  });

  els.exponent.addEventListener('input', () => {
    state.exponent = Number(els.exponent.value);
    updateReadout();
  });

  els.volume.addEventListener('input', () => {
    state.volume = Number(els.volume.value);
    updateReadout({ syncAudio: false });
    if (state.sustained && state.audioContext) {
      state.sustained.gain.gain.setTargetAtTime(Math.max(0.0001, state.volume), state.audioContext.currentTime, 0.02);
    }
  });

  els.playButton.addEventListener('click', toggleSustainedTone);
  els.playScaleButton.addEventListener('click', playScale);
  els.stopButton.addEventListener('click', () => stopAll(true));
  els.copyButton.addEventListener('click', copyFrequency);
  els.downloadCsvButton.addEventListener('click', downloadCsv);
  window.addEventListener('resize', drawSpiral, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll(false); });

  loadUrlState();
  renderGrid();
  renderOctaveSet();
  drawSpiral();
})();
