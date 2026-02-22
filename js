    updateStatsUI() {
        // Health
        if (this.ui.healthBar) {
            this.ui.healthBar.style.width = this.stats.health + '%';
        }
// ... existing code ...

        // Wanted level
        const stars = '★'.repeat(this.stats.wantedLevel) + '☆'.repeat(5 - this.stats.wantedLevel);
        if (this.ui.wantedStars) {
            this.ui.wantedStars.textContent = stars;
        }

+        // Survival score & combo (only visible when HUD is shown)
+        if (this.ui.survivalScore) {
+            this.ui.survivalScore.textContent = `SCORE: ${Math.round(this.stats.score)}`;
+        }
+        if (this.ui.survivalCombo) {
+            this.ui.survivalCombo.textContent = `COMBO: x${Math.max(1, Math.floor(this.stats.combo))}`;
+        }
    }

    // NEW: register a kill to update score and combo system
+    registerKill(isBoss = false) {
+        const now = this.clock ? this.clock.getElapsedTime() : performance.now() / 1000;
+
+        // Combo window: 4 seconds between kills keeps the streak alive
+        if (now - this.lastKillTime <= 4) {
+            this.stats.combo += 1;
+        } else {
+            this.stats.combo = 1;
+        }
+        this.lastKillTime = now;
+
+        // Base points, scaled by combo and boss flag
+        const base = isBoss ? 300 : 100;
+        const comboMultiplier = 1 + (this.stats.combo - 1) * 0.15; // gentle ramp
+        const gained = base * comboMultiplier;
+        this.stats.score += gained;
+
+        // Track best combo for bragging rights
+        if (this.stats.combo > this.stats.bestCombo) {
+            this.stats.bestCombo = this.stats.combo;
+        }
+
+        // Brief floating text near crosshair to reinforce scoring
+        const crosshair = this.ui.crosshair || document.getElementById('crosshair');
+        if (crosshair) {
+            const rect = crosshair.getBoundingClientRect();
+            const float = document.createElement('div');
+            float.textContent = `+${Math.round(gained)}  x${Math.floor(this.stats.combo)}`;
+            float.style.position = 'absolute';
+            float.style.left = `${rect.left + rect.width / 2}px`;
+            float.style.top = `${rect.top - 10}px`;
+            float.style.transform = 'translate(-50%, 0)';
+            float.style.pointerEvents = 'none';
+            float.style.color = '#ffeb99';
+            float.style.fontFamily = "'VT323', monospace";
+            float.style.fontSize = '14px';
+            float.style.textShadow = '0 0 5px rgba(0,0,0,0.9)';
+            float.style.zIndex = '160';
+            float.style.opacity = '1';
+            float.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
+            document.body.appendChild(float);
+            requestAnimationFrame(() => {
+                float.style.opacity = '0';
+                float.style.transform = 'translate(-50%, -18px)';
+            });
+            setTimeout(() => float.remove(), 650);
+        }
+
+        // Refresh HUD numbers
+        this.updateStatsUI();
+    }

    // NEW: spawn basic enemies for survival waves
    spawnEnemies(count, isBossWave = false) {
        if (!this.scene || !this.camera || this.enemyTextures.length === 0) return;
// ... existing code ...
            const enemy = {
                mesh,
                health: isBoss ? 400 : 100,
                isBoss,
                // NEW: simple shooting cooldown so enemies can damage the player
                lastShotTime: 0,
                fireCooldown: (isBoss ? 1.2 : (2 + Math.random())), // bosses shoot a bit faster
                // Updated: simplified damage handler since we no longer have hit textures
                takeDamage: (amount) => {
                    enemy.health -= amount;
// ... existing code flash material ...
                    if (enemy.health <= 0) {
                        // Remove from scene and game enemy list
                        if (enemy.mesh && enemy.mesh.parent) {
                            enemy.mesh.parent.remove(enemy.mesh);
                        }
                        const idx = this.enemies.indexOf(enemy);
                        if (idx !== -1) this.enemies.splice(idx, 1);
+
+                        // NEW: award score and maintain combo streak
+                        this.registerKill(enemy.isBoss);

                        // Notify wave manager so HUD updates and waves can progress
                        if (this.waveManager && typeof this.waveManager.onEnemyKilled === 'function') {
                            this.waveManager.onEnemyKilled();
                        }
                    }
                }
            };
// ... existing code ...
    }

    resetGame() {
        this.stats.health = 100;
        this.stats.hunger = 100;
        this.stats.energy = 100;
        this.stats.money = 500;
        this.stats.wantedLevel = 0;
+        this.stats.score = 0;
+        this.stats.combo = 1;
+        this.stats.bestCombo = 1;
+        this.lastKillTime = 0;
        this.time = 720;
// ... existing code ...
        this.inventory.clear();
        this.itemObjects = [];
// ... existing code ...
        this.inLivingHellZone = false;

    // Simple stub so initialization doesn't fail if no save system is implemented yet
    loadGame() {
        // In the future this can restore state from localStorage or a backend.
        // For now, it intentionally does nothing and lets a fresh game start.
+        // Ensure survival HUD score/combo start from a clean state
+        this.stats.score = this.stats.score || 0;
+        this.stats.combo = this.stats.combo || 1;
+        this.stats.bestCombo = this.stats.bestCombo || 1;
+        this.lastKillTime = 0;
+        this.updateStatsUI();
    }

