console.log("[GAME] JavaScript loading...");
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
console.log("[GAME] Canvas initialized");

const BASE_WIDTH = 800;
const BASE_HEIGHT = 600;
let GAME_WIDTH = BASE_WIDTH;
let GAME_HEIGHT = BASE_HEIGHT;

const CENTER_X = BASE_WIDTH / 2;
const CENTER_Y = BASE_HEIGHT / 2;

let scale = 1;
let offsetX = 0;
let offsetY = 0;

function resizeCanvas() {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    GAME_WIDTH = windowWidth < 600 ? windowWidth : Math.min(1200, windowWidth * 0.92);
    GAME_HEIGHT = windowWidth < 600 ? windowHeight : Math.min(1600, windowHeight * 0.92);
    
    const scaleX = windowWidth / BASE_WIDTH;
    const scaleY = windowHeight / BASE_HEIGHT;
    
    scale = Math.min(scaleX, scaleY) * 0.92;
    
    canvas.width = BASE_WIDTH * scale;
    canvas.height = BASE_HEIGHT * scale;
    
    offsetX = (windowWidth - canvas.width) / 2;
    offsetY = (windowHeight - canvas.height) / 2;
    
    canvas.style.marginLeft = offsetX + 'px';
    canvas.style.marginTop = offsetY + 'px';
    
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

const gameState = {
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
    centerX: CENTER_X,
    centerY: CENTER_Y,
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
            const drawX = centerX - dims.width / 2;
            const drawY = centerY - dims.height / 2;
            
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
        
        gameState.layers.dragging = layerId;
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
        
        layer.x = 0;
        layer.y = 0;
        
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
            if (layer) {
                layer.x = 0;
                layer.y = 0;
                layer.detached = false;
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

const SubjectSegmentation = {
    segmenter: null,
    masks: {},
    isReady: false,
    isLoading: false,
    debugMode: false,
    confidenceThreshold: 0.5,
    featherRadius: 10,
    
    async init() {
        if (this.segmenter) return;
        if (this.isLoading) {
            while (this.isLoading) {
                await new Promise(r => setTimeout(r, 100));
            }
            return;
        }
        this.isLoading = true;
        
        try {
            this.segmenter = await bodySegmentation.createSegmenter(
                bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
                { runtime: 'mediapipe', solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation' }
            );
            this.isReady = true;
            console.log('[Segmentation] Model ready');
        } catch (err) {
            console.error('[Segmentation] Model load failed:', err.message || err);
            this.isReady = false;
        }
        this.isLoading = false;
    },
    
    async generateMask(layerId, imageElement, width, height) {
        if (this.debugMode) console.log('[Segmentation] Generating mask for', layerId);
        
        if (!imageElement || !imageElement.complete || !imageElement.naturalWidth || !imageElement.naturalHeight) {
            if (this.debugMode) console.log('[Segmentation] Image not ready');
            return null;
        }
        
        try {
            if (!this.isReady) await this.init();
            if (!this.segmenter) {
                if (this.debugMode) console.log('[Segmentation] No segmenter');
                return null;
            }
            
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = width;
            maskCanvas.height = height;
            const maskCtx = maskCanvas.getContext('2d');
            
            const segmentations = await this.segmenter.segmentPeople(imageElement);
            
            if (!segmentations || segmentations.length === 0) {
                if (this.debugMode) console.log('[Segmentation] No people detected');
                this.masks[layerId] = null;
                return null;
            }
            
            const binaryMask = await bodySegmentation.toBinaryMask(segmentations, 
                { r: 255, g: 255, b: 255, a: 255 },
                { r: 0, g: 0, b: 0, a: 0 },
                false,
                this.confidenceThreshold
            );
            
            let foregroundPixels = 0;
            for (let i = 0; i < binaryMask.data.length; i += 4) {
                if (binaryMask.data[i + 3] > 128) foregroundPixels++;
            }
            
            if (foregroundPixels > 100) {
                maskCtx.putImageData(binaryMask, 0, 0);
                this.applyFeathering(maskCanvas, this.featherRadius);
                this.masks[layerId] = maskCanvas;
            } else {
                this.masks[layerId] = null;
            }
        } catch (err) {
            console.error('[Segmentation] Error:', err.message || err);
            this.masks[layerId] = null;
        }
        
        return this.masks[layerId];
    },
    
    applyFeathering(canvas, radius) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        
        const temp = document.createElement('canvas');
        temp.width = w; temp.height = h;
        const tCtx = temp.getContext('2d');
        tCtx.filter = `blur(${radius}px)`;
        tCtx.drawImage(canvas, 0, 0);
        
        ctx.globalAlpha = 0.4;
        ctx.drawImage(temp, 0, 0);
        ctx.globalAlpha = 1;
    },
    
    getMask(layerId) { return this.masks[layerId] || null; },
    
    isPointInMask(layerId, x, y) {
        const mask = this.masks[layerId];
        if (!mask) return false;
        
        const px = Math.floor(x), py = Math.floor(y);
        if (px < 0 || px >= mask.width || py < 0 || py >= mask.height) return false;
        
        const pixel = mask.getContext('2d').getImageData(px, py, 1, 1).data;
        return pixel[3] > 128;
    },
    
    clearMask(layerId) { delete this.masks[layerId]; },
    clearAll() { this.masks = {}; },
    
    toggleDebug() {
        this.debugMode = !this.debugMode;
        console.log('[Segmentation] Debug mode:', this.debugMode);
        return this.debugMode;
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
    
    initLayerShards(layerId, targetCount) {
        const layer = LayeredRenderer.layers[layerId];
        if (!layer) return;
        
        const dims = LayeredRenderer.getScaledDimensions(layer);
        const width = dims.width;
        const height = dims.height;
        const desiredCount = targetCount || 250;
        
        this.shards[layerId] = { width, height, shards: [], brokenCount: 0, totalCount: 0 };
        const layerShards = this.shards[layerId];
        
        const mask = SubjectSegmentation.getMask(layerId);
        
        const area = width * height;
        const cellArea = area / desiredCount;
        const cellSize = Math.sqrt(cellArea);
        const cols = Math.max(10, Math.ceil(width / cellSize));
        const rows = Math.max(8, Math.ceil(height / cellSize));
        const actualCellW = width / cols;
        const actualCellH = height / rows;
        
        let generated = 0;
        
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const cx = col * actualCellW + actualCellW / 2;
                const cy = row * actualCellH + actualCellH / 2;
                
                if (!SubjectSegmentation.isPointInMask(layerId, cx, cy)) continue;
                
                generated++;
                
                const jitterX = (Math.random() - 0.5) * actualCellW * 0.5;
                const jitterY = (Math.random() - 0.5) * actualCellH * 0.5;
                
                const vertices = [];
                const numPoints = 4 + Math.floor(Math.random() * 4);
                
                for (let i = 0; i < numPoints; i++) {
                    const angle = (i / numPoints) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
                    const radiusVar = 0.4 + Math.random() * 0.3;
                    const radiusX = actualCellW * radiusVar;
                    const radiusY = actualCellH * radiusVar;
                    
                    vertices.push({
                        x: cx + jitterX + Math.cos(angle) * radiusX,
                        y: cy + jitterY + Math.sin(angle) * radiusY
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
        
        if (SubjectSegmentation.debugMode) {
            console.log('[ShardSystem] Generated:', generated, 'shards');
            if (generated === 0) console.log('[ShardSystem] WARNING: No shards in mask!');
        }
        
        const hitTestCache = {};
        layerShards.shards.forEach(shard => {
            this.calculateShardBounds(shard);
            hitTestCache[shard.id] = shard;
        });
        
        layerShards.hitTestCache = hitTestCache;
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
    
    carveAtPoint(layerId, pointX, pointY, brushRadius) {
        const layer = LayeredRenderer.layers[layerId];
        if (!layer || !layer.image || !this.shards[layerId]) return false;
        
        const dims = LayeredRenderer.getScaledDimensions(layer);
        const centerX = BASE_WIDTH / 2;
        const centerY = BASE_HEIGHT / 2;
        const layerDrawX = centerX - dims.width / 2;
        const layerDrawY = centerY - dims.height / 2;
        
        const layerShards = this.shards[layerId];
        let carved = false;
        
        for (let i = 0; i < layerShards.shards.length; i++) {
            const shard = layerShards.shards[i];
            if (shard.broken) continue;
            
            const shardCenterX = layerDrawX + shard.x;
            const shardCenterY = layerDrawY + shard.y;
            
            const dx = Math.abs(pointX - shardCenterX);
            const dy = Math.abs(pointY - shardCenterY);
            
            if (dx < brushRadius && dy < brushRadius) {
                this.breakShard(layerId, shard, layerDrawX, layerDrawY, dims);
                layerShards.brokenCount++;
                carved = true;
            }
        }
        
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
        
        const baseColorR = 25;
        const baseColorG = 25;
        const baseColorB = 30;
        
        const globalGrad = ctx.createLinearGradient(layerDrawX, layerDrawY, layerDrawX, layerDrawY + dims.height);
        globalGrad.addColorStop(0, `rgba(${baseColorR + 15}, ${baseColorG + 15}, ${baseColorB + 20}, 1)`);
        globalGrad.addColorStop(0.5, `rgba(${baseColorR}, ${baseColorG}, ${baseColorB}, 1)`);
        globalGrad.addColorStop(1, `rgba(${baseColorR}, ${baseColorG - 5}, ${baseColorB - 5}, 1)`);
        
        layerShards.shards.forEach(shard => {
            if (shard.broken) return;
            
            ctx.save();
            
            const shardCenterX = layerDrawX + shard.x;
            const shardCenterY = layerDrawY + shard.y;
            
            const shardGrad = ctx.createLinearGradient(
                shardCenterX - shard.width / 2,
                shardCenterY - shard.height / 2,
                shardCenterX + shard.width / 2,
                shardCenterY + shard.height / 2
            );
            shardGrad.addColorStop(0, 'rgba(45, 45, 55, 1)');
            shardGrad.addColorStop(0.5, 'rgba(30, 30, 38, 1)');
            shardGrad.addColorStop(1, 'rgba(20, 20, 28, 1)');
            
            ctx.beginPath();
            ctx.moveTo(layerDrawX + shard.vertices[0].x, layerDrawY + shard.vertices[0].y);
            for (let i = 1; i < shard.vertices.length; i++) {
                ctx.lineTo(layerDrawX + shard.vertices[i].x, layerDrawY + shard.vertices[i].y);
            }
            ctx.closePath();
            
            ctx.fillStyle = shardGrad;
            ctx.fill();
            
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            
            ctx.strokeStyle = 'rgba(60, 60, 80, 0.6)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
            
            ctx.shadowColor = 'transparent';
            
            ctx.fillStyle = 'rgba(100, 100, 120, 0.15)';
            ctx.beginPath();
            ctx.moveTo(layerDrawX + shard.vertices[0].x, layerDrawY + shard.vertices[0].y);
            for (let i = 1; i < shard.vertices.length; i++) {
                ctx.lineTo(layerDrawX + shard.vertices[i].x, layerDrawY + shard.vertices[i].y);
            }
            ctx.closePath();
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
            
            const fragGrad = ctx.createLinearGradient(-frag.width/2, -frag.height/2, frag.width/2, frag.height/2);
            fragGrad.addColorStop(0, 'rgba(45, 45, 55, 1)');
            fragGrad.addColorStop(0.5, 'rgba(30, 30, 38, 1)');
            fragGrad.addColorStop(1, 'rgba(20, 20, 28, 1)');
            
            ctx.beginPath();
            ctx.moveTo(frag.vertices[0].x - frag.offsetX - frag.width/2, frag.vertices[0].y - frag.offsetY - frag.height/2);
            for (let i = 1; i < frag.vertices.length; i++) {
                ctx.lineTo(frag.vertices[i].x - frag.offsetX - frag.width/2, frag.vertices[i].y - frag.offsetY - frag.height/2);
            }
            ctx.closePath();
            
            ctx.fillStyle = fragGrad;
            ctx.fill();
            
            ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
            ctx.shadowBlur = 6;
            ctx.shadowOffsetX = 3;
            ctx.shadowOffsetY = 3;
            
            ctx.strokeStyle = 'rgba(70, 70, 90, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            ctx.shadowColor = 'transparent';
            
            ctx.fillStyle = 'rgba(120, 120, 140, 0.2)';
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
    const now = performance.now();
    if (now - lastNavTime > 200) {
        if (gameState.keys['ArrowRight'] || gameState.keys['d']) {
            CharacterLoader.nextCharacter();
            lastNavTime = now;
        } else if (gameState.keys['ArrowLeft'] || gameState.keys['a']) {
            CharacterLoader.previousCharacter();
            lastNavTime = now;
        }
    }
    
    FragmentSystem.update(dt);
}

function render() {
    ctx.fillStyle = '#16213e';
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    
    ctx.fillStyle = '#0f3460';
    for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 8; j++) {
            if ((i + j) % 2 === 0) {
                ctx.fillRect(i * 80, j * 75, 80, 75);
            }
        }
    }
    
    const centerX = BASE_WIDTH / 2;
    const centerY = BASE_HEIGHT / 2;
    const maxWidth = LayeredRenderer.defaultMaxWidth;
    const maxHeight = LayeredRenderer.defaultMaxHeight;
    
    if (LayeredRenderer.getLayerCount() > 0) {
        LayeredRenderer.renderLayers(centerX, centerY);
        FragmentSystem.render();
        
        const char = CharacterLoader.currentCharacter;
        if (char) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(char, centerX, centerY + maxHeight / 2 + 40);
            
            ctx.font = '16px Arial';
            ctx.fillStyle = '#aaa';
            const detachedCount = LayeredRenderer.getDetachedCount();
            const layerInfo = `Layers: ${LayeredRenderer.getLayerCount()} | Detached: ${detachedCount}`;
            ctx.fillText(layerInfo, centerX, centerY + maxHeight / 2 + 70);
            ctx.fillText('Press R to restore | Press L to load image', centerX, centerY + maxHeight / 2 + 95);
        }
    } else {
        ctx.fillStyle = '#fff';
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No layers loaded', centerX, centerY);
        ctx.fillText('Use LayeredRenderer.addLayer()', centerX, centerY + 30);
    }
    
    if (gameState.input.active) {
        ctx.fillStyle = '#00ff88';
        ctx.beginPath();
        ctx.arc(gameState.input.currentX, gameState.input.currentY, 3, 0, Math.PI * 2);
        ctx.fill();
    }
    
    ctx.fillStyle = '#fff';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Arrow Keys / WASD to move', GAME_WIDTH / 2, 40);
    ctx.fillText('Click or Touch to carve', BASE_WIDTH / 2, 40);
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
    if (currentMode === GameMode.MENU) {
        currentMode = GameMode.GAME;
        document.getElementById('menuOverlay')?.classList.remove('active');
    }
    
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
    
    if (e.key === ']' || e.key === '}') {
        CharacterLoader.nextCharacter();
    }
    
    if (e.key === '[' || e.key === '{') {
        CharacterLoader.previousCharacter();
    }
    
    if (e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;
        CharacterLoader.loadCharacter(index);
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
        
        const gamePos = screenToGame(x, y);
        const dims = LayeredRenderer.getScaledDimensions(layer);
        const layerDrawX = LayeredRenderer.centerX - dims.width / 2;
        const layerDrawY = LayeredRenderer.centerY - dims.height / 2;
        const localX = gamePos.x - layerDrawX;
        const localY = gamePos.y - layerDrawY;
        
        if (!SubjectSegmentation.isPointInMask(layerId, localX, localY)) {
            gameState.input.active = false;
            return;
        }
        
        if (!FragmentSystem.shards || !FragmentSystem.shards[layerId]) {
            FragmentSystem.initLayerShards(layerId);
        }
        
        gameState.input.active = true;
        gameState.layers.dragging = layerId;
        
        FragmentSystem.carveAtPoint(layerId, gamePos.x, gamePos.y, 15);
    }
}

function handleInputMove(x, y) {
    if (!gameState.input.active) return;
    
    const currentGamePos = screenToGame(x, y);
    
    if (gameState.layers.dragging) {
        const layerId = gameState.layers.dragging;
        const layer = LayeredRenderer.getLayer(layerId);
        
        if (layer && !layer.destroyed && FragmentSystem.shards && FragmentSystem.shards[layerId]) {
            if (gameState.input.lastX !== undefined) {
                const prevX = gameState.input.lastX;
                const prevY = gameState.input.lastY;
                const currX = currentGamePos.x;
                const currY = currentGamePos.y;
                
                const distance = Math.sqrt((currX - prevX) ** 2 + (currY - prevY) ** 2);
                const steps = Math.max(1, Math.floor(distance / 8));
                
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    const interpX = prevX + (currX - prevX) * t;
                    const interpY = prevY + (currY - prevY) * t;
                    FragmentSystem.carveAtPoint(layerId, interpX, interpY, 10);
                }
            } else {
                FragmentSystem.carveAtPoint(layerId, currentGamePos.x, currentGamePos.y, 15);
            }
        }
    }
    
    gameState.input.lastX = currentGamePos.x;
    gameState.input.lastY = currentGamePos.y;
}

function handleInputEnd() {
    if (gameState.layers.dragging) {
        LayeredRenderer.endDrag();
    }
    gameState.input.active = false;
    gameState.input.lastX = undefined;
    gameState.input.lastY = undefined;
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

let currentMode = GameMode.GAME;

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
            <button id="btnCharacters">Characters</button>
            <button id="btnFusion">Fusion Creator</button>
            <button id="btnSubmissions">My Submissions</button>
            <button class="close-btn" id="btnClose">Close Menu</button>
        `;
        
        overlay.classList.add('active');
        
        document.getElementById('btnPlay').onclick = () => {
            overlay.classList.remove('active');
            currentMode = GameMode.GAME;
        };
        
        document.getElementById('btnCharacters').onclick = () => {
            this.showCharacters();
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
    
    showCharacters() {
        const overlay = document.getElementById('menuOverlay');
        const content = document.getElementById('menuContent');
        const characters = CharacterManager.getAll();
        
        if (characters.length === 0) {
            content.innerHTML = `
                <h2>Characters</h2>
                <p style="color:#aaa;text-align:center;margin:20px 0;">No characters found</p>
                <button class="close-btn" id="btnBack">Back to Menu</button>
            `;
            
            document.getElementById('btnBack').onclick = () => {
                this.showMainMenu();
            };
            return;
        }
        
        let charItems = characters.map((char, index) => `
            <div class="layer-item">
                <span>${index + 1}. ${char.name}</span>
                <button onclick="MenuSystem.selectCharacter('${char.id}')">Select</button>
            </div>
        `).join('');
        
        content.innerHTML = `
            <h2>Select Character</h2>
            <div class="layer-list" style="max-height:250px;">${charItems}</div>
            <div class="character-nav">
                <button id="btnPrevChar" style="flex:1;">Previous</button>
                <button id="btnNextChar" style="flex:1;">Next</button>
            </div>
            <button class="close-btn" id="btnBack">Back to Menu</button>
        `;
        
        document.getElementById('btnPrevChar').onclick = () => {
            CharacterLoader.previousCharacter();
        };
        
        document.getElementById('btnNextChar').onclick = () => {
            CharacterLoader.nextCharacter();
        };
        
        document.getElementById('btnBack').onclick = () => {
            this.showMainMenu();
        };
    },
    
    selectCharacter(id) {
        const overlay = document.getElementById('menuOverlay');
        const char = CharacterManager.getById(id);
        
        if (char) {
            CharacterLoader.load(char.name, char.imagePath);
            overlay.classList.remove('active');
            currentMode = GameMode.GAME;
        }
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
            ctx.fillText('Breakaway Hero', BASE_WIDTH / 2, BASE_HEIGHT / 2 - 50);
            
            ctx.fillStyle = '#aaa';
            ctx.font = '20px Arial';
            ctx.fillText('Press any key to start', BASE_WIDTH / 2, BASE_HEIGHT / 2 + 20);
        }
    }
};

setTimeout(() => {
    MenuSystem.showMainMenu();
}, 500);

const CharacterManager = {
    characters: [],
    loaded: false,
    defaultPath: 'data/characters.json',
    
    async load(path) {
        try {
            const response = await fetch(path || this.defaultPath);
            if (!response.ok) throw new Error('Failed to load characters');
            this.characters = await response.json();
            this.loaded = true;
            console.log(`Loaded ${this.characters.length} characters`);
            return this.characters;
        } catch (err) {
            console.warn('Character data not found, using empty list');
            this.characters = [];
            this.loaded = true;
            return [];
        }
    },
    
    getAll() {
        return this.characters;
    },
    
    getById(id) {
        return this.characters.find(c => c.id === id);
    },
    
    getByCategory(category) {
        return this.characters.filter(c => c.category === category);
    },
    
    getByTag(tag) {
        return this.characters.filter(c => c.tags && c.tags.includes(tag));
    },
    
    getCount() {
        return this.characters.length;
    },
    
    addCharacter(character) {
        this.characters.push(character);
    },
    
    removeCharacter(id) {
        this.characters = this.characters.filter(c => c.id !== id);
    }
};

const CharacterLoader = {
    currentCharacter: null,
    
    loadCharacter(identifier) {
        let character = null;
        
        if (typeof identifier === 'number') {
            const chars = CharacterManager.getAll();
            character = chars[identifier];
        } else if (typeof identifier === 'string') {
            character = CharacterManager.getById(identifier);
            if (!character) {
                const chars = CharacterManager.getAll();
                character = chars.find(c => c.name.toLowerCase() === identifier.toLowerCase());
            }
        }
        
        if (!character) {
            console.warn('Character not found:', identifier);
            return false;
        }
        
        this.load(character.name, character.imagePath);
        return true;
    },
    
    nextCharacter() {
        const chars = CharacterManager.getAll();
        if (chars.length === 0) return false;
        
        const currentIndex = this.currentCharacter ? 
            chars.findIndex(c => c.name === this.currentCharacter) : -1;
        const nextIndex = (currentIndex + 1) % chars.length;
        
        return this.loadCharacter(nextIndex);
    },
    
    previousCharacter() {
        const chars = CharacterManager.getAll();
        if (chars.length === 0) return false;
        
        const currentIndex = this.currentCharacter ? 
            chars.findIndex(c => c.name === this.currentCharacter) : 0;
        const prevIndex = (currentIndex - 1 + chars.length) % chars.length;
        
        return this.loadCharacter(prevIndex);
    },
    
    load(characterName, imageUrl) {
        this.clearAll();
        
        this.currentCharacter = characterName;
        
        LayeredRenderer.addLayer('character_base', imageUrl, 1);
        
        setTimeout(async () => {
            let retries = 0;
            const trySegment = async () => {
                const layer = LayeredRenderer.getLayer('character_base');
                if (layer && layer.loaded && layer.image && layer.image.complete && layer.image.naturalWidth > 0) {
                    const dims = LayeredRenderer.getScaledDimensions(layer);
                    await SubjectSegmentation.generateMask('character_base', layer.image, dims.width, dims.height);
                    FragmentSystem.initLayerShards('character_base');
                } else if (retries < 10) {
                    retries++;
                    setTimeout(trySegment, 200);
                }
            };
            trySegment();
        }, 200);
    },
    
    loadFromFile(file) {
        this.clearAll();
        
        this.currentCharacter = file.name.replace(/\.[^/.]+$/, '');
        
        const url = URL.createObjectURL(file);
        
        LayeredRenderer.addLayer('character_base', url, 1);
        
        setTimeout(async () => {
            let retries = 0;
            const trySegment = async () => {
                const layer = LayeredRenderer.getLayer('character_base');
                if (layer && layer.loaded && layer.image && layer.image.complete && layer.image.naturalWidth > 0) {
                    const dims = LayeredRenderer.getScaledDimensions(layer);
                    await SubjectSegmentation.generateMask('character_base', layer.image, dims.width, dims.height);
                    FragmentSystem.initLayerShards('character_base');
                } else if (retries < 10) {
                    retries++;
                    setTimeout(trySegment, 200);
                }
            };
            trySegment();
        }, 200);
    },
    
    clearAll() {
        FragmentSystem.clear();
        FragmentSystem.shards = {};
        SubjectSegmentation.clearMask('character_base');
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

window.onerror = function(message, source, lineno, colno, error) {
    console.error("[Global Error]", message, "at line", lineno);
    return false;
};

console.log("[Init] Starting...");
try {
    console.log("[Init] CharacterLoader:", typeof CharacterLoader);
    console.log("[Init] LayeredRenderer:", typeof LayeredRenderer);
    console.log("[Init] SubjectSegmentation:", typeof SubjectSegmentation);
} catch (e) {
    console.error("[Init] Error:", e.message);
}
console.log("[Init] LayeredRenderer defined:", typeof LayeredRenderer !== 'undefined');
console.log("[Init] SubjectSegmentation defined:", typeof SubjectSegmentation !== 'undefined');

document.getElementById('menuOverlay')?.classList.remove('active');

requestAnimationFrame(() => {
    console.log("[Init] First frame");
    console.log("[Init] CharacterLoader type:", typeof CharacterLoader);
    if (typeof CharacterLoader === 'undefined') {
        console.error("[Init] CharacterLoader is MISSING!");
    }
});

setTimeout(() => {
    console.log("[Init] After 1s - CharacterLoader:", typeof CharacterLoader);
    console.log("[Init] After 1s - currentMode:", currentMode);
}, 1000);

const tfReady = setInterval(() => {
    if (typeof bodySegmentation !== 'undefined') {
        clearInterval(tfReady);
        console.log('[TensorFlow] Libraries loaded');
        CharacterManager.load().catch(() => {});
    }
}, 100);

setTimeout(() => {
    clearInterval(tfReady);
    CharacterManager.load().catch(() => {});
    console.log('[Segmentation] Ready:', SubjectSegmentation.isReady);
}, 2000);

setTimeout(() => {
    const chars = CharacterManager.getAll();
    if (chars && chars.length > 0) {
        CharacterLoader.load(chars[0].name, chars[0].url);
    }
}, 2500);

console.log("[GAME] Initialization complete");
