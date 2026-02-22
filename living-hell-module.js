/**
 * Living Hell Module - Narrative Override System
 * ES6 Module for ULS Integration
 */

// Living Hell Mode Configuration
const LIVING_HELL_CONFIG = {
    triggerLocations: [
        "The Living Hell House",
        "The Tank", 
        "Fishtank Address"
    ],
    npcs: {
        raven: { name: "Raven", archetype: "The Schemer", behavior: "manipulative" },
        blaze: { name: "Blaze", archetype: "Hothead", behavior: "short temper" },
        moxie: { name: "Moxie", archetype: "The Strategist", behavior: "calculating" },
        eli: { name: "Eli", archetype: "Wild Card", behavior: "unpredictable" },
        trix: { name: "Trix", archetype: "Fan Favorite", behavior: "charismatic" }
    },
    challenges: [
        "Audience Vote Challenge",
        "Endurance Test", 
        "Trust Fall Disaster",
        "Eviction Ceremony Prep",
        "Alliance Breakdown",
        "Producer Surprise Twist",
        "The Entity's Intervention"
    ],
    entityEvents: [
        "The lights flicker mysteriously as a vote changes overnight.",
        "Whispers echo from nowhere, speaking your darkest secrets.",
        "The thermostat drops to freezing - The Entity's signature move.",
        "Every mirror shows a different face - yours, twisted and wrong."
    ]
};

export class LivingHellMode {
    constructor(game) {
        this.game = game;
        this.active = false;
        this.turnCount = 0;
        this.houseHeat = 0;
        this.viewerCount = 0;
        // Conversation history and complex AI narrative are no longer needed for this simpler vote system
        this.conversationHistory = [];
        // NEW: track which location is currently acting as the Living Hell hotspot
        this.currentHellLocation = null;
        // NEW: track if the player has already voted this round
        this.roundResolved = false;
        
        this.npcs = {
            raven: { mood: 'neutral', trust: 50 },
            blaze: { mood: 'neutral', trust: 50 },
            moxie: { mood: 'neutral', trust: 50 },
            eli: { mood: 'neutral', trust: 50 },
            trix: { mood: 'neutral', trust: 50 }
        };
        
        this.setupUI();
    }
    
    setupUI() {
        // Choice buttons will be created dynamically
    }
    
    activate() {
        this.active = true;
        this.turnCount = 0;
        this.houseHeat = 75;
        this.viewerCount = 25000;
        // NEW: reset vote state at activation
        this.roundResolved = false;
        
        document.body.classList.add('living-hell-mode');
        const overlay = document.getElementById('living-hell-overlay');
        if (overlay) {
            overlay.style.display = 'block';
            // Clear any previous background image from older implementations
            overlay.style.backgroundImage = '';
            overlay.style.backdropFilter = '';
        }
        
        // Start the simple vote-based flow
        this.generateNarrative();
    }
    
