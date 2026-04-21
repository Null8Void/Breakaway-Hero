const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;

let scale = 1;
let offsetX = 0;
let offsetY = 0;

function resizeCanvas() {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    const scaleX = windowWidth / GAME_WIDTH;
    const scaleY = windowHeight / GAME_HEIGHT;
    
    scale = Math.min(scaleX, scaleY) * 0.95;
    
    canvas.width = GAME_WIDTH * scale;
    canvas.height = GAME_HEIGHT * scale;
    
    offsetX = (windowWidth - canvas.width) / 2;
    offsetY = (windowHeight - canvas.height) / 2;
    
    canvas.style.marginLeft = offsetX + 'px';
    canvas.style.marginTop = offsetY + 'px';
    
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

const gameState = {
    player: { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2, size: 30, color: '#e94560' },
    keys: {},
    input: {
        active: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0
    },
    imageLoader: {
        characters: [],
        currentIndex: 0,
        loadedImages: {},
        loading: false
    },
    layers: {
        loadedImages: {},
        layerOrder: [],
        dragging: null,
        dragOffset: { x: 0, y: 0 }
    },
    lastTime: 0,
    deltaTime: 0
};

const LayeredRenderer = {
    layers: {},
    nextLayerId: 1,
    defaultMaxWidth: 300,
    defaultMaxHeight: 400,
    centerX: GAME_WIDTH / 2,
    centerY: GAME_HEIGHT / 2,
    detachThreshold: 20,
    
    addLayer(id, url, order) {
        if (!this.layers[id]) {
            this.layers[id] = { id, url, order, image: null, loaded: false, x: 0, y: 0, detached: false };
        } else {
            this.layers[id].url = url;
            this.layers[id].order = order;
            this.layers[id].loaded = false;
            this.layers[id].image = null;
        }
        this.updateLayerOrder();
        return this.loadLayer(id);
    },
    
    removeLayer(id) {
        delete this.layers[id];
        delete gameState.layers.loadedImages[id];
        this.updateLayerOrder();
    },
    
    updateLayerOrder() {
        gameState.layers.layerOrder = Object.values(this.layers)
            .sort((a, b) => a.order - b.order)
            .map(l => l.id);
    },
    
    async loadLayer(id) {
        const layer = this.layers[id];
        if (!layer) return null;
        
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                layer.image = img;
                layer.loaded = true;
                gameState.layers.loadedImages[id] = img;
                resolve(img);
            };
            img.onerror = () => {
                console.warn(`Failed to load layer: ${layer.url}`);
                layer.loaded = true;
                resolve(null);
            };
            img.src = layer.url;
        });
    },
    
    getLayer(id) {
        return this.layers[id];
    },
    
    setLayerOrder(id, order) {
        if (this.layers[id]) {
            this.layers[id].order = order;
            this.updateLayerOrder();
        }
    },
    
    clearAll() {
        this.layers = {};
        gameState.layers.loadedImages = {};
        gameState.layers.layerOrder = [];
    },
    
    getScaledDimensions(layer) {
        const maxWidth = this.defaultMaxWidth;
        const maxHeight = this.defaultMaxHeight;
        let width = layer.image.width;
        let height = layer.image.height;
        
        if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width *= ratio;
            height *= ratio;
        }
        
        return { width, height };
    },
    
    renderLayers(centerX, centerY) {
        for (const layerId of gameState.layers.layerOrder) {
            const layer = this.layers[layerId];
            if (!layer || !layer.image || layer.destroyed) continue;
            
            const dims = this.getScaledDimensions(layer);
            const drawX = centerX - dims.width / 2 + layer.x;
            const drawY = centerY - dims.height / 2 + layer.y;
            
            if (layer.grid) {
                for (let row = 0; row < layer.grid.rows; row++) {
                    for (let col = 0; col < layer.grid.cols; col++) {
                        if (layer.grid.cells[row] && !layer.grid.cells[row][col]) {
                            const srcX = col * FragmentSystem.cellSize;
                            const srcY = row * FragmentSystem.cellSize;
                            const srcW = Math.min(FragmentSystem.cellSize, dims.width - srcX);
                            const srcH = Math.min(FragmentSystem.cellSize, dims.height - srcY);
                            
                            ctx.drawImage(
                                layer.image,
                                srcX, srcY, srcW, srcH,
                                drawX + srcX, drawY + srcY, srcW, srcH
                            );
                        }
                    }
                }
            } else {
                ctx.drawImage(
                    layer.image,
                    drawX,
                    drawY,
                    dims.width,
                    dims.height
                );
            }
        }
    },
    
    hitTest(screenX, screenY) {
        const gamePos = screenToGame(screenX, screenY);
        const centerX = this.centerX;
        const centerY = this.centerY;
        
        const orderedLayers = [...gameState.layers.layerOrder].reverse();
        
        for (const layerId of orderedLayers) {
            const layer = this.layers[layerId];
            if (!layer || !layer.image || layer.destroyed) continue;
            
            const dims = this.getScaledDimensions(layer);
            const drawX = centerX - dims.width / 2 + layer.x;
            const drawY = centerY - dims.height / 2 + layer.y;
            
            if (gamePos.x >= drawX && gamePos.x <= drawX + dims.width &&
                gamePos.y >= drawY && gamePos.y <= drawY + dims.height) {
                
                if (layer.grid) {
                    const localX = gamePos.x - drawX;
                    const localY = gamePos.y - drawY;
                    const cellCol = Math.floor(localX / FragmentSystem.cellSize);
                    const cellRow = Math.floor(localY / FragmentSystem.cellSize);
                    
                    if (!layer.grid.cells[cellRow] || !layer.grid.cells[cellRow][cellCol]) {
                        return layerId;
                    }
                } else {
                    return layerId;
                }
            }
            
            return null;
        }
        
        return null;
    },
    
    startDrag(layerId, screenX, screenY) {
        const layer = this.layers[layerId];
        if (!layer) return;
        
        const gamePos = screenToGame(screenX, screenY);
        const centerX = this.centerX;
        const centerY = this.centerY;
        
        const layerCenterX = centerX + layer.x;
        const layerCenterY = centerY + layer.y;
        
        gameState.layers.dragging = layerId;
        gameState.layers.dragOffset = {
            x: layerCenterX - gamePos.x,
            y: layerCenterY - gamePos.y
        };
        gameState.layers.dragStartX = gamePos.x;
        gameState.layers.dragStartY = gamePos.y;
        gameState.layers.pendingDetach = !layer.detached;
    },
    
    updateDrag(screenX, screenY) {
        if (!gameState.layers.dragging) return;
        
        const layerId = gameState.layers.dragging;
        const layer = this.layers[layerId];
        if (!layer) return;
        
        const gamePos = screenToGame(screenX, screenY);
        const centerX = this.centerX;
        const centerY = this.centerY;
        
        layer.x = gamePos.x + gameState.layers.dragOffset.x - centerX;
        layer.y = gamePos.y + gameState.layers.dragOffset.y - centerY;
        
        if (gameState.layers.pendingDetach) {
            const dx = gamePos.x - gameState.layers.dragStartX;
            const dy = gamePos.y - gameState.layers.dragStartY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > this.detachThreshold) {
                layer.detached = true;
                gameState.layers.pendingDetach = false;
            }
        }
    },
    
    endDrag() {
        if (gameState.layers.dragging) {
            const layer = this.layers[gameState.layers.dragging];
            if (layer && layer.detached && !layer.destroyed) {
                layer.x = 0;
                layer.y = 0;
            }
        }
        gameState.layers.dragging = null;
        gameState.layers.pendingDetach = false;
    },
    
    getDraggingLayer() {
        return gameState.layers.dragging;
    },
    
    isDetached(layerId) {
        return this.layers[layerId]?.detached || false;
    },
    
    reattachLayer(layerId) {
        const layer = this.layers[layerId];
        if (layer) {
            layer.detached = false;
            layer.x = 0;
            layer.y = 0;
        }
    },
    
    reattachAll() {
        for (const layerId in this.layers) {
            this.layers[layerId].detached = false;
            this.layers[layerId].x = 0;
            this.layers[layerId].y = 0;
        }
    },
    
    resetPositions() {
        for (const layerId in this.layers) {
            if (!this.layers[layerId].detached) {
                this.layers[layerId].x = 0;
                this.layers[layerId].y = 0;
            }
        }
    },
    
    getLayerCount() {
        return Object.keys(this.layers).length;
    },
    
    getDetachedCount() {
        return Object.values(this.layers).filter(l => l.detached).length;
    }
};

