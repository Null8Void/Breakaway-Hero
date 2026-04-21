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
    lastTime: 0,
    deltaTime: 0
};

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
    
    ctx.fillStyle = gameState.player.color;
    ctx.beginPath();
    ctx.arc(gameState.player.x, gameState.player.y, gameState.player.size, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#fff';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Arrow Keys / WASD to move', GAME_WIDTH / 2, 40);
    ctx.fillText('Touch: drag to move', GAME_WIDTH / 2, 70);
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

let touchStartX = 0;
let touchStartY = 0;
let isTouching = false;

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    touchStartX = (touch.clientX - rect.left) / scale;
    touchStartY = (touch.clientY - rect.top) / scale;
    isTouching = true;
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!isTouching) return;
    
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const currentX = (touch.clientX - rect.left) / scale;
    const currentY = (touch.clientY - rect.top) / scale;
    
    const dx = currentX - touchStartX;
    const dy = currentY - touchStartY;
    
    gameState.player.x = Math.max(gameState.player.size, Math.min(GAME_WIDTH - gameState.player.size, gameState.player.x + dx));
    gameState.player.y = Math.max(gameState.player.size, Math.min(GAME_HEIGHT - gameState.player.size, gameState.player.y + dy));
    
    touchStartX = currentX;
    touchStartY = currentY;
});

canvas.addEventListener('touchend', () => {
    isTouching = false;
});

window.addEventListener('resize', resizeCanvas);

resizeCanvas();
requestAnimationFrame(gameLoop);