    deactivate() {
        this.active = false;
        document.body.classList.remove('living-hell-mode');
        const overlay = document.getElementById('living-hell-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
    
    // SIMPLE, LOCAL NARRATIVE/VOTE SYSTEM:
    // No websim.chat, no imageGen, no JSON parsing – this avoids the runtime errors.
    async generateNarrative(lastChoice = null) {
        const narrativeEl = document.getElementById('hell-narrative');
        const choicesDiv = document.getElementById('hell-choices');

        if (!narrativeEl || !choicesDiv) return;

        this.turnCount++;
        // NEW: each round, randomize which location is considered "Living Hell"
        if (Array.isArray(LIVING_HELL_CONFIG.triggerLocations) && LIVING_HELL_CONFIG.triggerLocations.length > 0) {
            const idx = Math.floor(Math.random() * LIVING_HELL_CONFIG.triggerLocations.length);
            this.currentHellLocation = LIVING_HELL_CONFIG.triggerLocations[idx];

            // Push this down into the core game so location checks use the new hotspot
            if (this.game && Array.isArray(this.game.livingHellZones)) {
                this.game.livingHellZones = [this.currentHellLocation];
            }
        }

        // NEW: reset "one vote per round" guard
        this.roundResolved = false;

        // Basic audience stats wiggle so it feels alive
        const heatDelta = (Math.random() * 6) - 3; // -3 to +3
        this.houseHeat = Math.max(0, Math.min(100, this.houseHeat + heatDelta));
        this.viewerCount = Math.max(0, this.viewerCount + Math.floor(500 + Math.random() * 1500));

        // Update stats UI
        const heatEl = document.getElementById('house-heat');
        const viewerEl = document.getElementById('viewer-count');
        if (heatEl) heatEl.textContent = Math.round(this.houseHeat);
        if (viewerEl) viewerEl.textContent = this.viewerCount.toLocaleString();

        // Build a short narration line for this "round"
        let narrationText = '';
        const challenge = LIVING_HELL_CONFIG.challenges[this.turnCount % LIVING_HELL_CONFIG.challenges.length];

        if (!lastChoice) {
            narrationText = `The house goes quiet as chat scrolls by in a blur. Producers announce: "${challenge}". Your fate will be decided by the vote.`;
        } else {
            if (lastChoice.effect === 'upgrade') {
                narrationText = `The vote locks in. The crowd surges with approval – "${lastChoice.label}". You feel the system bending in your favor.`;
            } else if (lastChoice.effect === 'hindrance') {
                narrationText = `Chat erupts in laughing emotes. "${lastChoice.label}" wins. The house tilts against you as the system punishes your run.`;
            } else {
                narrationText = `The cameras blink twice and the moment passes. Nothing changes… this time.`;
            }
        }

        // If we have a current hell location, mention it in the narration header
        const locationLine = this.currentHellLocation
            ? `<p style="margin-top:6px; opacity:0.85;">Tonight's Living Hell hotspot: <strong>${this.currentHellLocation}</strong></p>`
            : '';

        // Display narration
        narrativeEl.innerHTML = `
            <div class="hell-section">
                <h3>CHAT VOTE – ROUND ${this.turnCount}</h3>
                <p>${narrationText}</p>
                ${locationLine}
            </div>
        `;

        // Build upgrade / hindrance choices
        const choices = this.buildChoices();

        // Render choice buttons
        choicesDiv.innerHTML = '';
        choices.forEach(choice => {
            const btn = document.createElement('button');
            btn.className = 'hell-choice-btn';
            btn.textContent = choice.label;
            // NEW: store a reference so we can disable them after voting
            btn.dataset.choiceId = choice.id;
            btn.addEventListener('click', () => this.makeChoice(choice));
            choicesDiv.appendChild(btn);
        });

        // Exit button
        const exitBtn = document.createElement('button');
        exitBtn.className = 'hell-choice-btn exit-btn';
        exitBtn.textContent = 'Try to leave the house (Exit Living Hell Mode)';
        exitBtn.addEventListener('click', () => this.deactivate());
        choicesDiv.appendChild(exitBtn);
    }

    // Define concrete upgrades / hindrances for gameplay
    buildChoices() {
        // Two upgrades, two hindrances – you could randomize more if you want
        return [
            {
                id: 'A',
                label: 'A: THE GIFT – Stabilized Ammo (no bullet drop this round)',
                effect: 'upgrade',
                apply: () => {
                    if (!this.game.activeModifiers) this.game.activeModifiers = {};
                    this.game.activeModifiers.noBulletDrop = true;
                }
            },
            {
                id: 'B',
                label: 'B: THE GIFT – Adrenal Surge (+25 HEALTH)',
                effect: 'upgrade',
                apply: () => {
                    if (!this.game.stats) return;
                    this.game.stats.health = Math.min(100, this.game.stats.health + 25);
                    this.game.updateStatsUI();
                }
            },
            {
                id: 'C',
                label: 'C: THE CURSE – Overclocked Swarm (enemies fire faster)',
                effect: 'hindrance',
                apply: () => {
                    if (!this.game.activeModifiers) this.game.activeModifiers = {};
                    // Simple flag the enemy update loop could consult later
                    this.game.activeModifiers.fastEnemies = true;
                }
            },
            {
                id: 'D',
                label: 'D: THE CURSE – Blood Tax (-20 HEALTH)',
                effect: 'hindrance',
                apply: () => {
                    if (!this.game.stats) return;
                    this.game.stats.health = Math.max(0, this.game.stats.health - 20);
                    this.game.updateStatsUI();
                    if (this.game.stats.health <= 0 && typeof this.game.gameOver === 'function') {
                        this.game.gameOver();
                    }
                }
            }
        ];
    }

    makeChoice(choice) {
        // NEW: enforce single vote per round
        if (this.roundResolved) {
            return;
        }
        this.roundResolved = true;

        // Visually disable all choice buttons so the player can't click twice
        const choicesDiv = document.getElementById('hell-choices');
        if (choicesDiv) {
            const buttons = choicesDiv.querySelectorAll('.hell-choice-btn');
            buttons.forEach(btn => {
                // Keep the exit button usable; only lock the vote options
                if (!btn.classList.contains('exit-btn')) {
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                    btn.style.cursor = 'default';
                }
            });
        }

        // Apply the selected effect
        if (choice && typeof choice.apply === 'function') {
            choice.apply();
        }

        // After applying a choice, automatically force the player out of Living Hell Mode
        // instead of starting another round.
        if (this.active) {
            this.deactivate();
        }
    }

    // Image generation & complex AI narrative are intentionally removed to prevent errors
    /*
    async generateAndApplyBackgroundImage(prompt) {
        // Deprecated – no longer used
    }
    */

    update(delta) {
        if (!this.active) return;
        
        // Passive heat decay
        this.houseHeat -= delta * 0.5;
        this.houseHeat = Math.max(0, this.houseHeat);
        
        const heatEl = document.getElementById('house-heat');
        if (heatEl) {
            heatEl.textContent = Math.round(this.houseHeat);
        }
    }
}