const FragmentSystem = {
    fragments: [],
    gravity: 500,
    maxFragments: 200,
    cellSize: 25,
    
    initLayerGrid(layerId) {
        const layer = LayeredRenderer.layers[layerId];
        if (!layer) return;
        
        const dims = LayeredRenderer.getScaledDimensions(layer);
        const cols = Math.ceil(dims.width / this.cellSize);
        const rows = Math.ceil(dims.height / this.cellSize);
        
        layer.grid = {
            cols,
            rows,
            cells: [],
            totalCells: cols * rows,
            brokenCells: 0
        };
        
        for (let row = 0; row < rows; row++) {
            layer.grid.cells[row] = [];
            for (let col = 0; col < cols; col++) {
                layer.grid.cells[row][col] = false;
            }
        }
    },
    
    carveArea(layerId, startX, startY, endX, endY) {
        const layer = LayeredRenderer.layers[layerId];
        if (!layer || !layer.image || !layer.grid) return;
        
        const dims = LayeredRenderer.getScaledDimensions(layer);
        const centerX = LayeredRenderer.centerX;
        const centerY = LayeredRenderer.centerY;
        const layerDrawX = centerX - dims.width / 2 + layer.x;
        const layerDrawY = centerY - dims.height / 2 + layer.y;
        
        const minX = Math.min(startX, endX) - layerDrawX;
        const minY = Math.min(startY, endY) - layerDrawY;
        const maxX = Math.max(startX, endX) - layerDrawX;
        const maxY = Math.max(startY, endY) - layerDrawY;
        
        let carved = false;
        
        for (let row = 0; row < layer.grid.rows; row++) {
            for (let col = 0; col < layer.grid.cols; col++) {
                if (layer.grid.cells[row][col]) continue;
                
                const cellX = col * this.cellSize;
                const cellY = row * this.cellSize;
                const cellW = Math.min(this.cellSize, dims.width - cellX);
                const cellH = Math.min(this.cellSize, dims.height - cellY);
                
                const cellCenterX = cellX + cellW / 2;
                const cellCenterY = cellY + cellH / 2;
                
                if (cellCenterX >= minX && cellCenterX <= maxX &&
                    cellCenterY >= minY && cellCenterY <= maxY) {
                    
                    const fragX = layerDrawX + cellX;
                    const fragY = layerDrawY + cellY;
                    this.createFragment(layerId, fragX, fragY, cellW, cellH);
                    
                    layer.grid.cells[row][col] = true;
                    layer.grid.brokenCells++;
                    carved = true;
                }
            }
        }
        
        if (layer.grid.brokenCells >= layer.grid.totalCells) {
            this.destroyLayer(layerId);
        }
        
        return carved;
    },
    
    createFragment(layerId, x, y, width, height) {
        if (this.fragments.length >= this.maxFragments) {
            this.fragments.shift();
        }
        
        this.fragments.push({
            layerId,
            x,
            y,
            width,
            height,
            vx: (Math.random() - 0.5) * 200,
            vy: (Math.random() - 0.5) * 200 - 100,
            rotation: Math.random() * Math.PI * 2,
            angularVel: (Math.random() - 0.5) * 8,
            alpha: 1,
            lifetime: 0,
            maxLifetime: 2 + Math.random() * 2
        });
    },
    
    destroyLayer(layerId) {
        const layer = LayeredRenderer.layers[layerId];
        if (layer) {
            layer.destroyed = true;
            layer.x = 0;
            layer.y = 0;
            layer.detached = false;
        }
    },
    
    isLayerDestroyed(layerId) {
        const layer = LayeredRenderer.layers[layerId];
        return layer?.destroyed || false;
    },
    
    restoreLayer(layerId) {
        const layer = LayeredRenderer.layers[layerId];
        if (!layer) return;
        
        layer.destroyed = false;
        layer.grid = null;
        this.initLayerGrid(layerId);
    },
    
    restoreAllLayers() {
        for (const layerId in LayeredRenderer.layers) {
            this.restoreLayer(layerId);
        }
    },
    
    update(dt) {
        for (let i = this.fragments.length - 1; i >= 0; i--) {
            const frag = this.fragments[i];
            
            frag.vy += this.gravity * dt;
            frag.x += frag.vx * dt;
            frag.y += frag.vy * dt;
            frag.rotation += frag.angularVel * dt;
            
            frag.lifetime += dt;
            if (frag.lifetime > frag.maxLifetime) {
                frag.alpha -= dt * 0.8;
            }
            
            if (frag.y > GAME_HEIGHT + 50 || frag.alpha <= 0) {
                this.fragments.splice(i, 1);
            }
        }
    },
    
    renderLayerCell(layerId, cellCol, cellRow) {
        const layer = LayeredRenderer.layers[layerId];
        if (!layer || !layer.image || !layer.grid) return;
        
        if (layer.grid.cells[cellRow] && layer.grid.cells[cellRow][cellCol]) return;
        
        const dims = LayeredRenderer.getScaledDimensions(layer);
        const centerX = LayeredRenderer.centerX;
        const centerY = LayeredRenderer.centerY;
        const layerDrawX = centerX - dims.width / 2 + layer.x;
        const layerDrawY = centerY - dims.height / 2 + layer.y;
        
        const srcX = cellCol * this.cellSize;
        const srcY = cellRow * this.cellSize;
        const srcW = Math.min(this.cellSize, dims.width - srcX);
        const srcH = Math.min(this.cellSize, dims.height - srcY);
        
        const dstX = layerDrawX + cellCol * this.cellSize;
        const dstY = layerDrawY + cellRow * this.cellSize;
        
        ctx.drawImage(
            layer.image,
            srcX, srcY, srcW, srcH,
            dstX, dstY, srcW, srcH
        );
    },
    
    render() {
        for (const frag of this.fragments) {
            const layer = LayeredRenderer.layers[frag.layerId];
            if (!layer || !layer.image) continue;
            
            ctx.save();
            ctx.globalAlpha = frag.alpha;
            
            const cx = frag.x + frag.width / 2;
            const cy = frag.y + frag.height / 2;
            
            ctx.translate(cx, cy);
            ctx.rotate(frag.rotation);
            
            ctx.drawImage(
                layer.image,
                -frag.width / 2,
                -frag.height / 2,
                frag.width,
                frag.height
            );
            
            ctx.restore();
        }
    },
    
    clear() {
        this.fragments = [];
    },
    
    getCount() {
        return this.fragments.length;
    }
};

