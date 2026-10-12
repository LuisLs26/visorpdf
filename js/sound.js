/**
 * Visor Libro - Sistema de Sonido Realista de Papel Físico
 * Utiliza Web Audio API para generar de forma procedural y de alta fidelidad
 * el sonido acústico natural del roce, fluttering y asentamiento de las páginas.
 */

class PaperSoundSystem {
  constructor() {
    this.audioCtx = null;
    this.flipBuffers = [];
    this.isMuted = false;
    this.isInitialized = false;

    // Inicializar con la primera interacción del usuario para cumplir políticas del navegador
    const unlockAudio = () => {
      this.init();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };

    window.addEventListener('click', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });
  }

  init() {
    if (this.isInitialized) {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      this.audioCtx = new AudioContextClass();
      this.generatePaperSounds();
      this.isInitialized = true;
    } catch (e) {
      console.warn('AudioContext no soportado:', e);
    }
  }

  /**
   * Genera de forma procedural 4 variaciones orgánicas del paso de página
   */
  generatePaperSounds() {
    const ctx = this.audioCtx;
    const sampleRate = ctx.sampleRate;

    // Generar 4 variaciones con sutiles diferencias tímbricas y de duración
    for (let variant = 0; variant < 4; variant++) {
      const duration = 0.36 + variant * 0.04; // entre 360ms y 480ms
      const numFrames = Math.floor(sampleRate * duration);
      const buffer = ctx.createBuffer(2, numFrames, sampleRate);
      const chL = buffer.getChannelData(0);
      const chR = buffer.getChannelData(1);

      let b0 = 0, b1 = 0, b2 = 0;

      for (let i = 0; i < numFrames; i++) {
        const t = i / sampleRate;
        const progress = t / duration;

        // 1. Ruido rosa suave (fricción de fibras de celulosa)
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        const pink = b0 + b1 + b2 + white * 0.5362;

        // 2. Curva de envolvente natural:
        // Ataque suave, cuerpo con microvibraciones de aire y desvanecimiento exponencial
        let env;
        if (progress < 0.18) {
          env = Math.sin((progress / 0.18) * Math.PI * 0.5);
        } else {
          env = Math.pow(1 - (progress - 0.18) / 0.82, 2.2);
        }

        // Micro-ondulación del aire al ondularse la hoja
        const flutterFreq = 26 + variant * 5;
        const flutter = 1.0 + 0.14 * Math.sin(2 * Math.PI * flutterFreq * t);

        // 3. Resonancia tenue del cuerpo del libro al reposar la hoja
        const settleProgress = (progress - 0.55) / 0.35;
        let settleThump = 0;
        if (settleProgress > 0 && settleProgress < 1) {
          settleThump = Math.sin(2 * Math.PI * 130 * (t - 0.55 * duration)) *
                        Math.exp(-settleProgress * 6) * 0.15;
        }

        const sample = (pink * 0.07 * flutter + settleThump) * env;

        // Distribución estéreo suave (la hoja se desplaza en el espacio)
        const pan = (variant % 2 === 0)
          ? 0.45 + (progress * 0.15)
          : 0.55 - (progress * 0.15);

        chL[i] = sample * (1 - pan);
        chR[i] = sample * pan;
      }

      this.flipBuffers.push(buffer);
    }
  }

  /**
   * Reproduce el sonido realista de volteo de página
   */
  playFlip() {
    if (this.isMuted) return;
    this.init();
    if (!this.audioCtx || this.flipBuffers.length === 0) return;

    try {
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const randomIdx = Math.floor(Math.random() * this.flipBuffers.length);
      const buffer = this.flipBuffers[randomIdx];

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      // Variación orgánica de tono en cada pase
      source.playbackRate.value = 0.94 + Math.random() * 0.12;

      // Filtro paso-bajo cálido para dar textura de papel aterciopelado
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 3400 + Math.random() * 500;

      // Ganancia de volumen suave y no estridente
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0.85;

      source.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);

      source.start();
    } catch (e) {
      console.warn('Error al reproducir audio de página:', e);
    }
  }
}

// Instancia global
window.paperSound = new PaperSoundSystem();
