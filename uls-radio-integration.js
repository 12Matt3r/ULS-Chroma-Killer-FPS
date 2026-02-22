/**
 * ULS Radio Integration Module
 * Manages all radio functionality using Web Audio API.
 */

const STATIONS = [
    { 
        name: 'DISCO RODEO 98.7', 
        description: 'High-energy disco, funk, and classic dance hits', 
        genre: 'youtube',
        embedUrl: 'https://www.youtube.com/embed/videoseries?list=PLPug0RGgea9oJrCXJmLrThdWGywYUODff&autoplay=1&mute=0'
    },
    { 
        name: 'THE OTHER 102.3', 
        description: 'Vapor wave, retro synth, and nostalgic electronic sounds', 
        genre: 'youtube',
        embedUrl: 'https://www.youtube.com/embed/videoseries?list=PLPug0RGgea9og_auAyT8n-An7lhvdJCfM&autoplay=1&mute=0'
    },
    { 
        name: 'HIP-HOP OFF THE PORCH 94.5', 
        description: 'Raw hip-hop beats and street anthems', 
        genre: 'youtube',
        embedUrl: 'https://www.youtube.com/embed/videoseries?list=PLPug0RGgea9r-KWnhFVp8pDQ4_VJ2UADq&autoplay=1&mute=0'
    },
    { 
        name: 'BACK 40 DRIP 95.1', 
        description: 'Smooth beats and mellow vibes from the countryside', 
        genre: 'audiomack',
        embedUrl: 'https://audiomack.com//embed/tfurrsmiles88/album/back-forty-drip'
    },
    { 
        name: 'KOZY FM 88.3', 
        description: 'Cozy, relaxing tunes for laid-back vibes', 
        genre: 'youtube',
        embedUrl: 'https://www.youtube.com/embed/videoseries?list=PLPug0RGgea9rsMCs92f53DqAWuDizvTZK&autoplay=1&mute=0'
    },
    { 
        name: 'MOSH PIT FM 103.7', 
        description: 'Heavy metal, hardcore, and intense rock sounds', 
        genre: 'youtube',
        embedUrl: 'https://www.youtube.com/embed/videoseries?list=PLPug0RGgea9rEZhSB6T5L_xCJ-fnZz8Os&autoplay=1&mute=0'
    },
    { 
        name: 'NOTEBOOK FM 96.5', 
        description: 'Personal audio journal and music collection', 
        genre: 'audiomack',
        embedUrl: 'https://audiomack.com//embed/tfurrsmiles88/album/notebookfm'
    }
];


export class RadioSystem {
    constructor() {
        this.audioContext = null;
        this.gainNode = null;
        this.oscillator = null;
        this.noiseNode = null;
        this.filterNode = null;
        this.lfo = null;

        this.stations = STATIONS;
        this.currentStationIndex = 0;
        this.isPlaying = false;
        this.isPowered = false;
        this.volume = 0.7;
        
        // For procedural music
        this.sequencer = null;
        this.activeAudioNodes = [];

        // NEW: hidden iframe players per station
        this.stationIframes = [];
    }

    async init() {
        // UI setup is all that's needed here now.
        // AudioContext will be created on first user gesture (power button).
        this.setupUI();
    }
    