const ImageLoader = {
    characters: [
        { id: 'char1', name: 'Warrior', url: 'images/char1.png' },
        { id: 'char2', name: 'Mage', url: 'images/char2.png' },
        { id: 'char3', name: 'Rogue', url: 'images/char3.png' },
        { id: 'char4', name: 'Healer', url: 'images/char4.png' }
    ],
    
    loadImage(id, url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                gameState.imageLoader.loadedImages[id] = img;
                resolve(img);
            };
            img.onerror = () => {
                console.warn(`Failed to load image: ${url}`);
                resolve(null);
            };
            img.src = url;
        });
    },
    
    async loadCharacter(index) {
        if (index < 0 || index >= this.characters.length) return null;
        
        gameState.imageLoader.loading = true;
        gameState.imageLoader.currentIndex = index;
        
        const char = this.characters[index];
        
        if (gameState.imageLoader.loadedImages[char.id]) {
            gameState.imageLoader.loading = false;
            return gameState.imageLoader.loadedImages[char.id];
        }
        
        return await this.loadImage(char.id, char.url);
    },
    
    async loadAll() {
        for (let i = 0; i < this.characters.length; i++) {
            const char = this.characters[i];
            if (!gameState.imageLoader.loadedImages[char.id]) {
                await this.loadImage(char.id, char.url);
            }
        }
    },
    
    next() {
        const nextIndex = (gameState.imageLoader.currentIndex + 1) % this.characters.length;
        return this.loadCharacter(nextIndex);
    },
    
    previous() {
        const prevIndex = (gameState.imageLoader.currentIndex - 1 + this.characters.length) % this.characters.length;
        return this.loadCharacter(prevIndex);
    },
    
    getCurrentCharacter() {
        return this.characters[gameState.imageLoader.currentIndex];
    },
    
    getCurrentImage() {
        const char = this.getCurrentCharacter();
        return char ? gameState.imageLoader.loadedImages[char.id] : null;
    },
    
    setCharacters(characterList) {
        this.characters = characterList;
        gameState.imageLoader.loadedImages = {};
        gameState.imageLoader.currentIndex = 0;
    }
};

