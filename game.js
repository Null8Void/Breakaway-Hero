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
            
            ctx.drawImage(layer.image, drawX, drawY, dims.width, dims.height);
            
            if (FragmentSystem.shards && FragmentSystem.shards[layerId]) {
                FragmentSystem.renderLayerShards(layerId);
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
                
                if (FragmentSystem.shards && FragmentSystem.shards[layerId]) {
                    const layerShards = FragmentSystem.shards[layerId];
                    const localX = gamePos.x - drawX;
                    const localY = gamePos.y - drawY;
                    
                    let hitShard = false;
                    for (const shard of layerShards.shards) {
                        if (shard.broken) continue;
                        
                        if (FragmentSystem.pointInPolygon(localX, localY, shard.vertices)) {
                            hitShard = true;
                            break;
                        }
                    }
                    
                    if (hitShard) {
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

const VoronoiShardSystem = {
    shards: {},
    shardCount: 300,
    maxFragments: 200,
    gravity: 500,
    fragments: [],
    
    generateVoronoiPoints(width, height, count) {
        const points = [];
        const padding = 30;
        
        for (let i = 0; i < count; i++) {
            points.push({
                x: padding + Math.random() * (width - padding * 2),
                y: padding + Math.random() * (height - padding * 2)
            });
        }
        
        return points;
    },
    
    generateCellPoints(centerX, centerY, allPoints, width, height) {
        const baseSize = Math.min(width, height) * 0.4;
        const radius = baseSize * (0.5 + Math.random() * 0.5);
        const numVertices = 3 + Math.floor(Math.random() * 5);
        const angleStep = (Math.PI * 2) / numVertices;
        
        const vertices = [];
        for (let i = 0; i < numVertices; i++) {
            const angle = i * angleStep + (Math.random() - 0.5) * angleStep * 0.6;
            const r = radius * (0.5 + Math.random() * 0.5);
            vertices.push({
                x: centerX + Math.cos(angle) * r,
                y: centerY + Math.sin(angle) * r
            });
        }
        
        return vertices;
    },
    
    generateEdgeShards(width, height, cellPoints, points) {
        const edgeShards = [];
        const margin = 25;
        
        const leftPoints = points.filter(p => p.x < margin);
        const rightPoints = points.filter(p => p.x > width - margin);
        const topPoints = points.filter(p => p.y < margin);
        const bottomPoints = points.filter(p => p.y > height - margin);
        
        if (leftPoints.length > 0) {
            const minY = Math.min(...leftPoints.map(p => p.y));
            const maxY = Math.max(...leftPoints.map(p => p.y));
            edgeShards.push({
                x: 0, y: minY, width: margin, height: maxY - minY,
                vertices: [{x:0,y:minY},{x:margin,y:minY},{x:margin,y:maxY},{x:0,y:maxY}]
            });
        }
        
        if (rightPoints.length > 0) {
            const minY = Math.min(...rightPoints.map(p => p.y));
            const maxY = Math.max(...rightPoints.map(p => p.y));
            edgeShards.push({
                x: width - margin, y: minY, width: margin, height: maxY - minY,
                vertices: [{x:width-margin,y:minY},{x:width,y:minY},{x:width,y:maxY},{x:width-margin,y:maxY}]
            });
        }
        
        if (topPoints.length > 0) {
            const minX = Math.min(...topPoints.map(p => p.x));
            const maxX = Math.max(...topPoints.map(p => p.x));
            edgeShards.push({
                x: minX, y: 0, width: maxX - minX, height: margin,
                vertices: [{x:minX,y:0},{x:maxX,y:0},{x:maxX,y:margin},{x:minX,y:margin}]
            });
        }
        
        if (bottomPoints.length > 0) {
            const minX = Math.min(...bottomPoints.map(p => p.x));
            const maxX = Math.max(...bottomPoints.map(p => p.x));
            edgeShards.push({
                x: minX, y: height - margin, width: maxX - minX, height: margin,
                vertices: [{x:minX,y:height-margin},{x:maxX,y:height-margin},{x:maxX,y:height},{x:minX,y:height}]
            });
        }
        
        return edgeShards;
    },
    
    initLayerShards(layerId) {
        const layer = LayeredRenderer.layers[layerId];
        if (!layer) return;
        
        const dims = LayeredRenderer.getScaledDimensions(layer);
        const width = dims.width;
        const height = dims.height;
        
        this.shards[layerId] = {
            width,
            height,
            shards: [],
            brokenCount: 0,
            totalCount: 0
        };
        
        const layerShards = this.shards[layerId];
        
        const cellSize = Math.max(30, Math.min(width, height) / 15);
        const cols = Math.ceil(width / cellSize);
        const rows = Math.ceil(height / cellSize);
        
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const cx = col * cellSize + cellSize / 2;
                const cy = row * cellSize + cellSize / 2;
                
                const jitterX = (Math.random() - 0.5) * cellSize * 0.7;
                const jitterY = (Math.random() - 0.5) * cellSize * 0.7;
                
                const vertices = [];
                const numPoints = 4 + Math.floor(Math.random() * 3);
                
                for (let i = 0; i < numPoints; i++) {
                    const angle = (i / numPoints) * Math.PI * 2 + Math.random() * 0.5;
                    const radiusVariation = 0.6 + Math.random() * 0.4;
                    const radius = cellSize * 0.6 * radiusVariation;
                    vertices.push({
                        x: cx + jitterX + Math.cos(angle) * radius,
                        y: cy + jitterY + Math.sin(angle) * radius
                    });
                }
                
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                vertices.forEach(v => {
                    minX = Math.min(minX, v.x);
                    minY = Math.min(minY, v.y);
                    maxX = Math.max(maxX, v.x);
                    maxY = Math.max(maxY, v.y);
                });
                
                layerShards.shards.push({
                    id: 'shard_' + row + '_' + col,
                    vertices,
                    x: (minX + maxX) / 2,
                    y: (minY + maxY) / 2,
                    width: maxX - minX,
                    height: maxY - minY,
                    broken: false
                });
            }
        }
        
        layerShards.totalCount = layerShards.shards.length;
        
        layerShards.shards.forEach(shard => {
            this.calculateShardBounds(shard);
        });
    },
    
    calculateShardBounds(shard) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        shard.vertices.forEach(v => {
            minX = Math.min(minX, v.x);
            minY = Math.min(minY, v.y);
            maxX = Math.max(maxX, v.x);
            maxY = Math.max(maxY, v.y);
        });
        shard.bounds = { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    },
    
    pointInPolygon(px, py, vertices) {
        let inside = false;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            const xi = vertices[i].x, yi = vertices[i].y;
            const xj = vertices[j].x, yj = vertices[j].y;
            
            if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    },
    
    carveArea(layerId, startX, startY, endX, endY) {
        const layer = LayeredRenderer.layers[layerId];
        if (!layer || !layer.image || !this.shards[layerId]) return;
        
        const dims = LayeredRenderer.getScaledDimensions(layer);
        const centerX = LayeredRenderer.centerX;
        const centerY = LayeredRenderer.centerY;
        const layerDrawX = centerX - dims.width / 2 + layer.x;
        const layerDrawY = centerY - dims.height / 2 + layer.y;
        
        const minX = Math.min(startX, endX);
        const minY = Math.min(startY, endY);
        const maxX = Math.max(startX, endX);
        const maxY = Math.max(startY, endY);
        
        const layerShards = this.shards[layerId];
        let carved = false;
        
        layerShards.shards.forEach(shard => {
            if (shard.broken) return;
            
            const shardScreenX = layerDrawX + shard.bounds.minX;
            const shardScreenY = layerDrawY + shard.bounds.minY;
            
            if (shardScreenX + shard.bounds.width < minX || shardScreenX > maxX ||
                shardScreenY + shard.bounds.height < minY || shardScreenY > maxY) {
                return;
            }
            
            for (let i = shard.bounds.minX; i <= shard.bounds.maxX; i += 5) {
                for (let j = shard.bounds.minY; j <= shard.bounds.maxY; j += 5) {
                    const testX = layerDrawX + i;
                    const testY = layerDrawY + j;
                    
                    if (testX >= minX && testX <= maxX && testY >= minY && testY <= maxY) {
                        if (this.pointInPolygon(i, j, shard.vertices)) {
                            this.breakShard(layerId, shard, layerDrawX, layerDrawY, dims);
                            layerShards.brokenCount++;
                            carved = true;
                            return;
                        }
                    }
                }
            }
        });
        
        if (layerShards.brokenCount >= layerShards.totalCount) {
            this.destroyLayer(layerId);
        }
        
        return carved;
    },
    
    breakShard(layerId, shard, layerDrawX, layerDrawY, dims) {
        shard.broken = true;
        
        const shardWorldX = layerDrawX + shard.bounds.minX;
        const shardWorldY = layerDrawY + shard.bounds.minY;
        
        if (this.fragments.length >= this.maxFragments) {
            this.fragments.shift();
        }
        
        this.fragments.push({
            layerId,
            vertices: shard.vertices.map(v => ({ x: v.x, y: v.y })),
            x: shardWorldX + shard.bounds.width / 2,
            y: shardWorldY + shard.bounds.height / 2,
            width: shard.bounds.width,
            height: shard.bounds.height,
            offsetX: shard.bounds.minX,
            offsetY: shard.bounds.minY,
            vx: (Math.random() - 0.5) * 200,
            vy: (Math.random() - 0.5) * 200 - 80,
            rotation: Math.random() * Math.PI * 2,
            angularVel: (Math.random() - 0.5) * 6,
            alpha: 1,
            lifetime: 0,
            maxLifetime: 2.5 + Math.random() * 1.5
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
        this.shards[layerId] = null;
        this.initLayerShards(layerId);
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
                frag.alpha -= dt * 0.6;
            }
            
            if (frag.y > GAME_HEIGHT + 100 || frag.alpha <= 0) {
                this.fragments.splice(i, 1);
            }
        }
    },
    
    renderLayerShards(layerId) {
        const layer = LayeredRenderer.layers[layerId];
        if (!layer || !layer.image || layer.destroyed || !this.shards[layerId]) return;
        
        const dims = LayeredRenderer.getScaledDimensions(layer);
        const centerX = LayeredRenderer.centerX;
        const centerY = LayeredRenderer.centerY;
        const layerDrawX = centerX - dims.width / 2 + layer.x;
        const layerDrawY = centerY - dims.height / 2 + layer.y;
        
        const layerShards = this.shards[layerId];
        
        const gradient = ctx.createLinearGradient(layerDrawX, layerDrawY, layerDrawX + dims.width, layerDrawY + dims.height);
        gradient.addColorStop(0, 'rgba(40, 40, 50, 0.95)');
        gradient.addColorStop(0.5, 'rgba(30, 30, 40, 0.95)');
        gradient.addColorStop(1, 'rgba(20, 20, 30, 0.95)');
        
        layerShards.shards.forEach(shard => {
            if (shard.broken) return;
            
            ctx.save();
            
            ctx.beginPath();
            ctx.moveTo(layerDrawX + shard.vertices[0].x, layerDrawY + shard.vertices[0].y);
            for (let i = 1; i < shard.vertices.length; i++) {
                ctx.lineTo(layerDrawX + shard.vertices[i].x, layerDrawY + shard.vertices[i].y);
            }
            ctx.closePath();
            
            ctx.fillStyle = gradient;
            ctx.fill();
            
            ctx.strokeStyle = 'rgba(80, 80, 100, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            ctx.restore();
        });
    },
    
    render() {
        for (const frag of this.fragments) {
            ctx.save();
            ctx.globalAlpha = frag.alpha;
            
            const cx = frag.x;
            const cy = frag.y;
            
            ctx.translate(cx, cy);
            ctx.rotate(frag.rotation);
            
            const gradient = ctx.createLinearGradient(-frag.width/2, -frag.height/2, frag.width/2, frag.height/2);
            gradient.addColorStop(0, 'rgba(40, 40, 50, 0.95)');
            gradient.addColorStop(1, 'rgba(20, 20, 30, 0.95)');
            
            ctx.beginPath();
            ctx.moveTo(frag.vertices[0].x - frag.offsetX - frag.width/2, frag.vertices[0].y - frag.offsetY - frag.height/2);
            for (let i = 1; i < frag.vertices.length; i++) {
                ctx.lineTo(frag.vertices[i].x - frag.offsetX - frag.width/2, frag.vertices[i].y - frag.offsetY - frag.height/2);
            }
            ctx.closePath();
            
            ctx.fillStyle = gradient;
            ctx.fill();
            
            ctx.strokeStyle = 'rgba(80, 80, 100, 0.5)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
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

const FragmentSystem = VoronoiShardSystem;

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
        if (CharacterLoader.currentCharacter) {
            CharacterLoader.reset();
        } else {
            const draggingLayerId = LayeredRenderer.getDraggingLayer();
            if (draggingLayerId) {
                FragmentSystem.restoreLayer(draggingLayerId);
            } else {
                FragmentSystem.restoreAllLayers();
            }
        }
    }
    
    if (e.key === 'l' || e.key === 'L') {
        document.getElementById('charFileInput').click();
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
        
        if (!FragmentSystem.shards || !FragmentSystem.shards[layerId]) {
            FragmentSystem.initLayerShards(layerId);
        }
        
        LayeredRenderer.startDrag(layerId, x, y);
        gameState.input.active = true;
        gameState.input.startX = x;
        gameState.input.startY = y;
        gameState.input.currentX = x;
        gameState.input.currentY = y;
        
        const gamePos = screenToGame(x, y);
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
            if (!FragmentSystem.shards || !FragmentSystem.shards[layerId]) {
                FragmentSystem.initLayerShards(layerId);
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

const CharacterLoader = {
    currentCharacter: null,
    
    load(characterName, imageUrl) {
        this.clearAll();
        
        this.currentCharacter = characterName;
        
        LayeredRenderer.addLayer('character_base', imageUrl, 1);
        
        setTimeout(() => {
            const layer = LayeredRenderer.getLayer('character_base');
            if (layer && layer.loaded) {
                FragmentSystem.initLayerShards('character_base');
            }
        }, 100);
    },
    
    loadFromFile(file) {
        this.clearAll();
        
        this.currentCharacter = file.name.replace(/\.[^/.]+$/, '');
        
        const url = URL.createObjectURL(file);
        
        LayeredRenderer.addLayer('character_base', url, 1);
        
        setTimeout(() => {
            const layer = LayeredRenderer.getLayer('character_base');
            if (layer && layer.loaded) {
                FragmentSystem.initLayerShards('character_base');
            }
        }, 100);
    },
    
    clearAll() {
        FragmentSystem.clear();
        FragmentSystem.shards = {};
        LayeredRenderer.clearAll();
        this.currentCharacter = null;
    },
    
    reset() {
        if (this.currentCharacter) {
            const layer = LayeredRenderer.getLayer('character_base');
            if (layer) {
                FragmentSystem.restoreLayer('character_base');
            }
        }
    }
};

resizeCanvas();
requestAnimationFrame(gameLoop);

LayeredRenderer.addLayer('body', 'images/layer_body.png', 1);
LayeredRenderer.addLayer('outfit', 'images/layer_outfit.png', 2);
LayeredRenderer.addLayer('weapon', 'images/layer_weapon.png', 3);
LayeredRenderer.addLayer('effects', 'images/layer_effects.png', 4);