    setupAudioContext() {
        // No longer needed for playlist playback, but kept for compatibility.
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 0; // Start silent
            this.gainNode.connect(this.audioContext.destination);
            console.log("AudioContext initialized.");
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    setupUI() {
        document.getElementById('radio-power').addEventListener('click', () => this.togglePower());
        document.getElementById('radio-play').addEventListener('click', () => this.togglePlay());
        document.getElementById('radio-prev').addEventListener('click', () => this.prevTrack());
        document.getElementById('radio-next').addEventListener('click', () => this.nextTrack());
        document.getElementById('radio-shuffle').addEventListener('click', () => this.toggleShuffle());
        document.getElementById('volume-slider').addEventListener('input', (e) => this.setVolume(e.target.value / 100));

        // NEW: minimize / expand radio panel
        const radioPanel = document.getElementById('uls-radio');
        const minimizeBtn = document.getElementById('radio-minimize');
        if (radioPanel && minimizeBtn) {
            minimizeBtn.addEventListener('click', () => {
                radioPanel.classList.toggle('minimized');
                // Swap icon between minus and plus for clarity
                if (radioPanel.classList.contains('minimized')) {
                    minimizeBtn.textContent = '+';
                } else {
                    minimizeBtn.textContent = '−';
                }
            });
        }
        
        const stationButtonsContainer = document.getElementById('station-buttons-container');
        stationButtonsContainer.innerHTML = ''; // Clear any existing buttons
        this.stations.forEach((station, index) => {
            const btn = document.createElement('button');
            btn.className = 'station-btn';
            btn.textContent = station.name;
            btn.dataset.station = index;
            btn.addEventListener('click', () => {
                this.changeStation(index);
            });
            stationButtonsContainer.appendChild(btn);
        });

        // NEW: create hidden iframe players for each station
        this.createStationIframes();
        
        this.updateUI();
    }

    // NEW: create one hidden iframe per station for audio-only playback
    createStationIframes() {
        const container = document.createElement('div');
        container.id = 'uls-radio-iframe-container';
        container.style.position = 'absolute';
        container.style.width = '0';
        container.style.height = '0';
        container.style.overflow = 'hidden';
        container.style.pointerEvents = 'none';
        container.style.opacity = '0';
        document.body.appendChild(container);

        this.stations.forEach((station, index) => {
            const iframe = document.createElement('iframe');
            iframe.setAttribute('allow', 'autoplay; encrypted-media');
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = '0';
            iframe.style.position = 'absolute';
            iframe.style.left = '-9999px';
            iframe.style.top = '-9999px';
            iframe.dataset.stationIndex = index;
            iframe.src = 'about:blank'; // lazy-load on play
            container.appendChild(iframe);
            this.stationIframes[index] = iframe;
        });
    }
    
    togglePower() {
        // Ensure at least one user gesture is registered (good for autoplay policies)
        this.isPowered = !this.isPowered;
        
        if (this.isPowered) {
            if (!this.isPlaying) {
                this.play();
            }
        } else {
            if (this.isPlaying) {
                this.pause();
            }
        }
        
        document.getElementById('uls-radio').classList.toggle('off', !this.isPowered);
        this.updateUI();
    }
    
    togglePlay() {
        if (!this.isPowered) return;
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    play() {
        if (!this.isPowered || this.isPlaying) return;
        this.isPlaying = true;
        this.playCurrentStation();
        this.updateUI();
    }

    pause() {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        this.stopAllAudio();
        this.updateUI();
    }
    
    nextTrack() {
        if (!this.isPowered) return;
        this.changeStation((this.currentStationIndex + 1) % this.stations.length);
    }
    
    prevTrack() {
        if (!this.isPowered) return;
        this.changeStation((this.currentStationIndex - 1 + this.stations.length) % this.stations.length);
    }
    
    changeStation(index) {
        if (!this.isPowered || this.currentStationIndex === index) return;
        
        this.currentStationIndex = index;
        
        document.querySelectorAll('.station-btn').forEach((btn, i) => {
            btn.classList.toggle('active', i === index);
        });

        if (this.isPlaying) {
            this.playCurrentStation();
        }
        
        this.updateUI();
    }
    
    toggleShuffle() {
        // Stub for shuffle logic
        console.log("Shuffle toggled (stub).");
    }
    
    setVolume(vol) {
        this.volume = vol;
        // NOTE: We cannot directly control cross-origin iframe audio volume reliably.
        // This slider now just updates the stored volume value for potential future use.
    }
    
    updateUI() {
        const station = this.stations[this.currentStationIndex];
        
        const stationNameEl = document.getElementById('station-name-display');
        const trackNameEl = document.getElementById('track-name');
        
        if (this.isPowered) {
            stationNameEl.textContent = station.name;
            trackNameEl.textContent = this.isPlaying ? station.description : 'Paused';
        } else {
            stationNameEl.textContent = 'Power Off';
            trackNameEl.textContent = '--';
        }
        
        document.getElementById('track-time').textContent = this.isPowered && this.isPlaying 
                ? 'LIVE'
                : '--:-- / --:--';

        document.getElementById('radio-play').textContent = this.isPlaying ? '⏸' : '▶';

        const powerBtn = document.getElementById('radio-power');
        powerBtn.classList.toggle('active', this.isPowered);
    }

    stopAllAudio() {
        // Stop all iframes by resetting their src
        this.stationIframes.forEach((iframe, index) => {
            if (iframe) {
                iframe.src = 'about:blank';
            }
        });

        // Legacy procedural audio cleanup (no longer used, but kept safe)
        if (this.oscillator) {
            this.oscillator.stop();
            this.oscillator.disconnect();
            this.oscillator = null;
        }
        if (this.noiseNode) {
            this.noiseNode.disconnect();
            this.noiseNode = null;
        }
        if (this.lfo) {
            this.lfo.stop();
            this.lfo.disconnect();
            this.lfo = null;
        }
        if (this.filterNode) {
            this.filterNode.disconnect();
            this.filterNode = null;
        }
        
        if (this.sequencer) {
            this.sequencer.stop();
            this.sequencer = null;
        }
        
        this.activeAudioNodes.forEach(node => {
            if (node.stop) node.stop();
            node.disconnect();
        });
        this.activeAudioNodes = [];
    }
    
    playCurrentStation() {
        // Ensure all stations are stopped first
        this.stopAllAudio();

        const station = this.stations[this.currentStationIndex];
        const iframe = this.stationIframes[this.currentStationIndex];
        if (!station || !iframe || !station.embedUrl) {
            console.warn('No embed URL configured for station:', station);
            return;
        }

        // Autoplay the playlist via iframe; visuals are hidden via styles
        iframe.src = station.embedUrl;
    }

    // --- Instrument functions ---
    // (kept for backward compatibility but no longer used for playlist playback)

    playDiscoMusic() {
        const tempo = 120;
        const kickPattern = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
        const hatPattern  = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
        const bassNotes = [55, 55, 62, 62]; // A1, A1, D2, D2
        
        this.sequencer = new Sequencer(this, tempo, (step, time) => {
            if (kickPattern[step % 16]) this.playKick(time);
            if (hatPattern[step % 16]) this.playHat(time);
            
            if (step % 4 === 0) {
                const note = bassNotes[Math.floor((step % 16) / 4)];
                this.playSynthNote(time, note * 2, 0.2, 'sawtooth', 400);
            }
        });
        this.sequencer.start();
    }

    playHipHopMusic() {
        const tempo = 90;
        const kickPattern = [1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0];
        const snarePattern= [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
        const hatPattern  = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
        const bassNotes = [43.65, 0, 43.65, 0, 51.91, 0, 0, 0]; // F1, F1, A#1

        this.sequencer = new Sequencer(this, tempo, (step, time) => {
            if (kickPattern[step % 16]) this.playKick(time, 80);
            if (snarePattern[step % 16]) this.playSnare(time);
            if (hatPattern[step % 16]) this.playHat(time, 0.05);

            const note = bassNotes[step % 8];
            if (note > 0) {
                this.playSynthNote(time, note, 0.15, 'sine', 100);
            }
        });
        this.sequencer.start();
    }
    
    playSynthMusic() {
        const tempo = 100;
        const arpeggio = [73.42, 82.41, 98.00, 110.00, 123.47, 110.00, 98.00, 82.41]; // D2, E2, G2, A2...
        
        this.sequencer = new Sequencer(this, tempo, (step, time) => {
            const note = arpeggio[step % 8];
            this.playSynthNote(time, note * 2, 0.25, 'triangle', 800, 0.3);
            if(step % 16 === 0) this.playKick(time, 100, 0.3, 0.8);
        });
        this.sequencer.start();
    }

    playMetalMusic() {
        const tempo = 140;
        const kickPattern = [1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1];
        const snarePattern= [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];

        this.sequencer = new Sequencer(this, tempo, (step, time) => {
            if (kickPattern[step % 16]) this.playKick(time, 150, 0.1, 1.2);
            if (snarePattern[step % 16]) this.playSnare(time);
            
            if (step % 2 === 0) {
                const distGain = this.audioContext.createGain();
                distGain.gain.value = 2;
                const noise = this.createNoise(0.08);
                noise.connect(distGain).connect(this.gainNode);
                this.activeAudioNodes.push(noise, distGain);
            }
        });
        this.sequencer.start();
    }

    playAmbientMusic() {
        // Long, evolving pad sound
        const osc = this.audioContext.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 55; // A1
        
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 150;
        
        const lfo = this.audioContext.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.1; // Very slow
        
        const lfoGain = this.audioContext.createGain();
        lfoGain.gain.value = 50;
        
        lfo.connect(lfoGain).connect(filter.frequency);
        osc.connect(filter).connect(this.gainNode);
        
        osc.start();
        lfo.start();

        this.activeAudioNodes.push(osc, filter, lfo, lfoGain);
    }
    
    // --- Instrument functions ---

    playKick(time, freq = 120, decay = 0.2, gain = 1) {
        const osc = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        osc.connect(gainNode);
        gainNode.connect(this.gainNode);
        
        osc.frequency.setValueAtTime(freq, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + decay);
        gainNode.gain.setValueAtTime(gain, time);
        gainNode.gain.exponentialRampToValueAtTime(0.01, time + decay);
        
        osc.start(time);
        osc.stop(time + decay);
        this.activeAudioNodes.push(osc, gainNode);
    }

    playSnare(time, decay = 0.15) {
        const noise = this.createNoise(decay);
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 1000;
        
        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(1, time);
        gainNode.gain.exponentialRampToValueAtTime(0.01, time + decay);

        noise.connect(filter).connect(gainNode).connect(this.gainNode);
        this.activeAudioNodes.push(noise, filter, gainNode);
    }

    playHat(time, decay = 0.05) {
        const noise = this.createNoise(decay);
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 7000;

        noise.connect(filter).connect(this.gainNode);
        this.activeAudioNodes.push(noise, filter);
    }
    
    playSynthNote(time, freq, duration, type = 'sine', filterFreq = 1200, gain = 0.5) {
        const osc = this.audioContext.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);

        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = filterFreq;

        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(0, time);
        gainNode.gain.linearRampToValueAtTime(gain, time + 0.02);
        gainNode.gain.linearRampToValueAtTime(0, time + duration);

        osc.connect(filter).connect(gainNode).connect(this.gainNode);
        osc.start(time);
        osc.stop(time + duration);
        this.activeAudioNodes.push(osc, filter, gainNode);
    }
    
    createNoise(duration) {
        const bufferSize = this.audioContext.sampleRate;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const whiteNoise = this.audioContext.createBufferSource();
        whiteNoise.buffer = buffer;
        whiteNoise.loop = true;
        whiteNoise.start(0);

        if (duration) {
            whiteNoise.stop(this.audioContext.currentTime + duration);
        }

        return whiteNoise;
    }
}

// --- Sequencer Class for procedural music ---
class Sequencer {
    constructor(radio, tempo, callback) {
        this.radio = radio;
        this.audioContext = radio.audioContext;
        this.tempo = tempo;
        this.callback = callback;
        
        this.noteTime = 0.0;
        this.currentStep = 0;
        this.scheduleAheadTime = 0.1;
        this.lookahead = 25.0; // ms
        this.timerId = null;
    }

    start() {
        this.noteTime = this.audioContext.currentTime;
        this.currentStep = 0;
        this.scheduler();
    }

    stop() {
        clearTimeout(this.timerId);
    }

    scheduler() {
        while (this.noteTime < this.audioContext.currentTime + this.scheduleAheadTime) {
            this.callback(this.currentStep, this.noteTime);
            this.advanceNote();
        }
        this.timerId = setTimeout(() => this.scheduler(), this.lookahead);
    }

    advanceNote() {
        const secondsPerBeat = 60.0 / this.tempo;
        const noteDuration = secondsPerBeat / 4; // 16th notes
        this.noteTime += noteDuration;
        this.currentStep++;
    }
}