let lastNavTime = 0;

function update(dt) {
    const speed = 300 * dt;
    
    if (gameState.keys['ArrowUp'] || gameState.keys['w']) {
        gameState.player.y -= speed;
    }
    if (gameState.keys['ArrowDown'] || gameState.keys['s']) {
        gameState.player.y += speed;
    }
    if (gameState.keys['ArrowLeft'] || gameState.keys['a']) {
        gameState.player.x -= speed;
    }
    if (gameState.keys['ArrowRight'] || gameState.keys['d']) {
        gameState.player.x += speed;
    }
    
    gameState.player.x = Math.max(gameState.player.size, Math.min(GAME_WIDTH - gameState.player.size, gameState.player.x));
    gameState.player.y = Math.max(gameState.player.size, Math.min(GAME_HEIGHT - gameState.player.size, gameState.player.y));
    
    const now = performance.now();
    if (now - lastNavTime > 200) {
        if (gameState.keys['ArrowRight']) {
            ImageLoader.next();
            lastNavTime = now;
        } else if (gameState.keys['ArrowLeft']) {
            ImageLoader.previous();
            lastNavTime = now;
        }
    }
    
    FragmentSystem.update(dt);
}

function render() {
    ctx.fillStyle = '#16213e';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    
    ctx.fillStyle = '#0f3460';
    for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 8; j++) {
            if ((i + j) % 2 === 0) {
                ctx.fillRect(i * 80, j * 75, 80, 75);
            }
        }
    }
    
    const centerX = GAME_WIDTH / 2;
    const centerY = GAME_HEIGHT / 2;
    const maxWidth = LayeredRenderer.defaultMaxWidth;
    const maxHeight = LayeredRenderer.defaultMaxHeight;
    
    if (LayeredRenderer.getLayerCount() > 0) {
        LayeredRenderer.renderLayers(centerX, centerY);
        FragmentSystem.render();
        
        const draggingLayerId = LayeredRenderer.getDraggingLayer();
        if (draggingLayerId) {
            const layer = LayeredRenderer.layers[draggingLayerId];
            const dims = LayeredRenderer.getScaledDimensions(layer);
            const drawX = centerX - dims.width / 2 + layer.x;
            const drawY = centerY - dims.height / 2 + layer.y;
            
            ctx.strokeStyle = layer.detached ? '#ff6b6b' : '#ffd93d';
            ctx.lineWidth = 3;
            ctx.setLineDash(layer.detached ? [] : [5, 5]);
            ctx.strokeRect(drawX - 2, drawY - 2, dims.width + 4, dims.height + 4);
            ctx.setLineDash([]);
        }
        
        for (const layerId of gameState.layers.layerOrder) {
            const layer = LayeredRenderer.layers[layerId];
            if (layer && layer.detached && layerId !== draggingLayerId) {
                const dims = LayeredRenderer.getScaledDimensions(layer);
                const drawX = centerX - dims.width / 2 + layer.x;
                const drawY = centerY - dims.height / 2 + layer.y;
                
                ctx.strokeStyle = '#ff6b6b';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(drawX - 2, drawY - 2, dims.width + 4, dims.height + 4);
                ctx.setLineDash([]);
            }
        }
        
        const char = ImageLoader.getCurrentCharacter();
        if (char) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(char.name, centerX, centerY + maxHeight / 2 + 40);
            
            ctx.font = '16px Arial';
            ctx.fillStyle = '#aaa';
            const detachedCount = LayeredRenderer.getDetachedCount();
            const layerInfo = `Layers: ${LayeredRenderer.getLayerCount()} | Detached: ${detachedCount} | Order: ${gameState.layers.layerOrder.join(' > ')}`;
            ctx.fillText(layerInfo, centerX, centerY + maxHeight / 2 + 70);
            ctx.fillText('Drag to carve pieces | Press R to restore | Press R to restore all', centerX, centerY + maxHeight / 2 + 95);
        }
    } else {
        ctx.fillStyle = '#fff';
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No layers loaded', centerX, centerY);
        ctx.fillText('Use LayeredRenderer.addLayer()', centerX, centerY + 30);
    }
    
    ctx.fillStyle = gameState.player.color;
    ctx.beginPath();
    ctx.arc(gameState.player.x, gameState.player.y, gameState.player.size, 0, Math.PI * 2);
    ctx.fill();
    
    if (gameState.input.active) {
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(gameState.input.currentX, gameState.input.currentY, 25, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(0, 255, 136, 0.3)';
        ctx.beginPath();
        ctx.arc(gameState.input.currentX, gameState.input.currentY, 25, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#00ff88';
        ctx.beginPath();
        ctx.arc(gameState.input.currentX, gameState.input.currentY, 5, 0, Math.PI * 2);
        ctx.fill();
    }
    
    ctx.fillStyle = '#fff';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Arrow Keys / WASD to move', GAME_WIDTH / 2, 40);
    ctx.fillText('Click & Drag / Touch & Drag to move', GAME_WIDTH / 2, 70);
}

function gameLoop(timestamp) {
    gameState.deltaTime = (timestamp - gameState.lastTime) / 1000;
    gameState.lastTime = timestamp;
    
    if (gameState.deltaTime > 0.1) {
        gameState.deltaTime = 0.016;
    }
    
    if (currentMode === GameMode.MENU) {
        FusionRenderer.render();
    } else if (currentMode === GameMode.GAME || currentMode === GameMode.FUSION) {
        update(gameState.deltaTime);
        render();
    }
    
    requestAnimationFrame(gameLoop);
}

window.addEventListener('keydown', (e) => {
    gameState.keys[e.key] = true;
    
    if (e.key === 'r' || e.key === 'R') {
        const draggingLayerId = LayeredRenderer.getDraggingLayer();
        if (draggingLayerId) {
            FragmentSystem.restoreLayer(draggingLayerId);
        } else {
            FragmentSystem.restoreAllLayers();
        }
    }
    
    if (e.key === 'Escape') {
        const overlay = document.getElementById('menuOverlay');
        if (overlay.classList.contains('active')) {
            overlay.classList.remove('active');
            currentMode = GameMode.GAME;
        } else {
            MenuSystem.showMainMenu();
        }
    }
});

window.addEventListener('keyup', (e) => {
    gameState.keys[e.key] = false;
});

function screenToGame(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale
    };
}

