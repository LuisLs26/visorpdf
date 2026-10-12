/**
 * Visor Libro - Sistema Acústico Hiperrealista de Papel Físico
 * Generación procedural multi-fase en tiempo real mediante Web Audio API:
 * 1. Despegue y fricción de esquina (frecuencia alta, fibras de celulosa)
 * 2. Desplazamiento aerodinámico y curvatura (barrido flutter y modulación de aire)
 * 3. Amortiguación y asentamiento sobre el pliego enfrentado (resonancia acústica cálida)
 * Incluye distribución estéreo espacial interactiva (derecha a izquierda / izquierda a derecha).
 */

class PaperSoundSystem {
  constructor() {
    this.audioCtx = null;
    this.forwardBuffers = [];
    this.backwardBuffers = [];
    this.cornerPeelBuffers = [];
    this.isMuted = false;
    this.isInitialized = false;

    // Desbloquear AudioContext en la primera interacción para políticas de navegadores
    const unlockAudio = () => {
      this.init();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('pointerdown', unlockAudio);
    };

    window.addEventListener('click', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
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
      this.synthesizeAcousticProfiles();
      this.isInitialized = true;
    } catch (e) {
      console.warn('AudioContext no inicializado:', e);
    }
  }

  /**
   * Sintetiza buffers de audio hiperrealistas con física acústica de papel de libro
   */
  synthesizeAcousticProfiles() {
    const ctx = this.audioCtx;
    const sampleRate = ctx.sampleRate;

    // Generar 3 variaciones para pasar página hacia adelante y 3 hacia atrás
    for (let variant = 0; variant < 3; variant++) {
      this.forwardBuffers.push(this.buildPageTurnBuffer(sampleRate, variant, 'forward'));
      this.backwardBuffers.push(this.buildPageTurnBuffer(sampleRate, variant, 'backward'));
    }

    // Generar 2 variaciones para roce/levantamiento sutil de esquina
    for (let variant = 0; variant < 2; variant++) {
      this.cornerPeelBuffers.push(this.buildCornerPeelBuffer(sampleRate, variant));
    }
  }

  /**
   * Construye un buffer estereofónico que simula una hoja real viajando por el espacio
   */
  buildPageTurnBuffer(sampleRate, variant, direction) {
    const duration = 0.44 + variant * 0.05; // ~440ms a 540ms
    const numFrames = Math.floor(sampleRate * duration);
    const buffer = this.audioCtx.createBuffer(2, numFrames, sampleRate);
    const chL = buffer.getChannelData(0);
    const chR = buffer.getChannelData(1);

    let b0 = 0, b1 = 0, b2 = 0;

    for (let i = 0; i < numFrames; i++) {
      const t = i / sampleRate;
      const progress = t / duration;

      // 1. Ruido rosa de alta definición (textura de grano de papel)
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      const pink = b0 + b1 + b2 + white * 0.5362;

      // 2. Ruido marrón para el cuerpo de papel pesado (120g/m²)
      const brown = (b0 + b1) * 0.5;

      // 3. Fase 1: Despegue inicial crujiente de esquina (0% a 15%)
      let initialPeel = 0;
      if (progress < 0.15) {
        const peelProgress = progress / 0.15;
        initialPeel = (Math.random() * 2 - 1) * Math.sin(peelProgress * Math.PI) * 0.12;
      }

      // 4. Fase 2: Ondulación aerodinámica en el arco central (15% a 65%)
      const flutterFreq = 22 + variant * 4;
      const flutter = 1.0 + 0.18 * Math.sin(2 * Math.PI * flutterFreq * t);

      // Curva principal de envolvente de amplitud
      let env = 0;
      if (progress < 0.20) {
        env = Math.sin((progress / 0.20) * Math.PI * 0.5);
      } else {
        env = Math.pow(1 - (progress - 0.20) / 0.80, 2.4);
      }

      // 5. Fase 3: Asentamiento y colchón de aire al posarse sobre el bloque (60% a 95%)
      let settleThump = 0;
      const settleProgress = (progress - 0.58) / 0.32;
      if (settleProgress > 0 && settleProgress < 1) {
        // Resonancia de baja frecuencia natural de la mesa y el papel (135Hz a 180Hz)
        const thumpFreq = 145 + variant * 12;
        settleThump = Math.sin(2 * Math.PI * thumpFreq * (t - 0.58 * duration)) *
                      Math.exp(-settleProgress * 7) * 0.22;
      }

      const totalSignal = ((pink * 0.08 + brown * 0.04) * flutter + initialPeel + settleThump) * env;

      // 6. Paneo espacial dinámico según la dirección del pase de hoja
      let pan;
      if (direction === 'forward') {
        // De derecha (+0.6) a izquierda (0.2)
        pan = 0.65 - progress * 0.45;
      } else {
        // De izquierda (0.2) a derecha (+0.6)
        pan = 0.20 + progress * 0.45;
      }

      chL[i] = totalSignal * (1 - pan);
      chR[i] = totalSignal * pan;
    }

    return buffer;
  }

  /**
   * Sonido sutil de cuando el usuario empieza a doblar o tocar la esquina
   */
  buildCornerPeelBuffer(sampleRate, variant) {
    const duration = 0.16 + variant * 0.03;
    const numFrames = Math.floor(sampleRate * duration);
    const buffer = this.audioCtx.createBuffer(2, numFrames, sampleRate);
    const chL = buffer.getChannelData(0);
    const chR = buffer.getChannelData(1);

    for (let i = 0; i < numFrames; i++) {
      const progress = i / numFrames;
      const white = Math.random() * 2 - 1;
      const env = Math.sin(progress * Math.PI);
      const sample = white * 0.04 * env;
      chL[i] = sample;
      chR[i] = sample;
    }

    return buffer;
  }

  /**
   * Reproduce el sonido de volteo físico completo
   */
  playFlip(direction = 'forward') {
    if (this.isMuted) return;
    this.init();
    if (!this.audioCtx) return;

    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const bufferList = direction === 'backward' ? this.backwardBuffers : this.forwardBuffers;
      if (bufferList.length === 0) return;

      const buffer = bufferList[Math.floor(Math.random() * bufferList.length)];
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;

      // Microrandomización de velocidad de reproducción (0.95x - 1.05x)
      source.playbackRate.value = 0.95 + Math.random() * 0.10;

      // Filtro paso bajo cálido que suaviza el sonido dándole textura de libro encuadernado
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 3800 + Math.random() * 600;
      filter.Q.value = 0.7;

      const gainNode = this.audioCtx.createGain();
      gainNode.gain.value = 0.88;

      source.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.audioCtx.destination);

      source.start();
    } catch (e) {
      console.warn('Error al reproducir audio de página:', e);
    }
  }

  /**
   * Reproduce el roce sutil al doblar la esquina con el cursor
   */
  playCornerFold() {
    if (this.isMuted) return;
    this.init();
    if (!this.audioCtx || this.cornerPeelBuffers.length === 0) return;

    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const buffer = this.cornerPeelBuffers[Math.floor(Math.random() * this.cornerPeelBuffers.length)];
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 0.96 + Math.random() * 0.08;

      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2800;
      filter.Q.value = 1.2;

      const gain = this.audioCtx.createGain();
      gain.gain.value = 0.45;

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.audioCtx.destination);

      source.start();
    } catch (e) {
      // ignorar
    }
  }
}

// Instancia global
window.paperSound = new PaperSoundSystem();
