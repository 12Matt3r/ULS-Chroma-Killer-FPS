import * as THREE from 'three';
import nipplejs from 'nipplejs';
import { LivingHellMode } from './living-hell-module.js';
// import { RadioSystem } from './uls-radio-integration.js'; // Radio removed
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Simple WaveManager stub to prevent runtime errors and show basic Survival HUD
class WaveManager {
    constructor(game) {
        this.game = game;
        this.active = false;
        this.waveNumber = 0;
    }

    activate() {
        if (this.active) return;
        this.active = true;
        this.game.isSurvivalModeActive = true;

        const hud = document.getElementById('survival-hud');
        if (hud) {
            hud.style.display = 'block';
        }

        // NEW: hide the start wave button while Survival Mode is active
        const startWaveBtn = document.getElementById('start-wave-btn');
        if (startWaveBtn) {
            startWaveBtn.style.display = 'none';
        }

        // Start the first wave when activated
        this.startNextWave();
    }

    startNextWave() {
        this.waveNumber += 1;
        const enemiesToSpawn = 3 + (this.waveNumber - 1) * 2; // 3,5,7,...

        // NEW: every 5th wave is a boss wave
        const isBossWave = (this.waveNumber % 5 === 0);

        // Update HUD text so the mode feels alive
        const waveCounter = document.getElementById('wave-counter');
        const enemiesRemaining = document.getElementById('enemies-remaining');
        const waveAnnouncement = document.getElementById('wave-announcement');

        if (waveCounter) waveCounter.textContent = `WAVE ${this.waveNumber}`;
        if (enemiesRemaining) enemiesRemaining.textContent = `ENEMIES: ${enemiesToSpawn}`;
        if (waveAnnouncement) {
            waveAnnouncement.textContent = isBossWave
                ? `BOSS WAVE ${this.waveNumber} INCOMING`
                : `WAVE ${this.waveNumber} INCOMING`;
            waveAnnouncement.classList.add('active');
            setTimeout(() => waveAnnouncement.classList.remove('active'), 1500);
        }

        // Ask the game to spawn enemies for this wave
        if (this.game && typeof this.game.spawnEnemies === 'function') {
            this.game.spawnEnemies(enemiesToSpawn, isBossWave);
        }
    }

    onEnemyKilled() {
        const enemiesRemaining = document.getElementById('enemies-remaining');
        const remaining = Array.isArray(this.game.enemies) ? this.game.enemies.length : 0;
        if (enemiesRemaining) enemiesRemaining.textContent = `ENEMIES: ${remaining}`;

        if (remaining === 0 && this.active) {
            const waveAnnouncement = document.getElementById('wave-announcement');
            const isBossWave = (this.waveNumber % 5 === 0);

            // NEW ECONOMY: Only boss waves pay out, and each 5-wave boss run
            // pays exactly the cost of the NEXT weapon upgrade level.
            if (isBossWave && this.game && this.game.stats) {
                const nextLevel = (this.game.stats.gunLevel || 1) + 1;
                const bossRunReward = 250 * Math.pow(2, nextLevel - 1); // matches Cost_n
                this.game.stats.money += bossRunReward;

                if (typeof this.game.updateStatsUI === 'function') {
                    this.game.updateStatsUI();
                }

                if (waveAnnouncement) {
                    waveAnnouncement.textContent =
                        `BOSS WAVE ${this.waveNumber} CLEARED — $${bossRunReward.toLocaleString()} EARNED FOR NEXT UPGRADE.`;
                    waveAnnouncement.classList.add('active');
                    setTimeout(() => waveAnnouncement.classList.remove('active'), 2500);
                }

                // After each boss, stop Survival Mode and return to downtime.
                this.active = false;
                this.game.isSurvivalModeActive = false;

                // Re-enable the Start Wave button so the player can manually start again
                const startWaveBtn = document.getElementById('start-wave-btn');
                if (startWaveBtn) {
                    startWaveBtn.style.display = 'block';
                }

                // NOTE: We intentionally do NOT start the next wave automatically after a boss.
                return;
            }

            // Non-boss waves: no direct money reward; they are just steps in the boss run.
            if (!isBossWave && waveAnnouncement) {
                waveAnnouncement.textContent = `WAVE ${this.waveNumber} CLEARED`;
                waveAnnouncement.classList.add('active');
                setTimeout(() => waveAnnouncement.classList.remove('active'), 1200);
            }

            // Continue automatically to the next wave if we are not on a boss wave.
            if (!isBossWave) {
                setTimeout(() => {
                    if (this.active) {
                        this.startNextWave();
                    }
                }, 2000);
            }
        }
    }

    deactivate() {
        if (!this.active) return;
        this.active = false;
        this.game.isSurvivalModeActive = false;

        const hud = document.getElementById('survival-hud');
        if (hud) {
            hud.style.display = 'none';
        }

        // NEW: show the start wave button again when Survival Mode ends
        const startWaveBtn = document.getElementById('start-wave-btn');
        if (startWaveBtn) {
            startWaveBtn.style.display = 'block';
        }

        // Clear any spawned enemies safely
        if (Array.isArray(this.game.enemies)) {
            this.game.enemies.forEach(enemy => {
                if (enemy.mesh && enemy.mesh.parent) {
                    enemy.mesh.parent.remove(enemy.mesh);
                }
            });
            this.game.enemies.length = 0;
        }
    }
}

class UrbanLifeSimulator {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        this.ambientLight = null; // cache for performance
        // Reusable temp vectors to avoid per-frame allocations
        this._tmpVec3_1 = new THREE.Vector3();
        this._tmpVec3_2 = new THREE.Vector3();
        this._tmpVec3_3 = new THREE.Vector3();