function handleInputStart(x, y) {
    const layerId = LayeredRenderer.hitTest(x, y);
    
    if (layerId && LayeredRenderer.getLayer(layerId)?.loaded) {
        const layer = LayeredRenderer.getLayer(layerId);
        
        if (!layer.grid) {
            FragmentSystem.initLayerGrid(layerId);
        }
        
        LayeredRenderer.startDrag(layerId, x, y);
        gameState.input.active = true;
        gameState.input.startX = x;
        gameState.input.startY = y;
        gameState.input.currentX = x;
        gameState.input.currentY = y;
        
        const gamePos = screenToGame(x, y);
        const dims = LayeredRenderer.getScaledDimensions(layer);
        const centerX = LayeredRenderer.centerX;
        const centerY = LayeredRenderer.centerY;
        const layerDrawX = centerX - dims.width / 2 + layer.x;
        const layerDrawY = centerY - dims.height / 2 + layer.y;
        
        const carveRadius = 30;
        FragmentSystem.carveArea(layerId, 
            gamePos.x - carveRadius, gamePos.y - carveRadius,
            gamePos.x + carveRadius, gamePos.y + carveRadius);
    } else {
        const pos = screenToGame(x, y);
        gameState.input.active = true;
        gameState.input.startX = pos.x;
        gameState.input.startY = pos.y;
        gameState.input.currentX = pos.x;
        gameState.input.currentY = pos.y;
    }
}

