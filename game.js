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
            if (layer && layer.image) {
                const dims = this.getScaledDimensions(layer);
                const drawX = centerX - dims.width / 2 + layer.x;
                const drawY = centerY - dims.height / 2 + layer.y;
                
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
            if (!layer || !layer.image) continue;
            
            const dims = this.getScaledDimensions(layer);
            const drawX = centerX - dims.width / 2 + layer.x;
            const drawY = centerY - dims.height / 2 + layer.y;
            
            if (gamePos.x >= drawX && gamePos.x <= drawX + dims.width &&
                gamePos.y >= drawY && gamePos.y <= drawY + dims.height) {
                return layerId;
            }
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
            if (layer && layer.detached) {
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
            ctx.fillText('Drag layer > 20px to detach | Release to reattach', centerX, centerY + maxHeight / 2 + 95);
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
    
    update(gameState.deltaTime);
    render();
    
    requestAnimationFrame(gameLoop);
}

window.addEventListener('keydown', (e) => {
    gameState.keys[e.key] = true;
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
        LayeredRenderer.startDrag(layerId, x, y);
        gameState.input.active = true;
        gameState.input.startX = x;
        gameState.input.startY = y;
        gameState.input.currentX = x;
        gameState.input.currentY = y;
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
        LayeredRenderer.updateDrag(x, y);
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

resizeCanvas();
requestAnimationFrame(gameLoop);

LayeredRenderer.addLayer('body', 'images/layer_body.png', 1);
LayeredRenderer.addLayer('outfit', 'images/layer_outfit.png', 2);
LayeredRenderer.addLayer('weapon', 'images/layer_weapon.png', 3);
LayeredRenderer.addLayer('effects', 'images/layer_effects.png', 4);