        // Reusable particle resources to avoid per-impact allocations
        this._impactParticleGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.05);
        this._impactParticleMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

        // Game state
        this.stats = {
            health: 100,
            hunger: 100,
            energy: 100,
            money: 500,
            wantedLevel: 0,   // still tracked internally, but no longer shown in HUD
            score: 0,
            combo: 1,
            bestCombo: 1,
            gunLevel: 1          // NEW: starting gun level
        };

        // NEW: track last generated progress code for debugging or UI reuse
        this.lastProgressCode = null;

        this.time = 720; // Minutes since midnight (12:00 PM)
        this.timeSpeed = 1; // 1 minute per second

        // Simple weather / storm system
        this.weather = 'clear';          // 'clear' | 'storm'
        this.stormTimeLeft = 0;          // seconds remaining in current storm
        this.timeToNextStorm = 90 + Math.random() * 150; // seconds until next possible storm
        this.lightningCooldown = 0;      // seconds until next lightning flash within a storm

        this.currentLocation = 'Downtown';
        this.playerPosition = new THREE.Vector3(0, 1.7, 0);
        this.velocity = new THREE.Vector3();
        this.moveState = { forward: false, backward: false, left: false, right: false };
        this.cameraLook = new THREE.Vector2();

        // Mobile controls
        this.joystick = null;
        this.joystickVector = new THREE.Vector2();

        // Player physics
        this.canJump = true;
        this.isJumping = false;
        this.jumpVelocity = 0;

        // Survival Mode
        this.hitMarker = document.getElementById('hit-marker');
        this.waveManager = null;
        this.isSurvivalModeActive = false;
        this.enemies = [];
        this.projectiles = [];
        this.enemyProjectiles = []; // To hold enemy shots
        this.weapon = null;
        this.recoil = { x: 0, y: 0, z: 0 };
        this.cityBlocks = [];
        this.activeModifiers = {}; // To hold active vote modifiers

        // Small on-weapon tutorial card shown only at the very start of a run
        this.gunTutorialMesh = null;
        this.gunTutorialDuration = 15;  // seconds to keep the card visible
        this.gunTutorialEndTime = 0;    // world time when we should fully hide it

        // Living Hell Mode
        this.livingHellMode = null;
        this.inLivingHellZone = false;

        // Texture Loader
        this.textureLoader = null;

        // Inventory System
        this.inventory = new Map();
        this.itemObjects = []; // To hold THREE.Mesh objects for items
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.sounds = new Map();

        // NEW: per-sound configuration and cooldown tracking
        this.soundConfig = {
            use_item:      { volume: 0.8, pitchJitter: 0.04, minInterval: 0.05 },
            gunshot:       { volume: 1.0, pitchJitter: 0.08, minInterval: 0.07 },
            enemy_gunshot: { volume: 0.7, pitchJitter: 0.06, minInterval: 0.12 },
            hit_impact:    { volume: 0.9, pitchJitter: 0.05, minInterval: 0.03 },
            player_hit:    { volume: 0.85, pitchJitter: 0.03, minInterval: 0.15 }
        };
        this.soundLastPlayed = {};

        // Vehicle System (Stub)
        this.currentVehicle = null;

        // Enemy Assets
        this.enemyAssets = [
            '/IMG_9586.png',
            '/IMG_9589.png',
            '/IMG_9588.png',
            '/IMG_9590.png',
            '/IMG_9591.png',
            '/IMG_9587.png',
            '/IMG_9592.png',
            // Additional enemy GIF variants so previously unused art shows up in-game
            '/IMG_9581.gif',
            '/IMG_9582.gif',
            '/IMG_9583.gif'
        ];
        this.enemyTextures = []; // Array to hold loaded textures

        // NEW: power-up textures
        this.powerupTextures = {
            health: null, // water bottle
            energy: null, // energy drink
            hunger: null  // food can
        };

        // Locations
        this.locations = [
            { name: 'Downtown', position: new THREE.Vector3(0, 0, 0) },
            { name: 'Industrial District', position: new THREE.Vector3(50, 0, 50) },
            { name: 'Residential Area', position: new THREE.Vector3(-50, 0, 50) },
            { name: 'The Living Hell House', position: new THREE.Vector3(100, 0, 0) },
            { name: 'The Docks', position: new THREE.Vector3(120, 0, 20) },
            { name: 'Chinatown', position: new THREE.Vector3(110, 0, -20) }
        ];

        this.livingHellZones = ['The Living Hell House', 'The Tank', 'Fishtank Address'];

        // NEW: cache frequently used DOM elements for better performance & UX
        this.ui = {
            loadingScreen: document.getElementById('loading-screen'),
            loadingProgress: document.getElementById('loading-progress'),
            loadingText: document.getElementById('loading-text'),
            healthBar: document.getElementById('health-bar'),
            hungerBar: document.getElementById('hunger-bar'),
            energyBar: document.getElementById('energy-bar'),
            healthValue: document.getElementById('health-value'),
            hungerValue: document.getElementById('hunger-value'),
            energyValue: document.getElementById('energy-value'),
            moneyValue: document.getElementById('money-value'),
            wantedStars: null, // HUD no longer displays wanted stars in top-left
            timeDisplay: document.getElementById('time-display'),
            locationDisplay: document.getElementById('location-display'),
            fastTravelMenu: document.getElementById('fast-travel-menu'),
            inventoryMenu: document.getElementById('inventory-menu'),
            inventoryList: document.getElementById('inventory-list'),
            locationList: document.getElementById('location-list'),
            closeTravelBtn: document.getElementById('close-travel'),
            closeInventoryBtn: document.getElementById('close-inventory'),
            crosshair: document.getElementById('crosshair'),
            hitMarker: document.getElementById('hit-marker'),
            gameContainer: document.getElementById('game-container'),
            rainOverlay: document.getElementById('rain-overlay'),
            musicTrackName: document.getElementById('music-track-name'),
            musicToggleBtn: document.getElementById('music-toggle'),
            musicSkipBtn: document.getElementById('music-skip'),
            musicVolDownBtn: document.getElementById('music-vol-down'),
            musicVolUpBtn: document.getElementById('music-vol-up'),
            survivalScore: document.getElementById('survival-score'),
            survivalCombo: document.getElementById('survival-combo'),
            gunUpgradeInfo: document.getElementById('gun-upgrade-info'),
            gunUpgradeBtn: document.getElementById('gun-upgrade-btn'),
            tutorialTicker: document.getElementById('tutorial-ticker'),
        };

        // NEW: simple text-based tutorial messages for the bottom ticker
        this.tutorialMessages = [
            'WASD / LEFT STICK: MOVE • MOUSE / DRAG RIGHT: LOOK & AIM',
            'CLICK / FIRE BUTTON: SHOOT • SPACE / JUMP BUTTON: JUMP',
            'E / USE: FAST TRAVEL & INTERACT WITH PORTALS',
            'M: FAST TRAVEL MENU • I: INVENTORY • G: START SURVIVAL WAVES',
            'STAY FED & RESTED – LOW HUNGER MAKES DAMAGE MUCH WORSE',
            'BOSS WAVES PAY BIG MONEY FOR GUN UPGRADES AT TERMINALS'
        ];
        this.tickerMessages = [];
        this.currentTickerText = '';

        // Expose core systems for debug tools and external integrations
        window.uls = {
            game: this,
            get stats() { return this.game.stats; },
            get wantedSystem() { return { level: this.game.stats.wantedLevel }; },
            get currentLocation() { return this.game.currentLocation; },
            get timeOfDay() { return this.game.time; },
            get weather() { return this.game.weather; }
        };

        // NEW: power-up / movement modifiers
        this.baseMoveSpeed = 5;
        this.activeModifiers = this.activeModifiers || {};
        this.activeModifiers.speedBoostTime = 0; // seconds of temporary speed boost

        // NEW: simple background music player state
        this.music = {
            audio: null,
            tracks: [
                // Replace these paths with your seven uploaded song filenames
                'Chroma Killer - industrial beat machine.mp3',
                'Chroma Killer - neon dream pulse.mp3',
                'Chroma Killer - clockwork percussion.mp3',
                'Chroma Killer - broken jingle.mp3',
                'Chroma Killer - surreal jazz drift.mp3',
                'Chroma Killer - ritual.mp3',
                'Chroma killer-pixel panic .mp3'
            ],
            titles: [
                'Industrial Beat Machine',
                'Neon Dream Pulse',
                'Clockwork Percussion',
                'Broken Jingle',
                'Surreal Jazz Drift',
                'Ritual',
                'Pixel Panic'
            ],
            currentIndex: 0,
            isPlaying: false,
            volume: 0.7
        };

        // NEW: base damage per bullet and multiplier by level
        this.gunBaseDamage = 40;
        this.gunDamageMultiplier = 1.0;

        // NEW: road / sidewalk / street light collections
        this.roads = [];
        this.sidewalks = [];
        this.streetLights = [];
        // NEW: separate list of window meshes so only they glow at night
        this.buildingWindows = [];
        // NEW: meshes that can block bullets (environment colliders)
        this.environmentColliders = [];

        // NEW: GLTF loader and model references
        this.gltfLoader = new GLTFLoader();
        this.models = {
            boss: null,
            billboard: null,
            parking: null,
            skyEye: null
        };
        
        // Sky eye spotlight tracking
        this.enemySpotlights = [];
        this.skyEyePosition = new THREE.Vector3(0, 80, -80);

        this.init();
    }

    applyScreenDistortion(duration) {
        const effect = document.getElementById('screen-distortion-effect');
        effect.style.display = 'block';
        setTimeout(() => {
            effect.style.display = 'none';
        }, duration * 1000);
    }

    // NEW: simple background music player wiring for the music UI
    setupMusicPlayer() {
        const ui = this.ui;
        const music = this.music;

        if (!music.tracks || music.tracks.length === 0) {
            return;
        }

        if (!music.audio) {
            music.audio = new Audio();
            music.audio.loop = false;
            music.audio.volume = music.volume;
            music.audio.addEventListener('ended', () => {
                // Auto-skip to next track when one finishes
                music.currentIndex = (music.currentIndex + 1) % music.tracks.length;
                this.updateMusicUI();
                this.playCurrentMusicTrack();
            });
        }

        const bindOnce = (btn, handler) => {
            if (!btn) return;
            // Avoid rebinding if setupSystems runs again
            if (btn.dataset.bound === 'true') return;
            btn.dataset.bound = 'true';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                handler();
            });
        };

        bindOnce(ui.musicToggleBtn, () => {
            if (!music.audio) return;
            if (music.isPlaying) {
                music.audio.pause();
                music.isPlaying = false;
            } else {
                this.playCurrentMusicTrack();
                music.isPlaying = true;
            }
            this.updateMusicUI();
        });

        bindOnce(ui.musicSkipBtn, () => {
            music.currentIndex = (music.currentIndex + 1) % music.tracks.length;
            this.playCurrentMusicTrack();
            music.isPlaying = true;
            this.updateMusicUI();
        });

        bindOnce(ui.musicVolUpBtn, () => {
            music.volume = Math.min(1, music.volume + 0.1);
            if (music.audio) music.audio.volume = music.volume;
        });

        bindOnce(ui.musicVolDownBtn, () => {
            music.volume = Math.max(0, music.volume - 0.1);
            if (music.audio) music.audio.volume = music.volume;
        });

        // Initial UI state
        this.updateMusicUI();
    }

    // Helper: play the currently selected music track
    playCurrentMusicTrack() {
        const music = this.music;
        if (!music.audio || !music.tracks || music.tracks.length === 0) return;

        const src = music.tracks[music.currentIndex];
        // If the same src is already set, just play; otherwise switch then play
        if (music.audio.src !== src && !music.audio.src.endsWith('/' + src)) {
            music.audio.src = src;
        }
        music.audio.volume = music.volume;
        music.audio.play().catch((err) => {
            console.warn('Music play blocked or failed:', err);
        });
        music.isPlaying = true;
        this.updateMusicUI();
    }

    // Helper: refresh the small music HUD text
    updateMusicUI() {
        if (!this.ui.musicTrackName) return;
        const idx = this.music.currentIndex;
        const title = this.music.titles && this.music.titles[idx]
            ? this.music.titles[idx]
            : (this.music.tracks[idx] || '--');
        this.ui.musicTrackName.textContent = this.music.isPlaying ? title : `Paused: ${title}`;
    }

    async init() {
        this.updateLoadingProgress(10, 'Initializing 3D engine...');
        this.textureLoader = new THREE.TextureLoader();
        await this.initThreeJS();
        this.createWeapon();

        this.updateLoadingProgress(20, 'Loading audio assets...');
        await this.loadSounds();

        // NEW: load GLB models (boss, billboard, parking lot, sky eye)
        this.updateLoadingProgress(30, 'Loading world models...');
        await this.loadModels();

        this.updateLoadingProgress(40, 'Building city...');
        await this.createWorld();
        this.spawnItems();

        this.updateLoadingProgress(60, 'Setting up controls...');
        await this.setupControls();

        this.updateLoadingProgress(80, 'Initializing systems...');
        await this.setupSystems();

        // Initialize the on-gun tutorial timer so the small billboard starts cycling immediately
        this.gunTutorialEndTime = this.clock.getElapsedTime() + this.gunTutorialDuration;
        this.gunTutorialLastMessageIndex = 0;

        this.updateLoadingProgress(90, 'Loading save data...');
        this.loadGame();

        this.updateLoadingProgress(100, 'Ready!');

        setTimeout(() => {
            // use cached loading screen reference
            if (this.ui.loadingScreen) {
                this.ui.loadingScreen.style.display = 'none';
            }
            this.start();
        }, 500);
    }

    updateLoadingProgress(percent, text) {
        // use cached UI elements where possible
        if (this.ui.loadingProgress) {
            this.ui.loadingProgress.style.width = percent + '%';
        }
        if (this.ui.loadingText) {
            this.ui.loadingText.textContent = text;
        }
    }

    async loadSounds() {
        const soundFiles = {
            use_item: 'use_item.mp3',
            gunshot: 'gunshot.mp3',
            enemy_gunshot: 'gunshot.mp3', // Re-use for now, can be changed later
            // NOTE: hit_impact now uses a procedural sound instead of this file.
            hit_impact: 'hit_impact.mp3',
            player_hit: 'player_hit.mp3'
        };

        for (const [name, path] of Object.entries(soundFiles)) {
            try {
                const buffer = await this.loadSound(path);
                this.sounds.set(name, buffer);
            } catch (error) {
                console.error(`Could not load sound ${name}:`, error);
            }
        }
    }

    async initThreeJS() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x10101a); // Darker night-friendly base color
        this.scene.fog = new THREE.Fog(0x10101a, 50, 200);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.copy(this.playerPosition);
        this.camera.rotation.order = 'YXZ'; // To prevent gimbal lock issues

        // Renderer
        const canvas = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        // Slightly cap resolution for performance while keeping visuals sharp
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
        this.renderer.shadowMap.enabled = true;

        // Lighting
        this.setupLighting();

        // Load enemy textures (7 unique sprites)
        const texturePromises = this.enemyAssets.map(path => 
            new Promise(resolve => {
                this.textureLoader.load(path, (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
                    texture.needsUpdate = true;
                    this.enemyTextures.push(texture);
                    resolve(texture);
                }, undefined, (err) => {
                    console.error('Error loading enemy texture:', path, err);
                    resolve(null); // Resolve with null on error
                });
            })
        );

        // NEW: load power-up textures (water bottle, energy drink, food can)
        const powerupTexturePromises = [
            new Promise(resolve => {
                this.textureLoader.load('water_bottle.png', (tex) => {
                    tex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
                    tex.needsUpdate = true;
                    this.powerupTextures.health = tex;
                    resolve(tex);
                }, undefined, (err) => {
                    console.error('Error loading water_bottle.png', err);
                    resolve(null);
                });
            }),
            new Promise(resolve => {
                this.textureLoader.load('energy_drink.png', (tex) => {
                    tex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
                    tex.needsUpdate = true;
                    this.powerupTextures.energy = tex;
                    resolve(tex);
                }, undefined, (err) => {
                    console.error('Error loading energy_drink.png', err);
                    resolve(null);
                });
            }),
            new Promise(resolve => {
                this.textureLoader.load('food_can.png', (tex) => {
                    tex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
                    tex.needsUpdate = true;
                    this.powerupTextures.hunger = tex;
                    resolve(tex);
                }, undefined, (err) => {
                    console.error('Error loading food_can.png', err);
                    resolve(null);
                });
            })
        ];

        await Promise.all([...texturePromises, ...powerupTexturePromises]);

        // NEW: create layered sky domes with VHS glitch behind IMG_8481 overlay
        const skyGeometry = new THREE.SphereGeometry(400, 32, 32);
        // group so we can keep sky centered on the camera
        this.skyGroup = new THREE.Group();

        this.textureLoader.load('/vhs-glitch.gif', (vhsTexture) => {
            vhsTexture.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
            vhsTexture.needsUpdate = true;
            const backMaterial = new THREE.MeshBasicMaterial({
                map: vhsTexture,
                side: THREE.BackSide
            });
            const backSky = new THREE.Mesh(skyGeometry, backMaterial);
            this.skyGroup.add(backSky);
        }, undefined, (err) => {
            console.error('Error loading /vhs-glitch.gif', err);
        });

        this.textureLoader.load('/IMG_8481.png', (overlayTexture) => {
            overlayTexture.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
            overlayTexture.needsUpdate = true;
            const frontMaterial = new THREE.MeshBasicMaterial({
                map: overlayTexture,
                side: THREE.BackSide,
                transparent: true,
                opacity: 0.6
            });
            const frontSky = new THREE.Mesh(skyGeometry, frontMaterial);
            this.skyGroup.add(frontSky);
        }, undefined, (err) => {
            console.error('Error loading /IMG_8481.png', err);
        });

        // ensure the sky group exists and follows the camera
        this.skyGroup.position.copy(this.camera.position);
        this.scene.add(this.skyGroup);

        window.addEventListener('resize', () => this.onWindowResize());

        this.textureLoader.load('enemy_projectile.png', (texture) => {
            this.enemyProjectileMaterial = new THREE.SpriteMaterial({ map: texture, color: 0xff0000, transparent: true, blending: THREE.AdditiveBlending });
        });
    }

    // NEW: load GLB models for boss, billboard, parking lot, and sky eye
    async loadModels() {
        const loadGLB = (path) => {
            return new Promise((resolve, reject) => {
                this.gltfLoader.load(
                    path,
                    (gltf) => resolve(gltf.scene),
                    undefined,
                    (err) => {
                        console.error('Error loading GLB:', path, err);
                        resolve(null);
                    }
                );
            });
        };

        // Boss model (Ethereal_Visions) – used as Survival boss
        this.models.boss = await loadGLB('/Ethereal_Visions_0523094542_texture.glb');
        if (this.models.boss) {
            this.models.boss.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
        }

        // Billboard model (DreamOS Vision) – mounted to a tall building later
        this.models.billboard = await loadGLB('/DreamOS_Vision_0521095127_texture.glb');

        // Parking lot / environment model (model.glb)
        this.models.parking = await loadGLB('/model.glb');
        if (this.models.parking) {
            this.models.parking.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
        }

        // Sky eye model (Visionary OS) – sits in the skyGroup watching over the city
        this.models.skyEye = await loadGLB('/Visionary_OS_0521095101_texture.glb');
        if (this.models.skyEye && this.skyGroup) {
            const eye = this.models.skyEye;
            // Quadruple previous scale (was 4,4,4)
            eye.scale.set(16, 16, 16);
            eye.position.set(0, 80, -80); // high above and slightly in front
            eye.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = false;
                    child.receiveShadow = false;
                }
            });
            this.skyGroup.add(eye);
            
            // Store sky eye position for spotlight calculations
            this.skyEyePosition = new THREE.Vector3(0, 80, -80);
        }
    }

    onWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        if (this.camera) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }

        if (this.renderer) {
            this.renderer.setSize(width, height);
            // Keep the same performance‑friendly pixel ratio cap on resize
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
        }
    }

    createWeapon() {
        this.weapon = new THREE.Group();
        const mainBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 0.1, 0.6),
            new THREE.MeshStandardMaterial({ color: 0x222222 })
        );
        mainBody.position.z = -0.2;
        this.weapon.add(mainBody);

        const handle = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.2, 0.1),
            new THREE.MeshStandardMaterial({ color: 0x111111 })
        );
        handle.position.y = -0.1;
        handle.rotation.x = 0.2;
        this.weapon.add(handle);

        // Tutorial billboard on the gun has been removed in favor of a HUD ticker.

        // Muzzle flash
        this.muzzleFlash = new THREE.PointLight(0xffcc00, 0, 10, 2);
        this.muzzleFlash.position.set(0, 0, -0.6);
        this.weapon.add(this.muzzleFlash);

        this.weapon.position.set(0.2, -0.2, -0.5);
        this.camera.add(this.weapon);
        this.scene.add(this.camera);
    }

    setupLighting() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0x404040, 1.5); // Slightly brighter ambient
        this.ambientLight = ambient;
        this.scene.add(ambient);

        // Sun (directional light)
        this.sunLight = new THREE.DirectionalLight(0xffffcc, 1);
        this.sunLight.castShadow = true;
        // Reduced shadow resolution for better performance
        this.sunLight.shadow.mapSize.width = 1024;
        this.sunLight.shadow.mapSize.height = 1024;
        this.scene.add(this.sunLight);

        // Add a moon light
        this.moonLight = new THREE.DirectionalLight(0x406080, 0.2);
        this.scene.add(this.moonLight);

        this.updateDayNightCycle();
    }

    updateDayNightCycle() {
        const hour = Math.floor(this.time / 60);
        const minute = this.time % 60;

        // Calculate sun position (simplified)
        const dayProgress = this.time / 1440; // 0 to 1
        const sunAngle = (dayProgress - 0.25) * Math.PI * 2;
        const moonAngle = sunAngle + Math.PI;

        this.sunLight.position.set(
            Math.cos(sunAngle) * 100,
            Math.sin(sunAngle) * 100,
            50
        );
        this.moonLight.position.set(
            Math.cos(moonAngle) * 100,
            Math.sin(moonAngle) * 100,
            50
        );

        // Adjust sky color and fog
        let skyColor, fogColor, sunIntensity, moonIntensity, ambientIntensity;

        if (hour >= 6 && hour < 18) { // Day
            skyColor = new THREE.Color(0x87CEEB);
            fogColor = new THREE.Color(0x87CEEB);
            sunIntensity = 1;
            moonIntensity = 0;
            ambientIntensity = 1.5;
        } else if (hour >= 18 && hour < 20) { // Sunset
            const t = (this.time - 18 * 60) / (2 * 60);
            skyColor = new THREE.Color(0x87CEEB).lerp(new THREE.Color(0xFF6B35), t);
            fogColor = skyColor;
            sunIntensity = 1 - t;
            moonIntensity = t * 0.2;
            ambientIntensity = 1.5 - t;
        } else if (hour >= 20 || hour < 4) { // Night
            skyColor = new THREE.Color(0x000428);
            fogColor = new THREE.Color(0x000428);
            sunIntensity = 0;
            moonIntensity = 0.2;
            ambientIntensity = 0.5;
        } else { // Sunrise
            const t = (this.time - 4 * 60) / (2 * 60);
            skyColor = new THREE.Color(0x000428).lerp(new THREE.Color(0x87CEEB), t);
            fogColor = skyColor;
            sunIntensity = t;
            moonIntensity = 0.2 - (t * 0.2);
            ambientIntensity = 0.5 + t;
        }

        // Weather modifier: thunderstorms darken the scene a bit more
        if (this.weather === 'storm') {
            sunIntensity *= 0.45;
            ambientIntensity *= 0.7;
            if (this.scene && this.scene.fog) {
                this.scene.fog.near = 35;
                this.scene.fog.far = 140;
            }
        } else if (this.scene && this.scene.fog) {
            // Reset fog distance for clear weather
            this.scene.fog.near = 50;
            this.scene.fog.far = 200;
        }

        // Keep fog and lighting changes, but don't fight the custom sky textures
        this.scene.fog.color.lerp(fogColor, 0.1);
        this.sunLight.intensity = sunIntensity;
        this.moonLight.intensity = moonIntensity;
        if (this.ambientLight) {
            this.ambientLight.intensity = ambientIntensity;
        }

        // NEW: make only building "windows" glow at night
        let nightFactor = 0;
        if (hour >= 20 || hour < 4) {
            // Full night
            nightFactor = 1;
        } else if (hour >= 18 && hour < 20) {
            // Fade in from sunset to night
            nightFactor = (this.time - 18 * 60) / (2 * 60);
        } else if (hour >= 4 && hour < 6) {
            // Fade out from night to sunrise
            nightFactor = 1 - (this.time - 4 * 60) / (2 * 60);
        }

        // ONLY windows glow, not whole building meshes
        if (this.buildingWindows && this.buildingWindows.length) {
            const intensity = 1.4 * Math.max(0, Math.min(1, nightFactor));
            this.buildingWindows.forEach(win => {
                if (win.material && 'emissiveIntensity' in win.material) {
                    win.material.emissiveIntensity = intensity;
                }
            });
        }

        // NEW: toggle streetlights based on night factor
        if (this.streetLights && this.streetLights.length) {
            const streetLightIntensity = 2.5 * Math.max(0, Math.min(1, nightFactor));
            this.streetLights.forEach(sl => {
                if (sl.light) {
                    sl.light.intensity = streetLightIntensity;
                }
                if (sl.bulbMesh && sl.bulbMesh.material && sl.bulbMesh.material.emissive) {
                    sl.bulbMesh.material.emissiveIntensity = 0.6 * Math.max(0, Math.min(1, nightFactor));
                }
            });
        }

        // Update UI using cached reference
        const displayHour = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
        const timeStr = `${displayHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
        if (this.ui.timeDisplay) {
            this.ui.timeDisplay.textContent = timeStr;
        }
    }

    // NEW: advance time-of-day and handle random thunderstorms
    updateTimeAndWeather(delta) {
        // Advance in-game clock
        this.time += delta * this.timeSpeed * 60; // convert seconds to "minutes"
        if (this.time >= 1440) this.time -= 1440;
        if (this.time < 0) this.time += 1440;

        this.updateDayNightCycle();

        // Weather timers
        if (this.weather === 'storm') {
            this.stormTimeLeft -= delta;
            this.lightningCooldown -= delta;

            if (this.lightningCooldown <= 0) {
                this.triggerLightning();
                this.lightningCooldown = 3 + Math.random() * 7; // random lightning within storm
            }

            if (this.stormTimeLeft <= 0) {
                this.endStorm();
            }
        } else {
            this.timeToNextStorm -= delta;
            if (this.timeToNextStorm <= 0) {
                // Small random chance each "window" to actually start a storm
                if (Math.random() < 0.6) {
                    this.startStorm();
                } else {
                    this.timeToNextStorm = 60 + Math.random() * 180;
                }
            }
        }
    }

    startStorm() {
        this.weather = 'storm';
        this.stormTimeLeft = 40 + Math.random() * 40; // storm lasts 40–80 seconds
        this.timeToNextStorm = 180 + Math.random() * 240; // 3–7 minutes until next window
        this.lightningCooldown = 2 + Math.random() * 4;

        if (this.ui.rainOverlay) {
            this.ui.rainOverlay.classList.add('active');
        }

        // Slightly intensify fog immediately
        if (this.scene && this.scene.fog) {
            this.scene.fog.near = 35;
            this.scene.fog.far = 140;
        }

        // Re-apply lighting with storm modifiers
        this.updateDayNightCycle();
    }

    endStorm() {
        this.weather = 'clear';
        if (this.ui.rainOverlay) {
            this.ui.rainOverlay.classList.remove('active');
        }
        // Reset fog distances; colors will be updated in updateDayNightCycle
        if (this.scene && this.scene.fog) {
            this.scene.fog.near = 50;
            this.scene.fog.far = 200;
        }
        this.updateDayNightCycle();
    }

    triggerLightning() {
        // Quick white flash over the screen
        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(255,255,255,0.8)';
        overlay.style.mixBlendMode = 'screen';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '76';
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.08s ease-out';

        const container = this.ui.gameContainer || document.body;
        container.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            setTimeout(() => {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 120);
            }, 50 + Math.random() * 80);
        });

        // Slight temporary boost to ambient light to simulate flash
        if (this.ambientLight) {
            const original = this.ambientLight.intensity;
            this.ambientLight.intensity = original * 1.8;
            setTimeout(() => {
                this.ambientLight.intensity = original;
            }, 150);
        }

        // Play low thunder rumble
        this.playThunder();
    }

    // NEW: procedural thunder sound using Web Audio
    playThunder() {
        try {
            const ctx = this.audioContext;
            if (!ctx) return;
            if (ctx.state === 'suspended') {
                ctx.resume();
            }

            const now = ctx.currentTime;
            const duration = 3 + Math.random() * 2;

            // Noise-based rumble
            const bufferSize = ctx.sampleRate * duration;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                const t = i / bufferSize;
                const envelope = Math.pow(1 - t, 2); // fade out
                data[i] = (Math.random() * 2 - 1) * envelope * 0.6;
            }

            const noise = ctx.createBufferSource();
            noise.buffer = buffer;

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 400;

            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.0, now);
            gain.gain.linearRampToValueAtTime(0.7, now + 0.3);
            gain.gain.linearRampToValueAtTime(0.0, now + duration);

            noise.connect(filter).connect(gain).connect(ctx.destination);
            noise.start(now);
            noise.stop(now + duration);
        } catch (e) {
            console.warn('Thunder sound generation failed:', e);
        }
    }

    async createWorld() {
        // Ground
        const groundGeometry = new THREE.PlaneGeometry(500, 500);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.8
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // NEW: simple road grid with sidewalks before placing buildings
        this.createRoadNetwork();

        // Create simple city blocks
        this.createCityBlocks();

        // Create location markers
        this.createLocationMarkers();

        // NEW: streetlights along main roads
        this.createStreetLights();

        // NEW: extra city props (cars, trees, small objects) to increase detail
        this.createCityProps();

        // NEW: add environment models (parking lot, billboard) now that roads/buildings exist
        this.addEnvironmentModels();
    }

    // NEW: place parking lot and billboard models into the existing environment
    addEnvironmentModels() {
        // Parking lot area: place near the main road intersection, slightly offset
        if (this.models.parking) {
            const parking = this.models.parking.clone(true);
            // Quadruple previous scale (was 6.0, 6.0, 6.0)
            parking.scale.set(24.0, 24.0, 24.0);
            parking.position.set(0, 0, -240); // outer edge of the map
            parking.rotation.y = Math.PI / 2; // orient roughly along the road
            this.scene.add(parking);
        }

        // Billboard: attach DreamOS Vision to the side of one of the taller buildings
        if (this.models.billboard && this.cityBlocks.length > 0) {
            // Choose the tallest building based on stored userData.height
            let tallest = this.cityBlocks[0];
            for (let i = 1; i < this.cityBlocks.length; i++) {
                const b = this.cityBlocks[i];
                if ((b.userData.height || 0) > (tallest.userData.height || 0)) {
                    tallest = b;
                }
            }

            const billboard = this.models.billboard.clone(true);
            const height = tallest.userData.height || 20;
            const depth = tallest.userData.depth || 10;

            // Make the billboard big enough to read but not massive
            billboard.scale.set(3.5, 3.5, 3.5);

            // Position it on one "east" side of the building (positive X / Z side)
            const offsetY = height * 0.6;
            const offsetZ = depth / 2 + 0.5;

            billboard.position.set(
                tallest.position.x,
                offsetY,
                tallest.position.z + offsetZ
            );
            // Aim it roughly toward the origin / road so it's visible
            billboard.lookAt(new THREE.Vector3(0, offsetY, 0));

            this.scene.add(billboard);
        }
    }

    // NEW: simple visual markers for fast travel locations
    createLocationMarkers() {
        if (!this.locations || !this.scene) return;

        // Store markers so we can extend behavior later if needed
        this.locationMarkers = this.locationMarkers || [];

        const markerMaterial = new THREE.MeshStandardMaterial({
            color: 0xff6600,
            emissive: new THREE.Color(0xff6600),
            emissiveIntensity: 1.2,
            roughness: 0.3
        });

        const markerGeo = new THREE.CylinderGeometry(0.5, 0.5, 2, 12);

        this.locations.forEach(loc => {
            const marker = new THREE.Mesh(markerGeo, markerMaterial.clone());
            marker.position.set(loc.position.x, 1, loc.position.z);
            marker.castShadow = true;
            marker.receiveShadow = true;

            // Small floating glow so it's easy to spot
            const glow = new THREE.PointLight(0xffaa66, 1, 10, 2);
            glow.position.set(loc.position.x, 2.5, loc.position.z);

            this.scene.add(marker);
            this.scene.add(glow);

            this.locationMarkers.push({ location: loc.name, marker, glow });
        });
    }

    spawnItems() {
        const itemTypes = [
            { name: 'Health Core', powerType: 'health', color: 0x00ff66 },
            { name: 'Energy Surge', powerType: 'energy', color: 0x66ccff },
            { name: 'Ration Cache', powerType: 'hunger', color: 0xffff66 },
        ];

        // FEWER power-ups: small count scattered around the map
        const totalPowerups = 6;

        for (let i = 0; i < totalPowerups; i++) {
            const itemData = itemTypes[i % itemTypes.length];

            // Try to use PNG icon as a billboarded plane
            const texture = this.powerupTextures[itemData.powerType];
            let orb;

            if (texture) {
                const geometry = new THREE.PlaneGeometry(1, 1);
                const material = new THREE.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    side: THREE.DoubleSide
                });
                orb = new THREE.Mesh(geometry, material);
            } else {
                // Fallback: simple glowing sphere if texture missing
                const geometry = new THREE.SphereGeometry(0.5, 16, 16);
                const material = new THREE.MeshStandardMaterial({
                    color: itemData.color,
                    emissive: itemData.color,
                    emissiveIntensity: 1.5,
                    transparent: true,
                    opacity: 0.9
                });
                orb = new THREE.Mesh(geometry, material);
            }

            orb.castShadow = true;

            orb.position.set(
                (Math.random() - 0.5) * 150,
                0.75,
                (Math.random() - 0.5) * 150
            );
            orb.userData = {
                isPowerup: true,
                powerType: itemData.powerType,
                name: itemData.name
            };

            this.scene.add(orb);
            this.itemObjects.push(orb);
        }
    }

    createCityBlocks() {
        const buildingBaseMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x666666,
            // UPDATED: neutral building; windows carry the glow
            emissive: new THREE.Color(0x000000),
            emissiveIntensity: 0
        });

        // NEW: subtle variation palette for building facades
        const facadeColors = [
            0x4a4a4a, // dark gray
            0x555555,
            0x606060,
            0x3c3c3c,
            0x707070
        ];

        // Balanced building count for density vs performance
        for (let i = 0; i < 80; i++) {
            const width = 5 + Math.random() * 10;
            const height = 10 + Math.random() * 40;
            const depth = 5 + Math.random() * 10;

            const geometry = new THREE.BoxGeometry(width, height, depth);
            const buildingMaterial = buildingBaseMaterial.clone();
            // NEW: per-building color variation
            buildingMaterial.color = new THREE.Color(
                facadeColors[Math.floor(Math.random() * facadeColors.length)]
            );
            const building = new THREE.Mesh(geometry, buildingMaterial);

            let x, z;
            do {
                x = (Math.random() - 0.5) * 260;
                z = (Math.random() - 0.5) * 260;
            } while (Math.sqrt(x * x + z * z) < 20); // Keep a 20 unit radius clear around origin

            building.position.set(
                x,
                height / 2,
                z
            );

            // NEW: store dimensions for later billboard placement
            building.userData.width = width;
            building.userData.height = height;
            building.userData.depth = depth;

            building.castShadow = true;
            building.receiveShadow = true;
            this.scene.add(building);
            this.cityBlocks.push(building);
            // NEW: treat buildings as solid cover for bullets
            this.environmentColliders.push(building);

            // NEW: occasional simple rooftop details (antenna / water tank)
            if (Math.random() < 0.35) {
                const roofY = building.position.y + height / 2;
                if (Math.random() < 0.5) {
                    // antenna
                    const antennaGeo = new THREE.CylinderGeometry(0.1, 0.1, 3, 6);
                    const antennaMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.5, roughness: 0.4 });
                    const antenna = new THREE.Mesh(antennaGeo, antennaMat);
                    antenna.position.set(
                        building.position.x + (Math.random() - 0.5) * (width * 0.4),
                        roofY + 1.5,
                        building.position.z + (Math.random() - 0.5) * (depth * 0.4)
                    );
                    antenna.castShadow = true;
                    this.scene.add(antenna);
                } else {
                    // small water tank
                    const tankGeo = new THREE.CylinderGeometry(1.0, 1.0, 2.2, 10);
                    const tankMat = new THREE.MeshStandardMaterial({ color: 0x3c3c3c, metalness: 0.2, roughness: 0.7 });
                    const tank = new THREE.Mesh(tankGeo, tankMat);
                    tank.position.set(
                        building.position.x + (Math.random() - 0.5) * (width * 0.3),
                        roofY + 1.1,
                        building.position.z + (Math.random() - 0.5) * (depth * 0.3)
                    );
                    tank.castShadow = true;
                    tank.receiveShadow = true;
                    this.scene.add(tank);
                }
            }

            // NEW: add emissive "window" strips on the facades
            const windowMaterial = new THREE.MeshStandardMaterial({
                color: 0xffe6b3,
                emissive: new THREE.Color(0xffc97a),
                emissiveIntensity: 0, // controlled by day/night cycle
                roughness: 0.4,
                metalness: 0.0
            });

            const windowWidth = width * 0.15;
            const windowHeight = height * 0.06;
            const windowDepthOffset = depth / 2 + 0.01;

            const rows = Math.max(2, Math.floor(height / 6));
            const cols = Math.max(2, Math.floor(width / 3));

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    // Randomly skip some windows so the pattern looks more organic
                    if (Math.random() < 0.3) continue;

                    const winGeo = new THREE.PlaneGeometry(windowWidth, windowHeight);
                    const winMatFront = windowMaterial.clone();
                    const winMatBack = windowMaterial.clone();
                    const winMeshFront = new THREE.Mesh(winGeo, winMatFront);
                    const winMeshBack = new THREE.Mesh(winGeo, winMatBack);

                    const xOffset = -width / 2 + (c + 0.5) * (width / cols);
                    const yOffset = -height / 2 + (r + 0.7) * (height / rows);

                    // Front face (positive Z)
                    winMeshFront.position.set(
                        building.position.x + xOffset,
                        building.position.y + yOffset,
                        building.position.z + windowDepthOffset
                    );
                    winMeshFront.lookAt(new THREE.Vector3(
                        building.position.x + xOffset,
                        building.position.y + yOffset,
                        building.position.z + windowDepthOffset + 1
                    ));
                    this.scene.add(winMeshFront);
                    this.buildingWindows.push(winMeshFront);

                    // Back face (negative Z)
                    winMeshBack.position.set(
                        building.position.x + xOffset,
                        building.position.y + yOffset,
                        building.position.z - windowDepthOffset
                    );
                    winMeshBack.lookAt(new THREE.Vector3(
                        building.position.x + xOffset,
                        building.position.y + yOffset,
                        building.position.z - windowDepthOffset - 1
                    ));
                    this.scene.add(winMeshBack);
                    this.buildingWindows.push(winMeshBack);
                }
            }
        }
    }
    
    // NEW: helper to test if a projectile is blocked by environment (buildings)
    isProjectileBlocked(position) {
        if (!this.environmentColliders || this.environmentColliders.length === 0) return false;
        // Small safety margin so bullets hit just before visually clipping through
        const margin = 0.1;
        const box = new THREE.Box3();
        for (let i = 0; i < this.environmentColliders.length; i++) {
            const mesh = this.environmentColliders[i];
            if (!mesh) continue;
            // Cache bounding boxes on the mesh to avoid recomputing geometry bounds every frame
            if (!mesh.userData.boundingBox) {
                mesh.userData.boundingBox = new THREE.Box3().setFromObject(mesh);
            }
            box.copy(mesh.userData.boundingBox).expandByScalar(margin);
            if (box.containsPoint(position)) {
                return true;
            }
        }
        return false;
    }

    // NEW: create a simple plus-shaped road grid with sidewalks
    createRoadNetwork() {
        const roadMaterial = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.9,
            metalness: 0.1
        });

        const sidewalkMaterial = new THREE.MeshStandardMaterial({
            color: 0x4a4a4a,
            roughness: 0.8
        });

        const roadWidth = 10;
        const sidewalkWidth = 3;
        const roadLength = 400;
        const roadHeight = 0.02;
        const sidewalkHeight = 0.05;

        // Main horizontal road (east-west)
        const hRoadGeo = new THREE.BoxGeometry(roadLength, roadHeight, roadWidth);
        const hRoad = new THREE.Mesh(hRoadGeo, roadMaterial);
        hRoad.position.set(0, roadHeight / 2, 0);
        hRoad.receiveShadow = true;
        this.scene.add(hRoad);
        this.roads.push(hRoad);

        // NEW: lane markings for horizontal road
        const hLaneMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });
        for (let i = -roadLength / 2; i < roadLength / 2; i += 12) {
            const segmentGeo = new THREE.BoxGeometry(4, 0.01, 0.2);
            const seg = new THREE.Mesh(segmentGeo, hLaneMat);
            seg.position.set(i + 2, roadHeight + 0.01, 0);
            this.scene.add(seg);
        }

        // Sidewalks for horizontal road (top & bottom)
        const hSidewalkGeo = new THREE.BoxGeometry(roadLength, sidewalkHeight, sidewalkWidth);
        const hSidewalkTop = new THREE.Mesh(hSidewalkGeo, sidewalkMaterial);
        hSidewalkTop.position.set(0, sidewalkHeight / 2, roadWidth / 2 + sidewalkWidth / 2);
        hSidewalkTop.receiveShadow = true;
        this.scene.add(hSidewalkTop);
        this.sidewalks.push(hSidewalkTop);

        const hSidewalkBottom = new THREE.Mesh(hSidewalkGeo, sidewalkMaterial);
        hSidewalkBottom.position.set(0, sidewalkHeight / 2, -roadWidth / 2 - sidewalkWidth / 2);
        hSidewalkBottom.receiveShadow = true;
        this.scene.add(hSidewalkBottom);
        this.sidewalks.push(hSidewalkBottom);

        // Main vertical road (north-south)
        const vRoadGeo = new THREE.BoxGeometry(roadWidth, roadHeight, roadLength);
        const vRoad = new THREE.Mesh(vRoadGeo, roadMaterial);
        vRoad.position.set(0, roadHeight / 2, 0);
        vRoad.receiveShadow = true;
        this.scene.add(vRoad);
        this.roads.push(vRoad);

        // NEW: lane markings for vertical road
        const vLaneMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });
        for (let i = -roadLength / 2; i < roadLength / 2; i += 12) {
            const segmentGeo = new THREE.BoxGeometry(0.2, 0.01, 4);
            const seg = new THREE.Mesh(segmentGeo, vLaneMat);
            seg.position.set(0, roadHeight + 0.01, i + 2);
            this.scene.add(seg);
        }

        // Sidewalks for vertical road (left & right)
        const vSidewalkGeo = new THREE.BoxGeometry(sidewalkWidth, sidewalkHeight, roadLength);
        const vSidewalkLeft = new THREE.Mesh(vSidewalkGeo, sidewalkMaterial);
        vSidewalkLeft.position.set(roadWidth / 2 + sidewalkWidth / 2, sidewalkHeight / 2, 0);
        vSidewalkLeft.receiveShadow = true;
        this.scene.add(vSidewalkLeft);
        this.sidewalks.push(vSidewalkLeft);

        const vSidewalkRight = new THREE.Mesh(vSidewalkGeo, sidewalkMaterial);
        vSidewalkRight.position.set(-roadWidth / 2 - sidewalkWidth / 2, sidewalkHeight / 2, 0);
        vSidewalkRight.receiveShadow = true;
        this.scene.add(vSidewalkRight);
        this.sidewalks.push(vSidewalkRight);
    }

    // NEW: extra props to make streets feel more alive (cars, trees, small clutter)
    createCityProps() {
        if (!this.roads || this.roads.length === 0) return;

        const carColors = [0xff3333, 0x3399ff, 0xffcc00, 0xffffff, 0x00aa66];

        const makeCar = (x, z, heading) => {
            const bodyGeo = new THREE.BoxGeometry(3.6, 1.0, 1.6);
            const bodyMat = new THREE.MeshStandardMaterial({
                color: carColors[Math.floor(Math.random() * carColors.length)],
                metalness: 0.4,
                roughness: 0.5
            });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.set(x, 0.5, z);
            body.rotation.y = heading;
            body.castShadow = true;
            body.receiveShadow = true;

            const roofGeo = new THREE.BoxGeometry(2.0, 0.6, 1.4);
            const roofMat = new THREE.MeshStandardMaterial({
                color: 0x101010,
                metalness: 0.3,
                roughness: 0.7
            });
            const roof = new THREE.Mesh(roofGeo, roofMat);
            roof.position.set(0, 0.8, 0);
            body.add(roof);

            this.scene.add(body);
        };

        const makeTree = (x, z) => {
            const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 2.0, 6);
            const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3621, roughness: 0.9 });
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.set(x, 1.0, z);
            trunk.castShadow = true;
            trunk.receiveShadow = true;

            const foliageGeo = new THREE.SphereGeometry(1.2, 10, 10);
            const foliageMat = new THREE.MeshStandardMaterial({
                color: 0x274e13,
                roughness: 0.8
            });
            const foliage = new THREE.Mesh(foliageGeo, foliageMat);
            foliage.position.set(0, 1.3, 0);
            foliage.castShadow = true;
            foliage.receiveShadow = true;
            trunk.add(foliage);

            this.scene.add(trunk);
        };

        // Parked cars along main roads
        for (let i = -160; i <= 160; i += 35) {
            // Along horizontal road, both sides
            if (Math.random() < 0.85) {
                makeCar(i + (Math.random() - 0.5) * 4, 4.5, Math.PI / 2);
            }
            if (Math.random() < 0.5) {
                makeCar(i + (Math.random() - 0.5) * 4, -4.5, Math.PI / 2);
            }
            // Along vertical road, both sides
            if (Math.random() < 0.65) {
                makeCar(4.5, i + (Math.random() - 0.5) * 4, 0);
            }
            if (Math.random() < 0.45) {
                makeCar(-4.5, i + (Math.random() - 0.5) * 4, 0);
            }
        }

        // Trees near sidewalks and open spaces
        for (let i = -140; i <= 140; i += 28) {
            if (Math.random() < 0.9) {
                makeTree(i + (Math.random() - 0.5) * 6, 15 + (Math.random() - 0.5) * 6);
            }
            if (Math.random() < 0.9) {
                makeTree(i + (Math.random() - 0.5) * 6, -15 + (Math.random() - 0.5) * 6);
            }
        }

        for (let i = -140; i <= 140; i += 28) {
            if (Math.random() < 0.8) {
                makeTree(15 + (Math.random() - 0.5) * 6, i + (Math.random() - 0.5) * 6);
            }
            if (Math.random() < 0.9) {
                makeTree(-15 + (Math.random() - 0.5) * 6, i + (Math.random() - 0.5) * 6);
            }
        }
    }

    // NEW: place simple streetlights along the sidewalks near the central intersection
    createStreetLights() {
        const poleMaterial = new THREE.MeshStandardMaterial({
            color: 0xdddddd,
            metalness: 0.6,
            roughness: 0.4
        });

        const bulbMaterial = new THREE.MeshStandardMaterial({
            color: 0xffeeaa,
            emissive: new THREE.Color(0xffdd88),
            emissiveIntensity: 0, // controlled by day/night cycle
            roughness: 0.3
        });

        const poleHeight = 6;
        const positions = [
            new THREE.Vector3(12, 0, 12),
            new THREE.Vector3(-12, 0, 12),
            new THREE.Vector3(12, 0, -12),
            new THREE.Vector3(-12, 0, -12),
            new THREE.Vector3(0, 0, 25),
            new THREE.Vector3(0, 0, -25),
        ];

        positions.forEach(pos => {
            // Pole
            const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, poleHeight, 8);
            const pole = new THREE.Mesh(poleGeo, poleMaterial);
            pole.position.set(pos.x, poleHeight / 2, pos.z);
            pole.castShadow = true;
            this.scene.add(pole);

            // Bulb
            const bulbGeo = new THREE.SphereGeometry(0.4, 12, 12);
            const bulb = new THREE.Mesh(bulbGeo, bulbMaterial.clone());
            bulb.position.set(pos.x, poleHeight + 0.4, pos.z);
            bulb.castShadow = false;
            this.scene.add(bulb);

            // Light
            const light = new THREE.PointLight(0xfff2cc, 0, 18, 2.0); // intensity set in updateDayNightCycle
            light.position.set(pos.x, poleHeight + 0.5, pos.z);
            light.castShadow = true;
            this.scene.add(light);

            this.streetLights.push({
                poleMesh: pole,
                bulbMesh: bulb,
                light
            });
        });

        // Make sure initial intensities match current time of day
        this.updateDayNightCycle();
    }

    async setupControls() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent);

        if (isMobile) {
            this.setupMobileControls();
        } else {
            this.setupDesktopControls();
        }

        const setupActionButton = (id, action) => {
            const button = document.getElementById(id);
            if (button) {
                const handler = (e) => {
                    e.preventDefault(); // Prevents double-firing on touch devices
                    action();
                };
                button.addEventListener('click', handler);
                button.addEventListener('touchstart', handler);
            }
        };

        // Interact button
        setupActionButton('interact-btn', () => this.checkInteraction());

        // Fire button for mobile
        setupActionButton('fire-btn', () => this.fireWeapon());

        // Jump button for mobile
        setupActionButton('jump-btn', () => this.jump());
    }

    setupDesktopControls() {
        // Mouse look
        document.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement === document.body) {
                this.cameraLook.x -= e.movementX * 0.002;
                this.cameraLook.y -= e.movementY * 0.002;
                this.cameraLook.y = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.cameraLook.y));
            }
        });

        // First click just locks the pointer; subsequent clicks fire
        document.body.addEventListener('click', () => {
            if (document.pointerLockElement !== document.body) {
                document.body.requestPointerLock();
                return;
            }
            this.fireWeapon();
        });

        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            switch (e.code) {
                case 'KeyW': this.moveState.forward = true; break;
                case 'KeyS': this.moveState.backward = true; break;
                case 'KeyA': this.moveState.left = true; break;
                case 'KeyD': this.moveState.right = true; break;
                case 'Space': this.jump(); break;
                case 'KeyE': this.checkInteraction(); break;
                case 'KeyM': this.toggleFastTravel(); break;
                case 'KeyI': this.toggleInventory(); break; // Inventory stub
                case 'KeyF': this.enterVehicle(); break; // Vehicle stub
                case 'KeyG': this.toggleSurvivalMode(); break; // Toggle Survival Mode
            }
        });

        document.addEventListener('keyup', (e) => {
            switch (e.code) {
                case 'KeyW': this.moveState.forward = false; break;
                case 'KeyS': this.moveState.backward = false; break;
                case 'KeyA': this.moveState.left = false; break;
                case 'KeyD': this.moveState.right = false; break;
            }
        });
    }

    setupMobileControls() {
        document.getElementById('mobile-controls').style.display = 'block';

        const manager = nipplejs.create({
            zone: document.getElementById('joystick-zone'),
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: '#ff6600',
            size: 150
        });

        manager.on('move', (evt, data) => {
            const force = Math.min(data.force, 1);
            const angle = data.angle.radian;
            this.joystickVector.x = Math.cos(angle) * force;
            this.joystickVector.y = Math.sin(angle) * force;
        });

        manager.on('end', () => {
            this.joystickVector.set(0, 0);
        });

        this.joystick = manager;

        // Touch look controls
        let touchLookStartX = 0;
        let touchLookStartY = 0;
        let touchLookId = null;

        document.body.addEventListener('touchstart', (e) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (touch.target.closest('#joystick-zone') || touch.target.closest('.action-buttons')) {
                    continue;
                }
                if (touchLookId === null) {
                    touchLookId = touch.identifier;
                    touchLookStartX = touch.clientX;
                    touchLookStartY = touch.clientY;
                }
            }
        }, { passive: false });

        document.body.addEventListener('touchmove', (e) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (touch.identifier === touchLookId) {
                    e.preventDefault();
                    const deltaX = touch.clientX - touchLookStartX;
                    const deltaY = touch.clientY - touchLookStartY;
                    touchLookStartX = touch.clientX;
                    touchLookStartY = touch.clientY;

                    this.cameraLook.x -= deltaX * 0.005;
                    this.cameraLook.y -= deltaY * 0.005;
                    this.cameraLook.y = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.cameraLook.y));
                }
            }
        }, { passive: false });

        document.body.addEventListener('touchend', (e) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                if (touch.identifier === touchLookId) {
                    touchLookId = null;
                }
            }
        });
    }

    async setupSystems() {
        // Living Hell Mode
        this.livingHellMode = new LivingHellMode(this);

        // Wave Manager for survival mode
        this.waveManager = new WaveManager(this);

        // Fast travel & Inventory
        this.setupMenus();

        // NEW: Music controls
        this.setupMusicPlayer();

        // Update stats UI
        this.updateStatsUI();

        // Hook Start Wave button to begin Survival Mode enemies
        const startWaveBtn = document.getElementById('start-wave-btn');
        if (startWaveBtn) {
            startWaveBtn.style.display = 'block'; // ensure visible on fresh load
            startWaveBtn.addEventListener('click', () => {
                if (this.waveManager) {
                    this.waveManager.activate();
                }
            });
        }

        // NEW: Gun upgrade button handler
        if (this.ui.gunUpgradeBtn) {
            this.ui.gunUpgradeBtn.addEventListener('click', () => {
                this.upgradeGun();
            });
        }
    }

    toggleSurvivalMode() {
        if (this.isSurvivalModeActive) {
            this.waveManager.deactivate();
        } else {
            this.waveManager.activate();
        }
    }

    setupMenus() {
        const locationList = this.ui.locationList;
        if (!locationList) return;

        this.locations.forEach(location => {
            const btn = document.createElement('button');
            btn.className = 'location-btn';
            btn.textContent = location.name;
            btn.addEventListener('click', () => {
                this.fastTravel(location);
            });
            locationList.appendChild(btn);
        });

        if (this.ui.closeTravelBtn) {
            this.ui.closeTravelBtn.addEventListener('click', () => {
                this.toggleFastTravel();
            });
        }

        if (this.ui.closeInventoryBtn) {
            this.ui.closeInventoryBtn.addEventListener('click', () => {
                this.toggleInventory();
            });
        }
    }

    toggleFastTravel() {
        const menu = this.ui.fastTravelMenu;
        if (!menu) return;
        menu.style.display = menu.style.display === 'none' || menu.style.display === '' ? 'block' : 'none';
    }

    fastTravel(location) {
        this.camera.position.copy(location.position);
        this.camera.position.y = 1.7;
        this.currentLocation = location.name;
        if (this.ui.locationDisplay) {
            this.ui.locationDisplay.textContent = location.name;
        }
        this.toggleFastTravel();
        this.checkLivingHellZone();
    }

    checkInteraction() {
        // Items are now auto-picked by walking through them, so we only handle location markers here.

        // Check if near a location marker
        const nearLocation = this.locations.find(loc => {
            return this.camera.position.distanceTo(loc.position) < 10;
        });

        if (nearLocation) {
            this.fastTravel(nearLocation);
        }
    }

    toggleInventory() {
        const menu = this.ui.inventoryMenu;
        if (!menu) return;
        const isVisible = menu.style.display === 'block';
        menu.style.display = isVisible ? 'none' : 'block';

        if (!isVisible) {
            this.updateInventoryUI();
        }
    }

    updateInventoryUI() {
        const inventoryList = this.ui.inventoryList;
        if (!inventoryList) return;
        inventoryList.innerHTML = '';

        this.inventory.forEach((count, itemName) => {
            if (count > 0) {
                const itemEl = document.createElement('div');
                itemEl.className = 'inventory-item';

                const imageName = itemName.toLowerCase().replace(' ', '_') + '.png';
                itemEl.style.backgroundImage = `url(${imageName})`;

                const countEl = document.createElement('span');
                countEl.className = 'item-count';
                countEl.textContent = count > 1 ? count : '';
                itemEl.appendChild(countEl);

                itemEl.addEventListener('click', () => this.useItem(itemName));
                inventoryList.appendChild(itemEl);
            }
        });
    }

    useItem(itemName) {
        if (!this.inventory.has(itemName) || this.inventory.get(itemName) === 0) return;

        let used = false;
        switch (itemName) {
            case 'Food Can':
                this.stats.hunger = Math.min(100, this.stats.hunger + 30);
                used = true;
                // NEW: visual feedback for hunger change
                this.showStatChange('hunger', +30);
                break;
            case 'Water Bottle':
                this.stats.health = Math.min(100, this.stats.health + 10);
                this.stats.hunger = Math.min(100, this.stats.hunger + 5);
                used = true;
                // NEW: visual feedback for health & hunger change
                this.showStatChange('health', +10);
                this.showStatChange('hunger', +5);
                break;
            case 'Energy Drink':
                this.stats.energy = Math.min(100, this.stats.energy + 40);
                used = true;
                // NEW: visual feedback for energy change
                this.showStatChange('energy', +40);
                break;
        }

        if (used) {
            this.playSound('use_item');
            const currentCount = this.inventory.get(itemName);
            this.inventory.set(itemName, currentCount - 1);
            if (this.inventory.get(itemName) <= 0) {
                this.inventory.delete(itemName);
            }
            this.updateInventoryUI();
            this.updateStatsUI();
        }
    }

    async loadSound(url) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            return await this.audioContext.decodeAudioData(arrayBuffer);
        } catch (error) {
            console.error(`Error loading sound: ${url}`, error);
            return null;
        }
    }

    // NEW: small floating indicator when a stat changes (health / hunger / energy)
    showStatChange(statKey, delta) {
        // Map statKey to its label element (for positioning); fallback to center if missing.
        let anchorEl = null;
        switch (statKey) {
            case 'health':
                anchorEl = this.ui.healthValue;
                break;
            case 'hunger':
                anchorEl = this.ui.hungerValue;
                break;
            case 'energy':
                anchorEl = this.ui.energyValue;
                break;
            default:
                anchorEl = this.ui.statusUI || document.getElementById('status-ui');
                break;
        }

        const text = (delta > 0 ? `+${Math.round(delta)}` : `${Math.round(delta)}`);
        const color = delta > 0 ? '#7CFF7C' : '#FF6B6B';

        const tag = document.createElement('div');
        tag.textContent = text;
        tag.style.position = 'absolute';
        tag.style.pointerEvents = 'none';
        tag.style.zIndex = '160';
        tag.style.fontFamily = "'VT323', monospace";
        tag.style.fontSize = '14px';
        tag.style.color = color;
        tag.style.textShadow = '0 0 6px rgba(0,0,0,0.9)';
        tag.style.opacity = '1';
        tag.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';

        const container = this.ui.gameContainer || document.body;
        container.appendChild(tag);

        const rect = anchorEl && anchorEl.getBoundingClientRect
            ? anchorEl.getBoundingClientRect()
            : { left: window.innerWidth * 0.15, top: window.innerHeight * 0.15, width: 0, height: 0 };

        tag.style.left = `${rect.left + rect.width / 2}px`;
        tag.style.top = `${rect.top - 4}px`;
        tag.style.transform = 'translate(-50%, 0)';

        requestAnimationFrame(() => {
            tag.style.opacity = '0';
            tag.style.transform = 'translate(-50%, -18px)';
        });

        setTimeout(() => {
            if (tag.parentNode) tag.parentNode.removeChild(tag);
        }, 550);
    }

    // UPDATED: sound playback uses per-sound settings, cooldowns, and pitch variation
    playSound(name) {
        if (!this.audioContext) return;

        // Custom procedural redesign for hit impact so it feels punchier
        if (name === 'hit_impact') {
            this.playImpactSound();
            return;
        }

        if (!this.sounds.has(name)) return;
        const buffer = this.sounds.get(name);
        if (!buffer) return;

        const cfg = this.soundConfig[name] || { volume: 1, pitchJitter: 0, minInterval: 0 };
        const now = this.audioContext.currentTime || 0;

        // Cooldown to prevent spam
        const last = this.soundLastPlayed[name] || 0;
        if (cfg.minInterval > 0 && now - last < cfg.minInterval) {
            return;
        }
        this.soundLastPlayed[name] = now;

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;

        // Subtle pitch variation
        if (cfg.pitchJitter && source.playbackRate) {
            const jitter = (Math.random() * 2 - 1) * cfg.pitchJitter;
            source.playbackRate.value = 1 + jitter;
        }

        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = cfg.volume;

        source.connect(gainNode).connect(this.audioContext.destination);
        source.start(0);
    }

    // NEW: Procedural impact sound design to replace the old sample
    playImpactSound() {
        try {
            const ctx = this.audioContext;
            if (!ctx) return;

            if (ctx.state === 'suspended') {
                ctx.resume();
            }

            const now = ctx.currentTime;
            const duration = 0.18;

            // Create short noise burst
            const bufferSize = ctx.sampleRate * duration;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                // Slightly curved noise for more "thwack" body
                const t = i / bufferSize;
                data[i] = (Math.random() * 2 - 1) * (1 - t * t);
            }

            const noise = ctx.createBufferSource();
            noise.buffer = buffer;

            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 1200;
            filter.Q.value = 1.4;

            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.0, now);
            gain.gain.linearRampToValueAtTime(1.0, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            noise.connect(filter).connect(gain).connect(ctx.destination);
            noise.start(now);
            noise.stop(now + duration);

            // Tiny low thump under the noise
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(110, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + duration);

            const thumpGain = ctx.createGain();
            thumpGain.gain.setValueAtTime(0.6, now);
            thumpGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            osc.connect(thumpGain).connect(ctx.destination);
            osc.start(now);
            osc.stop(now + duration);
        } catch (e) {
            console.warn('Fallback to old hit_impact sample due to error:', e);
            // Fallback: use old buffer if available
            const buffer = this.sounds.get('hit_impact');
            if (!buffer) return;
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 0.8;
            source.connect(gainNode).connect(this.audioContext.destination);
            source.start(0);
        }
    }

    // NEW: primary firing logic used by desktop and mobile controls
    fireWeapon() {
        if (!this.scene || !this.camera) return;

        // Play gunshot audio
        this.playSound('gunshot');

        // Crosshair fire feedback
        if (this.ui.crosshair) {
            this.ui.crosshair.classList.add('fire');
            setTimeout(() => {
                if (this.ui.crosshair) {
                    this.ui.crosshair.classList.remove('fire');
                }
            }, 80);
        }

        // Brief muzzle flash burst
        if (this.muzzleFlash) {
            this.muzzleFlash.intensity = 4;
            setTimeout(() => {
                if (this.muzzleFlash) {
                    this.muzzleFlash.intensity = 0;
                }
            }, 60);
        }

        // Apply simple recoil
        this.recoil.y += 0.06;
        this.recoil.z += 0.04;

        // Create a projectile starting at the camera
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        direction.normalize();

        const startPos = this.camera.position.clone();
        // Move a bit forward so it doesn't appear inside the camera
        startPos.addScaledVector(direction, 0.6);

        const geometry = new THREE.SphereGeometry(0.06, 8, 8);
        const material = new THREE.MeshBasicMaterial({ color: 0xffee99 });
        const projectile = new THREE.Mesh(geometry, material);
        projectile.position.copy(startPos);

        // Fast bullet speed; actual behavior handled in updateProjectiles()
        projectile.velocity = direction.multiplyScalar(60);
        projectile.userData.life = 3; // seconds until auto-despawn
        projectile.userData.damage = this.gunBaseDamage * this.gunDamageMultiplier;

        this.scene.add(projectile);
        this.projectiles.push(projectile);
    }

    enterVehicle() {
        if (!this.currentVehicle) {
            console.log("Entering vehicle (stub).");
            this.currentVehicle = { type: 'sedan', speed: 0 };
        } else {
            console.log("Exiting vehicle (stub).");
            this.currentVehicle = null;
        }
    }

    checkLivingHellZone() {
        const wasInZone = this.inLivingHellZone;
        this.inLivingHellZone = this.livingHellZones.includes(this.currentLocation);

        if (this.inLivingHellZone && !wasInZone) {
            this.livingHellMode.activate();
        } else if (!this.inLivingHellZone && wasInZone) {
            this.livingHellMode.deactivate();
        }
    }

    updateStatsUI() {
        // Health
        if (this.ui.healthBar) {
            this.ui.healthBar.style.width = this.stats.health + '%';
        }
        if (this.ui.healthValue) {
            this.ui.healthValue.textContent = Math.round(this.stats.health);
        }

        // Hunger
        if (this.ui.hungerBar) {
            this.ui.hungerBar.style.width = this.stats.hunger + '%';
        }
        if (this.ui.hungerValue) {
            this.ui.hungerValue.textContent = Math.round(this.stats.hunger);
        }

        // Energy
        if (this.ui.energyBar) {
            this.ui.energyBar.style.width = this.stats.energy + '%';
        }
        if (this.ui.energyValue) {
            this.ui.energyValue.textContent = Math.round(this.stats.energy);
        }

        // Money
        if (this.ui.moneyValue) {
            this.ui.moneyValue.textContent = '$' + this.stats.money;
        }

        // Wanted level is still tracked in stats, but no longer rendered in the top-left HUD.

        // NEW: Survival score & combo
        if (this.ui.survivalScore) {
            this.ui.survivalScore.textContent = `SCORE: ${Math.round(this.stats.score)}`;
        }
        if (this.ui.survivalCombo) {
            this.ui.survivalCombo.textContent = `COMBO: x${Math.max(1, Math.floor(this.stats.combo || 1))}`;
        }

        // NEW: Gun upgrade info line
        if (this.ui.gunUpgradeInfo) {
            const nextCost = this.getGunUpgradeCost();
            this.ui.gunUpgradeInfo.textContent = `GUN LVL ${this.stats.gunLevel} • UPGRADE: $${nextCost}`;
        }
    }

    // NEW: Encode the current weapon upgrade level into a simple, obfuscated progress code.
    // This should be called immediately on player death.
    generateProgressCode(currentUpgradeLevel) {
        try {
            // Clamp to a reasonable range to avoid silly values
            const level = Math.max(1, Math.min(99, Number(currentUpgradeLevel) || 1));

            // Add a simple version + level + random nonce to prevent obvious guessing
            const version = 1; // for future-proofing if format changes
            const nonce = Math.floor(Math.random() * 9000) + 1000; // 4-digit noise
            const payload = `${version}|${level}|${nonce}`;

            // Base64-encode, then apply a light substitution so the code isn't raw base64
            const base = btoa(payload);
            const scrambled = base
                .replace(/=/g, '_')
                .replace(/\+/g, '-')
                .replace(/\//g, '.');

            const code = `ULS-${scrambled}`;
            this.lastProgressCode = code;
            return code;
        } catch (e) {
            console.warn('Failed to generate progress code, falling back to default:', e);
            const fallback = 'ULS-ERROR';
            this.lastProgressCode = fallback;
            return fallback;
        }
    }

    // NEW: Decode a user-entered progress code back into an integer weapon level.
    // Returns the restored level on success, or null on failure.
    redeemProgressCode(inputCode) {
        if (!inputCode || typeof inputCode !== 'string') {
            return null;
        }

        try {
            const trimmed = inputCode.trim();

            // Basic format check
            if (!trimmed.startsWith('ULS-')) {
                return null;
            }

            const encodedPart = trimmed.slice(4);
            if (!encodedPart) {
                return null;
            }

            // Reverse the character substitutions and decode base64
            const base = encodedPart
                .replace(/_/g, '=')
                .replace(/-/g, '+')
                .replace(/\./g, '/');

            let decoded;
            try {
                decoded = atob(base);
            } catch {
                return null;
            }

            const parts = decoded.split('|');
            if (parts.length !== 3) {
                return null;
            }

            const version = parseInt(parts[0], 10);
            const level = parseInt(parts[1], 10);
            // const nonce = parseInt(parts[2], 10); // currently unused, just noise

            // Only support version 1 for now
            if (version !== 1 || !Number.isFinite(level)) {
                return null;
            }

            // Validate level range
            if (level < 1 || level > 99) {
                return null;
            }

            // Apply restoration: set weapon upgrade level and recompute damage multiplier
            this.stats.gunLevel = level;
            this.gunDamageMultiplier = 1 + (this.stats.gunLevel - 1) * 0.2;
            this.updateStatsUI();

            // OPTIONAL: if you have a GameManager or persistent storage layer,
            // you could also write this out here, e.g.:
            // localStorage.setItem('uls_savedGunLevel', String(level));

            return level;
        } catch (e) {
            console.warn('Failed to redeem progress code:', e);
            return null;
        }
    }

    // NEW: compute gun upgrade cost (scales per level)
    getGunUpgradeCost() {
        // Exponential cost: Cost_n = 250 * 2^(n-1)
        const n = this.stats.gunLevel + 1; // next level we are upgrading to
        return 250 * Math.pow(2, n - 1);
    }

    // NEW: helper to check if player is near any teleport portal (fast travel marker)
    isNearTeleportPortal(radius = 10) {
        if (!this.camera || !Array.isArray(this.locations)) return false;
        const pos = this.camera.position;
        for (const loc of this.locations) {
            if (loc.position && pos.distanceTo(loc.position) < radius) {
                return true;
            }
        }
        return false;
    }

    // NEW: apply a gun upgrade if the player can afford it
    upgradeGun() {
        const cost = this.getGunUpgradeCost();

        // Enforce: upgrades only allowed at teleport portals
        if (!this.isNearTeleportPortal()) {
            if (this.ui.gunUpgradeBtn) {
                this.ui.gunUpgradeBtn.classList.add('no-funds');
                setTimeout(() => {
                    if (this.ui.gunUpgradeBtn) {
                        this.ui.gunUpgradeBtn.classList.remove('no-funds');
                    }
                }, 150);
            }
            return;
        }

        if (this.stats.money < cost) {
            // Optional: tiny shake or color flash on button
            if (this.ui.gunUpgradeBtn) {
                this.ui.gunUpgradeBtn.classList.add('no-funds');
                setTimeout(() => this.ui.gunUpgradeBtn && this.ui.gunUpgradeBtn.classList.remove('no-funds'), 150);
            }
            return;
        }

        this.stats.money -= cost;
        this.stats.gunLevel += 1;

        // Each level adds 20% damage
        this.gunDamageMultiplier = 1 + (this.stats.gunLevel - 1) * 0.2;

        // Add ticker notification
        this.addTickerMessage(`GUN UPGRADED TO LEVEL ${this.stats.gunLevel}!`);

        // Refresh HUD to reflect new money and level
        this.updateStatsUI();
    }

    // NEW: spawn basic enemies for survival waves
    spawnEnemies(count, isBossWave = false) {
        if (!this.scene || !this.camera || this.enemyTextures.length === 0) return;

        // Hard cap to avoid runaway enemy counts on weak devices
        count = Math.min(count, 24);

        const basePosition = this.camera.position.clone();
        // Spawn enemies closer on early waves, then progressively farther out
        // so Wave 1 feels immediate and later waves come from the edges of the city.
        const currentWave = this.waveManager ? (this.waveManager.waveNumber || 1) : 1;
        const minRadius = 50;   // Wave 1 roughly one city block away
        const growthPerWave = 30;
        const maxRadius = 220;  // Do not push spawns endlessly far away
        const radius = Math.min(maxRadius, minRadius + (currentWave - 1) * growthPerWave);

        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const x = basePosition.x + Math.cos(angle) * radius;
            const z = basePosition.z + Math.sin(angle) * radius;

            const height = 2 + Math.random(); // a bit of variation
            
            // Cycle through available textures
            const textureIndex = i % this.enemyTextures.length;
            const enemyTexture = this.enemyTextures[textureIndex];

            let mesh;

            // NEW: use Ethereal_Visions GLB for boss waves if available
            const isBoss = isBossWave && i === 0;
            if (isBoss && this.models.boss) {
                mesh = this.models.boss.clone(true);
                // Place boss clearly floating above ground at the ring position
                mesh.position.set(x, 3, z); // CHANGED from y = 0 to y = 3 for floating effect
                // Reasonable scale to feel imposing compared to buildings
                mesh.scale.multiplyScalar(3.0);
                mesh.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
            } else {
                // UPDATED: use billboarded plane with loaded texture, removing lighting effects
                const material = new THREE.MeshBasicMaterial({
                    map: enemyTexture,
                    transparent: true,
                    side: THREE.DoubleSide,
                });

                const geometry = new THREE.PlaneGeometry(2, height); // Flat plane for billboard effect
                mesh = new THREE.Mesh(geometry, material);
                mesh.castShadow = true;
                mesh.position.set(x, height / 2, z);
            }

            // Progressive difficulty: health & damage scale with wave number,
            // but start low so early waves feel easy.
            const baseHealth = isBoss ? 140 : 30;              // easier starting health
            const healthPerWave = isBoss ? 40 : 8;             // how much extra each wave
            const enemyHealth = baseHealth + (currentWave - 1) * healthPerWave;

            const baseProjectileDamage = isBoss ? 8 : 4;       // softer early damage
            const damagePerWave = isBoss ? 1.5 : 1.0;
            const enemyProjectileDamage = baseProjectileDamage + (currentWave - 1) * damagePerWave;

            // Fire cooldown shortens with wave, clamped so they don't get absurd
            const baseCooldown = isBoss ? 2.5 : 3.5;
            const cooldownReduction = 0.15 * (currentWave - 1);
            const minCooldown = isBoss ? 1.2 : 1.8;
            const fireCooldown = Math.max(minCooldown, baseCooldown - cooldownReduction);

            const enemy = {
                mesh,
                // NEW: health starts easy and scales with wave number
                health: enemyHealth,
                isBoss,
                // NEW: simple shooting cooldown so enemies can damage the player
                lastShotTime: 0,
                // NEW: fire rate now also tightens gradually as waves increase
                fireCooldown: fireCooldown + Math.random() * 0.8,
                // NEW: damage per hit scales with wave
                projectileDamage: enemyProjectileDamage,
                // Updated: simplified damage handler since we no longer have hit textures
                takeDamage: (amount) => {
                    enemy.health -= amount;

                    // Brief visual feedback on hit (flashing material color)
                    if (enemy.health > 0 && enemy.mesh && enemy.mesh.material) {
                        const mat = enemy.mesh.material;
                        const originalColor = mat.color.clone();
                        mat.color.set(0xff0000); // Flash red

                        setTimeout(() => {
                            // Only restore if enemy still exists
                            if (!enemy.mesh || !enemy.mesh.material) return;
                            mat.color.copy(originalColor);
                        }, 100);
                    }

                    if (enemy.health <= 0) {
                        // Remove from scene and game enemy list
                        if (enemy.mesh && enemy.mesh.parent) {
                            enemy.mesh.parent.remove(enemy.mesh);
                        }
                        const idx = this.enemies.indexOf(enemy);
                        if (idx !== -1) this.enemies.splice(idx, 1);

                        // NEW: scoring and cash reward for kills
                        const scoreGain = enemy.isBoss ? 300 : 100;
                        const moneyGain = enemy.isBoss ? 75 : 25;
                        this.stats.score = (this.stats.score || 0) + scoreGain;
                        this.stats.money = (this.stats.money || 0) + moneyGain;
                        
                        // Add ticker notification for money earned
                        if (moneyGain > 0) {
                            const enemyType = enemy.isBoss ? 'BOSS' : 'ENEMY';
                            this.addTickerMessage(`${enemyType} ELIMINATED! +$${moneyGain}`);
                        }
                        
                        this.updateStatsUI();

                        // Notify wave manager so HUD updates and waves can progress
                        if (this.waveManager && typeof this.waveManager.onEnemyKilled === 'function') {
                            this.waveManager.onEnemyKilled();
                        }
                    }
                }
            };

            this.scene.add(mesh);
            this.enemies.push(enemy);
        }

        // Initial HUD sync (in case wave manager wasn't ready when called)
        if (this.waveManager && typeof this.waveManager.onEnemyKilled === 'function') {
            this.waveManager.onEnemyKilled();
        }
    }

    // NEW: basic enemy behaviour (they slowly face the player and drift towards them)
    updateEnemies(delta) {
        if (!this.enemies || this.enemies.length === 0) {
            // Clean up any remaining spotlights if no enemies
            this.cleanupEnemySpotlights();
            return;
        }
        if (!this.camera) return;

        const playerPos = this.camera.position;
        const now = this.clock ? this.clock.getElapsedTime() : performance.now() / 1000;

        // Update spotlights to match current enemy count
        this.updateEnemySpotlights();

        this.enemies.forEach((enemy, index) => {
            if (!enemy.mesh) return;

            // Billboard: always face the player so GIF is visible
            enemy.mesh.lookAt(playerPos);

            const toPlayer = this._tmpVec3_1;
            toPlayer.subVectors(playerPos, enemy.mesh.position);
            toPlayer.y = 0; // keep on ground plane for movement
            const distance = toPlayer.length();
            if (distance > 0.1) {
                toPlayer.normalize();
                const moveSpeed = 1.5; // slow walk
                enemy.mesh.position.addScaledVector(toPlayer, moveSpeed * delta);
            }

            // NEW: enemy shooting logic so they can damage the player
            // Slightly shorter effective range to ease pressure
            const shootRange = 32;
            if (distance < shootRange && now - enemy.lastShotTime >= enemy.fireCooldown) {
                enemy.lastShotTime = now;

                // Direction from enemy to player (include a bit of height so it aims at torso)
                const shootDir = this._tmpVec3_2;
                shootDir.copy(playerPos);
                shootDir.y += 0.5;
                shootDir.sub(enemy.mesh.position).normalize();

                // Use sprite material if loaded, fallback to simple sphere if not
                let projectile;
                if (this.enemyProjectileMaterial) {
                    projectile = new THREE.Sprite(this.enemyProjectileMaterial);
                    // Smaller enemy projectiles for better readability
                    projectile.scale.set(0.3, 0.3, 0.3);
                } else {
                    const geom = new THREE.SphereGeometry(0.1, 8, 8);
                    const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
                    projectile = new THREE.Mesh(geom, mat);
                }

                projectile.position.copy(enemy.mesh.position);
                projectile.position.y += 0.5; // slight vertical offset

                projectile.velocity = shootDir.multiplyScalar(15); // enemy bullet speed
                projectile.userData.life = 4; // seconds before auto-despawn
                // NEW: projectile damage now comes from progressive per-enemy setting
                projectile.userData.damage = enemy.projectileDamage || (enemy.isBoss ? 12 : 6);

                this.scene.add(projectile);
                this.enemyProjectiles.push(projectile);

                // Optional: play enemy gunshot sound if available
                this.playSound('enemy_gunshot');
            }
            
            // Update spotlight for this enemy
            if (this.enemySpotlights[index]) {
                const spotlight = this.enemySpotlights[index];
                const worldEyePos = this._tmpVec3_3;
                // Get world position of sky eye
                if (this.skyGroup && this.models.skyEye) {
                    this.models.skyEye.getWorldPosition(worldEyePos);
                } else {
                    worldEyePos.copy(this.skyEyePosition);
                }

                spotlight.position.copy(worldEyePos);
                spotlight.target.position.copy(enemy.mesh.position);
                spotlight.target.updateMatrixWorld();
            }
        });
    }
    
    updateEnemySpotlights() {
        const enemyCount = this.enemies.length;
        
        // Add spotlights if we have more enemies than spotlights
        while (this.enemySpotlights.length < enemyCount) {
            const spotlight = new THREE.SpotLight(0xff6600, 2, 100, Math.PI / 6, 0.3, 1);
            spotlight.castShadow = true;
            // Smaller shadow map for cheaper per-frame shadow updates
            spotlight.shadow.mapSize.width = 256;
            spotlight.shadow.mapSize.height = 256;
            this.scene.add(spotlight);
            this.scene.add(spotlight.target);
            this.enemySpotlights.push(spotlight);
        }
        
        // Remove excess spotlights if we have fewer enemies
        while (this.enemySpotlights.length > enemyCount) {
            const spotlight = this.enemySpotlights.pop();
            this.scene.remove(spotlight);
            this.scene.remove(spotlight.target);
        }
    }
    
    cleanupEnemySpotlights() {
        this.enemySpotlights.forEach(spotlight => {
            this.scene.remove(spotlight);
            this.scene.remove(spotlight.target);
        });
        this.enemySpotlights = [];
    }

    updateProjectiles(delta) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];

            // Gravity, affected by modifier
            if (!this.activeModifiers.noBulletDrop) {
                p.velocity.y -= 9.8 * delta;
            }
            p.position.addScaledVector(p.velocity, delta);

            p.userData.life -= delta;
            if (p.userData.life <= 0) {
                this.createImpactEffect(p.position);
                this.playSound('hit_impact');
                this.scene.remove(p);
                this.projectiles.splice(i, 1);
                continue;
            }

            // NEW: bullets are blocked by solid environment so the player can use cover
            if (this.isProjectileBlocked(p.position)) {
                this.createImpactEffect(p.position);
                this.playSound('hit_impact');
                this.scene.remove(p);
                this.projectiles.splice(i, 1);
                continue;
            }

            // Collision with enemies
            let hit = false;
            for (let j = this.enemies.length - 1; j >= 0; j--) {
                const enemy = this.enemies[j];
                // Increased hit radius so enemies are easier to tag, especially early on
                const hitRadius = 2.0;
                if (p.position.distanceToSquared(enemy.mesh.position) < hitRadius * hitRadius) {
                    const dmg = p.userData.damage || this.gunBaseDamage * this.gunDamageMultiplier;
                    enemy.takeDamage(dmg);
                    hit = true;
                    break;
                }
            }

            if (hit || p.position.y < 0) {
                this.createImpactEffect(p.position);
                this.playSound('hit_impact');
                this.scene.remove(p);
                this.projectiles.splice(i, 1);
            }
        }
    }

    updateEnemyProjectiles(delta) {
        for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
            const p = this.enemyProjectiles[i];
            p.position.addScaledVector(p.velocity, delta);

            p.userData.life -= delta;
            if (p.userData.life <= 0) {
                this.scene.remove(p);
                this.enemyProjectiles.splice(i, 1);
                continue;
            }

            // NEW: enemy shots are also blocked by buildings so the player can hide behind cover
            if (this.isProjectileBlocked(p.position)) {
                this.scene.remove(p);
                this.enemyProjectiles.splice(i, 1);
                continue;
            }

            // Collision with player
            const playerHitRadius = 1.0;
            if (p.position.distanceToSquared(this.camera.position) < playerHitRadius * playerHitRadius) {
                // Use the damage set in spawnEnemies; keep a safe low default
                this.playerTakeDamage(p.userData.damage || 6);
                this.scene.remove(p);
                this.enemyProjectiles.splice(i, 1);
                continue;
            }

            // Collision with world
            if (p.position.y < 0) {
                this.scene.remove(p);
                this.enemyProjectiles.splice(i, 1);
            }
        }
    }

    createImpactEffect(position) {
        // Show hit marker using cached element
        if (this.ui.hitMarker) {
            this.ui.hitMarker.classList.add('active');
            setTimeout(() => this.ui.hitMarker && this.ui.hitMarker.classList.remove('active'), 150);
        }

        // Crosshair hit flash (polish)
        if (this.ui.crosshair) {
            this.ui.crosshair.classList.add('hit');
            setTimeout(() => this.ui.crosshair && this.ui.crosshair.classList.remove('hit'), 100);
        }

        // Simple particle effect for impact (reuses shared geometry & material)
        const particleCount = 5;
        const particleGeometry = this._impactParticleGeometry;
        const particleMaterial = this._impactParticleMaterial;

        for (let i = 0; i < particleCount; i++) {
            const particle = new THREE.Mesh(particleGeometry, particleMaterial);
            particle.position.copy(position);

            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 5
            );

            this.scene.add(particle);

            // Animate particle
            let life = 0.3;
            const animateParticle = () => {
                if (life <= 0) {
                    this.scene.remove(particle);
                    return;
                }
                life -= 0.016;
                particle.position.addScaledVector(velocity, 0.016);
                requestAnimationFrame(animateParticle);
            };
            animateParticle();
        }
    }

    // NOTE: fireWeapon is defined once below; duplicate implementation removed to avoid confusion.

    playerTakeDamage(amount) {
        if (this.stats.health <= 0) return;

        // HUNGER penalty: take extra damage when very hungry
        if (this.stats.hunger < 20) {
            amount *= 1.5;
        }

        this.stats.health -= amount;
        this.stats.health = Math.max(0, this.stats.health);
        this.playSound('player_hit');
        this.updateStatsUI();

        // Trigger short camera rumble
        this.cameraShakeTime = 0.3;          // duration in seconds
        this.cameraShakeIntensity = 0.03;    // how strong the shake feels

        // Add a visual indicator (tiny screen flash)
        const damageOverlay = document.createElement('div');
        damageOverlay.style.position = 'absolute';
        damageOverlay.style.top = '0';
        damageOverlay.style.left = '0';
        damageOverlay.style.width = '100%';
        damageOverlay.style.height = '100%';
        damageOverlay.style.backgroundColor = 'rgba(255, 0, 0, 0.25)'; // slightly lighter flash
        damageOverlay.style.zIndex = '999';
        damageOverlay.style.pointerEvents = 'none';
        damageOverlay.style.transition = 'opacity 0.3s'; // faster fade

        const container = this.ui.gameContainer || document.body;
        container.appendChild(damageOverlay);

        requestAnimationFrame(() => {
            damageOverlay.style.opacity = '0';
        });

        setTimeout(() => {
            damageOverlay.remove();
        }, 300);

        if (this.stats.health <= 0) {
            this.gameOver();
        }
    }

    updateMovement(delta) {
        // BASE movement speed with modifiers
        let speed = this.baseMoveSpeed;

        // Speed boost from power-up
        if (this.activeModifiers.speedBoostTime > 0) {
            speed *= 1.6;
            this.activeModifiers.speedBoostTime = Math.max(
                0,
                this.activeModifiers.speedBoostTime - delta
            );
        }

        // HUNGER penalty: if hunger is very low, you move slower
        if (this.stats.hunger < 20) {
            speed *= 0.6;
        }

        const direction = new THREE.Vector3();

        if (this.joystick && this.joystickVector.length() > 0.1) {
            // Mobile controls
            direction.z = -this.joystickVector.y;
            direction.x = this.joystickVector.x;
        } else {
            // Desktop WASD
            if (this.moveState.forward) direction.z -= 1;
            if (this.moveState.backward) direction.z += 1;
            if (this.moveState.left) direction.x -= 1;
            if (this.moveState.right) direction.x += 1;
        }

        direction.normalize();

        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);
        cameraDirection.y = 0;
        cameraDirection.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0));

        const movement = new THREE.Vector3();
        movement.addScaledVector(cameraDirection, -direction.z);
        movement.addScaledVector(right, direction.x);

        this.camera.position.addScaledVector(movement, speed * delta);

        // Auto-pickup power-ups by walking through them
        this.checkPowerupPickup();

        // Apply jump physics
        if (this.isJumping) {
            this.camera.position.y += this.jumpVelocity * delta;
            this.jumpVelocity -= 20 * delta; // Gravity
            if (this.camera.position.y <= 1.7) {
                this.camera.position.y = 1.7;
                this.isJumping = false;
                this.canJump = true;
            }
        }

        // Update camera rotation from mouse/touch look and recoil
        this.recoil.y = Math.max(0, this.recoil.y - delta * 0.2); // Recoil recovery
        this.recoil.z = Math.max(0, this.recoil.z - delta * 0.4);

        this.camera.rotation.y = this.cameraLook.x;
        this.camera.rotation.x = this.cameraLook.y + this.recoil.y;

        // Apply camera shake (rumble) when the player is hit
        if (this.cameraShakeTime > 0) {
            const shakeProgress = this.cameraShakeTime / 0.3; // 0 -> 1 over shake duration
            const currentIntensity = this.cameraShakeIntensity * shakeProgress;
            const offsetX = (Math.random() - 0.5) * currentIntensity;
            const offsetY = (Math.random() - 0.5) * currentIntensity;

            this.camera.rotation.x += offsetY;
            this.camera.rotation.y += offsetX;
        }

        // Update weapon position with recoil
        if (this.weapon) {
            this.weapon.position.z = -0.5 - this.recoil.z;
        }

        // Keep camera at standing height if not jumping
        if (!this.isJumping) {
            this.camera.position.y = 1.7;
        }

        // Check location
        this.locations.forEach(loc => {
            if (this.camera.position.distanceTo(loc.position) < 15) {
                if (this.currentLocation !== loc.name) {
                    this.currentLocation = loc.name;
                    if (this.ui.locationDisplay) {
                        this.ui.locationDisplay.textContent = loc.name;
                    }
                    this.checkLivingHellZone();
                }
            }
        });
    }

    updateStats(delta) {
        // Passive stat decay - SLOWED so item effects are more noticeable
        this.stats.hunger -= delta * 0.15;  // was 0.5
        this.stats.energy -= delta * 0.1;   // was 0.3

        // Clamp values
        this.stats.hunger = Math.max(0, this.stats.hunger);
        this.stats.energy = Math.max(0, this.stats.energy);

        // Health decreases if hungry
        if (this.stats.hunger < 20) {
            this.stats.health -= delta * 0.2;
            this.stats.health = Math.max(0, this.stats.health);
        }

        if (this.stats.health <= 0) {
            this.gameOver();
        }

        this.updateStatsUI();
    }

    jump() {
        if (this.canJump) {
            this.canJump = false;
            this.isJumping = true;
            this.jumpVelocity = 8; // Initial jump velocity
        }
    }

    gameOver() {
        console.log("Game Over!");
        // Show game over screen
        const gameOverScreen = document.createElement('div');
        gameOverScreen.id = 'game-over-screen'; // NEW: easy cleanup on restart
        gameOverScreen.style.position = 'absolute';
        gameOverScreen.style.top = '50%';
        gameOverScreen.style.left = '50%';
        gameOverScreen.style.transform = 'translate(-50%, -50%)';
        gameOverScreen.style.width = '300px';
        gameOverScreen.style.height = '220px';
        gameOverScreen.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        gameOverScreen.style.color = 'white';
        gameOverScreen.style.display = 'flex';
        gameOverScreen.style.flexDirection = 'column';
        gameOverScreen.style.alignItems = 'center';
        gameOverScreen.style.justifyContent = 'center';
        gameOverScreen.style.fontSize = '24px';
        gameOverScreen.style.fontWeight = 'bold';
        gameOverScreen.style.borderRadius = '10px';
        gameOverScreen.style.zIndex = '1000';
        gameOverScreen.style.pointerEvents = 'auto';

        const gameOverText = document.createElement('div');
        gameOverText.textContent = 'Game Over';
        gameOverText.style.fontWeight = 'bold';
        gameOverScreen.appendChild(gameOverText);

        const scoreText = document.createElement('div');
        scoreText.textContent = `Score: ${this.stats.health}`;
        gameOverScreen.appendChild(scoreText);

        // NEW: generate and display the permanent progress code for weapon upgrade level
        const progressCode = this.generateProgressCode(this.stats.gunLevel || 1);
        const codeLabel = document.createElement('div');
        codeLabel.textContent = 'Your Progress Code:';
        codeLabel.style.fontSize = '14px';
        codeLabel.style.marginTop = '14px';
        codeLabel.style.marginBottom = '2px';
        gameOverScreen.appendChild(codeLabel);

        const codeValue = document.createElement('div');
        codeValue.textContent = progressCode;
        codeValue.style.fontSize = '14px';
        codeValue.style.fontFamily = "'VT323', monospace";
        codeValue.style.color = '#ffcc66';
        codeValue.style.letterSpacing = '1px';
        gameOverScreen.appendChild(codeValue);

        // NEW: instruction message instead of restart button
        const refreshMsg = document.createElement('div');
        refreshMsg.textContent = 'Refresh your browser please, thank you.';
        refreshMsg.style.fontSize = '16px';
        refreshMsg.style.marginTop = '16px';
        refreshMsg.style.textAlign = 'center';
        gameOverScreen.appendChild(refreshMsg);

        document.body.appendChild(gameOverScreen);
    }

    resetGame() {
        this.stats.health = 100;
        this.stats.hunger = 100;
        this.stats.energy = 100;
        this.stats.money = 500;
        this.stats.wantedLevel = 0;
        // NEW: reset score/combo/gun level on restart
        this.stats.score = 0;
        this.stats.combo = 1;
        this.stats.bestCombo = 1;
        this.stats.gunLevel = 1;
        this.gunDamageMultiplier = 1.0;
        this.time = 720;
        this.currentLocation = 'Downtown';
        this.camera.position.copy(this.playerPosition);
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = 0;
        this.camera.rotation.x = 0;
        this.camera.position.y = 1.7;
        this.isJumping = false;
        this.jumpVelocity = 0;
        this.canJump = true;
        this.recoil = { x: 0, y: 0, z: 0 };
        this.projectiles = [];
        this.enemyProjectiles = [];
        this.enemies = [];
        this.inventory.clear();
        this.itemObjects = [];

        // Ensure Living Hell Mode is fully exited on restart so UI and state
        // never block a fresh run.
        if (this.livingHellMode && this.livingHellMode.active) {
            this.livingHellMode.deactivate();
        }
        this.inLivingHellZone = false;

        // NEW: clean up any lingering game over screen or menus
        const existingGameOver = document.getElementById('game-over-screen');
        if (existingGameOver) existingGameOver.remove();
        if (this.ui.fastTravelMenu) this.ui.fastTravelMenu.style.display = 'none';
        if (this.ui.inventoryMenu) this.ui.inventoryMenu.style.display = 'none';

        this.scene.remove(this.camera);
        this.camera = null;
        this.init();
    }

    // Simple stub so initialization doesn't fail if no save system is implemented yet
    loadGame() {
        // In the future this can restore state from localStorage or a backend.
        // For now, it intentionally does nothing and lets a fresh game start.

        // Ensure survival HUD score/combo start from a clean state
        this.stats.score = this.stats.score || 0;
        this.stats.combo = this.stats.combo || 1;
        this.stats.bestCombo = this.stats.bestCombo || 1;
        this.lastKillTime = 0;
        this.updateStatsUI();

        // PSEUDOCODE / INTEGRATION POINT:
        // If you add a main menu with a text input for progress codes, you can hook it like this:
        // const inputCode = menuInput.value;
        // const restoredLevel = this.redeemProgressCode(inputCode);
        // if (restoredLevel != null) {
        //     // Grant all cumulative benefits up to restoredLevel (already reflected in gunDamageMultiplier)
        //     console.log('Progress restored to weapon level', restoredLevel);
        // } else {
        //     console.log('Invalid Progress Code. Try again.');
        // }
    }

    // NEW: handle walking through power-up orbs
    checkPowerupPickup() {
        const pickupRadius = 2;
        for (let i = this.itemObjects.length - 1; i >= 0; i--) {
            const obj = this.itemObjects[i];
            if (!obj.userData.isPowerup) continue;

            if (this.camera.position.distanceTo(obj.position) < pickupRadius) {
                this.applyPowerup(obj.userData.powerType);
                this.scene.remove(obj);
                this.itemObjects.splice(i, 1);
            }
        }
    }

    // NEW: Add a message to the scrolling news ticker
    addTickerMessage(message) {
        this.tickerMessages.push(message);
        // Keep only last 20 messages to prevent memory bloat
        if (this.tickerMessages.length > 20) {
            this.tickerMessages.shift();
        }
        this.updateTicker();
    }

    updateTicker() {
        if (!this.ui.tutorialTicker) return;
        
        // Combine tutorial messages with dynamic event messages
        const allMessages = [...this.tutorialMessages, ...this.tickerMessages];
        const tickerText = allMessages.join(' • • • ');
        
        this.ui.tutorialTicker.innerHTML = `<span>${tickerText}</span>`;
    }

    // NEW: apply specific power-up effects
    applyPowerup(powerType) {
        let notificationText = '';
        switch (powerType) {
            case 'health':
                this.stats.health = Math.min(100, this.stats.health + 35);
                this.showStatChange('health', +35);
                notificationText = 'HEALTH RESTORED +35';
                break;
            case 'energy':
                this.stats.energy = Math.min(100, this.stats.energy + 40);
                this.showStatChange('energy', +40);
                // Speed boost for a short time
                this.activeModifiers.speedBoostTime = Math.max(
                    this.activeModifiers.speedBoostTime || 0,
                    10 // seconds
                );
                notificationText = 'ENERGY SURGE +40 • SPEED BOOST ACTIVE';
                break;
            case 'hunger':
                this.stats.hunger = Math.min(100, this.stats.hunger + 40);
                this.showStatChange('hunger', +40);
                notificationText = 'HUNGER SATISFIED +40';
                break;
        }
        if (notificationText) {
            this.addTickerMessage(notificationText);
        }
        this.updateStatsUI();
        this.playSound('use_item');
    }

    start() {
        // Initialize ticker with tutorial messages
        this.updateTicker();
        
        this.renderer.setAnimationLoop(() => {
            // Cap delta to avoid huge physics jumps when tab is unfocused
            const rawDelta = this.clock.getDelta();
            const delta = Math.min(rawDelta, 0.05);
            const now = this.clock.getElapsedTime();
            this.updateTimeAndWeather(delta);
            this.updateStats(delta);
            this.updateMovement(delta);
            this.updateProjectiles(delta);
            this.updateEnemyProjectiles(delta);
            this.updateEnemies(delta); // NEW: keep enemies moving

            // keep the sky dome centered on the camera so textures are always visible
            if (this.skyGroup && this.camera) {
                this.skyGroup.position.copy(this.camera.position);
            }

            // NEW: gently rotate the Visionary OS "eye" watching over the city
            if (this.models && this.models.skyEye) {
                this.models.skyEye.rotation.y += delta * 0.15;
            }

            // Decay camera shake timer
            if (this.cameraShakeTime > 0) {
                this.cameraShakeTime = Math.max(0, this.cameraShakeTime - delta);
            }

            // Keep Living Hell Mode state in sync without heavy logic
            if (this.livingHellMode && this.livingHellMode.active) {
                this.livingHellMode.update(delta);
            }

            this.renderer.render(this.scene, this.camera);
        });
    }
}

// AUTO-BOOTSTRAP: create a single global instance so the game starts loading immediately
if (!window._ulsInstance) {
    window._ulsInstance = new UrbanLifeSimulator();
}

export default UrbanLifeSimulator;