function handleInputMove(x, y) {
    if (!gameState.input.active) return;
    
    if (gameState.layers.dragging) {
        const prevGamePos = screenToGame(gameState.input.currentX, gameState.input.currentY);
        const currentGamePos = screenToGame(x, y);
        
        LayeredRenderer.updateDrag(x, y);
        
        const layerId = gameState.layers.dragging;
        const layer = LayeredRenderer.getLayer(layerId);
        
        if (layer && !layer.destroyed) {
            if (!layer.grid) {
                FragmentSystem.initLayerGrid(layerId);
            }
            
            const carveRadius = 25;
            FragmentSystem.carveArea(layerId,
                prevGamePos.x - carveRadius, prevGamePos.y - carveRadius,
                currentGamePos.x + carveRadius, currentGamePos.y + carveRadius);
        }
        
        if (LayeredRenderer.isLayerDestroyed(layerId)) {
            gameState.layers.dragging = null;
        }
    } else {
        const pos = screenToGame(x, y);
        gameState.input.currentX = pos.x;
        gameState.input.currentY = pos.y;
        
        const dx = pos.x - gameState.input.startX;
        const dy = pos.y - gameState.input.startY;
        
        gameState.player.x = Math.max(gameState.player.size, Math.min(GAME_WIDTH - gameState.player.size, gameState.player.x + dx));
        gameState.player.y = Math.max(gameState.player.size, Math.min(GAME_HEIGHT - gameState.player.size, gameState.player.y + dy));
        
        gameState.input.startX = pos.x;
        gameState.input.startY = pos.y;
    }
}

function handleInputEnd() {
    if (gameState.layers.dragging) {
        LayeredRenderer.endDrag();
    }
    gameState.input.active = false;
}

canvas.addEventListener('mousedown', (e) => {
    handleInputStart(e.clientX, e.clientY);
});

canvas.addEventListener('mousemove', (e) => {
    if (e.buttons > 0) {
        handleInputMove(e.clientX, e.clientY);
    }
});

canvas.addEventListener('mouseup', handleInputEnd);
canvas.addEventListener('mouseleave', handleInputEnd);

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    handleInputStart(touch.clientX, touch.clientY);
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    handleInputMove(touch.clientX, touch.clientY);
});

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    handleInputEnd();
});

window.addEventListener('resize', resizeCanvas);

const GameMode = {
    MENU: 'menu',
    GAME: 'game',
    FUSION: 'fusion'
};

let currentMode = GameMode.MENU;

const MenuSystem = {
    submissions: [],
    currentEditing: null,
    tempLayers: [],
    
    init() {
        this.loadSubmissions();
        this.showMainMenu();
    },
    
    loadSubmissions() {
        const saved = localStorage.getItem('breakaway_submissions');
        if (saved) {
            this.submissions = JSON.parse(saved);
        }
    },
    
    saveSubmissions() {
        localStorage.setItem('breakaway_submissions', JSON.stringify(this.submissions));
    },
    
    showMainMenu() {
        currentMode = GameMode.MENU;
        
        const overlay = document.getElementById('menuOverlay');
        const content = document.getElementById('menuContent');
        
        content.innerHTML = `
            <h2>Breakaway Hero</h2>
            <button id="btnPlay">Play Game</button>
            <button id="btnFusion">Fusion Creator</button>
            <button id="btnSubmissions">My Submissions</button>
            <button class="close-btn" id="btnClose">Close Menu</button>
        `;
        
        overlay.classList.add('active');
        
        document.getElementById('btnPlay').onclick = () => {
            overlay.classList.remove('active');
            currentMode = GameMode.GAME;
        };
        
        document.getElementById('btnFusion').onclick = () => {
            this.showFusionCreator();
        };
        
        document.getElementById('btnSubmissions').onclick = () => {
            this.showSubmissions();
        };
        
        document.getElementById('btnClose').onclick = () => {
            overlay.classList.remove('active');
            currentMode = GameMode.GAME;
        };
    },
    
    showFusionCreator(editId = null) {
        this.currentEditing = editId;
        
        let existingName = '';
        let existingLayers = [];
        
        if (editId) {
            const sub = this.submissions.find(s => s.id === editId);
            if (sub) {
                existingName = sub.name;
                existingLayers = sub.layers || [];
            }
        }
        
        this.tempLayers = existingLayers.map((l, i) => ({
            id: 'temp_' + Date.now() + '_' + i,
            url: l.url,
            name: l.name
        }));
        
        const overlay = document.getElementById('menuOverlay');
        const content = document.getElementById('menuContent');
        
        const layerItems = this.tempLayers.map((layer, index) => `
            <div class="layer-item">
                <span>${index + 1}. ${layer.name}</span>
                <button onclick="MenuSystem.removeTempLayer(${index})">Remove</button>
            </div>
        `).join('');
        
        content.innerHTML = `
            <h2>${editId ? 'Edit' : 'New'} Fusion</h2>
            <label>Fusion Name</label>
            <input type="text" id="fusionName" value="${existingName}" placeholder="Enter name...">
            
            <label>Layers (First = Base, Last = Top)</label>
            <div class="layer-list" id="layerList">
                ${layerItems || '<p style="color:#aaa;text-align:center;">No layers added yet</p>'}
            </div>
            
            <button id="btnAddLayer">Add Image Layer</button>
            <button id="btnAddBase">Set as Base Image</button>
            
            <button id="btnSaveFusion">Save Fusion</button>
            <button class="close-btn" id="btnBack">Back to Menu</button>
        `;
        
        overlay.classList.add('active');
        
        document.getElementById('btnAddLayer').onclick = () => {
            this.addTempLayer(false);
        };
        
        document.getElementById('btnAddBase').onclick = () => {
            this.addTempLayer(true);
        };
        
        document.getElementById('btnSaveFusion').onclick = () => {
            this.saveFusion();
        };
        
        document.getElementById('btnBack').onclick = () => {
            this.showMainMenu();
        };
    },
    
    addTempLayer(asBase) {
        const input = document.getElementById('fileInput');
        input.onchange = (e) => {
            const files = e.target.files;
            if (files.length === 0) return;
            
            Array.from(files).forEach((file, idx) => {
                const url = URL.createObjectURL(file);
                const name = file.name.replace(/\.[^/.]+$/, '');
                
                if (asBase || this.tempLayers.length === 0) {
                    this.tempLayers.unshift({
                        id: 'temp_' + Date.now() + '_' + idx,
                        url,
                        name
                    });
                } else {
                    this.tempLayers.push({
                        id: 'temp_' + Date.now() + '_' + idx,
                        url,
                        name
                    });
                }
            });
            
            this.refreshLayerList();
            input.value = '';
        };
        input.click();
    },
    
    removeTempLayer(index) {
        if (this.tempLayers[index]) {
            this.tempLayers.splice(index, 1);
            this.refreshLayerList();
        }
    },
    
    refreshLayerList() {
        const list = document.getElementById('layerList');
        if (!list) return;
        
        const layerItems = this.tempLayers.map((layer, index) => `
            <div class="layer-item">
                <span>${index + 1}. ${layer.name}</span>
                <button onclick="MenuSystem.removeTempLayer(${index})">Remove</button>
            </div>
        `).join('');
        
        list.innerHTML = layerItems || '<p style="color:#aaa;text-align:center;">No layers added yet</p>';
    },
    
    saveFusion() {
        const name = document.getElementById('fusionName').value.trim();
        if (!name) {
            alert('Please enter a name for your fusion');
            return;
        }
        
        if (this.tempLayers.length === 0) {
            alert('Please add at least one image layer');
            return;
        }
        
        const fusion = {
            id: this.currentEditing || 'fusion_' + Date.now(),
            name,
            layers: this.tempLayers.map(l => ({ url: l.url, name: l.name })),
            createdAt: this.currentEditing ? 
                this.submissions.find(s => s.id === this.currentEditing)?.createdAt : 
                Date.now(),
            updatedAt: Date.now()
        };
        
        if (this.currentEditing) {
            const idx = this.submissions.findIndex(s => s.id === this.currentEditing);
            if (idx !== -1) {
                this.submissions[idx] = fusion;
            }
        } else {
            this.submissions.push(fusion);
        }
        
        this.saveSubmissions();
        this.showFusionCreator();
    },
    
    showSubmissions() {
        const overlay = document.getElementById('menuOverlay');
        const content = document.getElementById('menuContent');
        
        if (this.submissions.length === 0) {
            content.innerHTML = `
                <h2>My Submissions</h2>
                <p style="color:#aaa;text-align:center;margin:20px 0;">No submissions yet</p>
                <button class="close-btn" id="btnBack">Back to Menu</button>
            `;
            
            document.getElementById('btnBack').onclick = () => {
                this.showMainMenu();
            };
        } else {
            const items = this.submissions.map(sub => {
                const date = new Date(sub.createdAt).toLocaleDateString();
                return `
                    <div class="submission-item">
                        <span>${sub.name} (${sub.layers.length} layers)<br><small>${date}</small></span>
                        <div class="buttons">
                            <button onclick="MenuSystem.loadFusionToGame('${sub.id}')">Play</button>
                            <button onclick="MenuSystem.editSubmission('${sub.id}')">Edit</button>
                            <button onclick="MenuSystem.deleteSubmission('${sub.id}')">Delete</button>
                        </div>
                    </div>
                `;
            }).join('');
            
            content.innerHTML = `
                <h2>My Submissions</h2>
                <div class="layer-list">${items}</div>
                <button class="close-btn" id="btnBack">Back to Menu</button>
            `;
            
            document.getElementById('btnBack').onclick = () => {
                this.showMainMenu();
            };
        }
        
        overlay.classList.add('active');
    },
    
    editSubmission(id) {
        this.showFusionCreator(id);
    },
    
    deleteSubmission(id) {
        if (confirm('Delete this submission?')) {
            this.submissions = this.submissions.filter(s => s.id !== id);
            this.saveSubmissions();
            this.showSubmissions();
        }
    },
    
    loadFusionToGame(fusionId) {
        const fusion = this.submissions.find(s => s.id === fusionId);
        if (!fusion) return;
        
        LayeredRenderer.clearAll();
        
        fusion.layers.forEach((layer, index) => {
            LayeredRenderer.addLayer('fusion_' + index, layer.url, index + 1);
        });
        
        const overlay = document.getElementById('menuOverlay');
        overlay.classList.remove('active');
        currentMode = GameMode.GAME;
    }
};

const FusionRenderer = {
    async load() {
        const menuBtn = document.getElementById('btnMenu');
        if (!menuBtn) {
            const menuOverlay = document.getElementById('menuOverlay');
            const content = document.getElementById('menuContent');
            content.innerHTML += '<button id="btnMenu" style="margin-top:20px;">Main Menu</button>';
            document.getElementById('btnMenu').onclick = () => {
                MenuSystem.showMainMenu();
            };
        }
    },
    
    render() {
        if (currentMode === GameMode.MENU) {
            ctx.fillStyle = '#16213e';
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            
            ctx.fillStyle = '#e94560';
            ctx.font = 'bold 48px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Breakaway Hero', GAME_WIDTH / 2, GAME_HEIGHT / 2 - 50);
            
            ctx.fillStyle = '#aaa';
            ctx.font = '20px Arial';
            ctx.fillText('Press any key to start', GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20);
        }
    }
};

MenuSystem.init();

resizeCanvas();
requestAnimationFrame(gameLoop);

LayeredRenderer.addLayer('body', 'images/layer_body.png', 1);
LayeredRenderer.addLayer('outfit', 'images/layer_outfit.png', 2);
LayeredRenderer.addLayer('weapon', 'images/layer_weapon.png', 3);
LayeredRenderer.addLayer('effects', 'images/layer_effects.png', 4);
