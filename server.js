// server.js
// 載入必要的函式庫
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- 遊戲狀態變數 ---
let classLayout = { rows: 0, cols: 0 };
let players = {}; // 儲存 { socket.id: seatNumber }
let gameState = {
    mode: 'all', // 'all', 'cross', 'square'
    activeZone: [], // 可搶答的座號
    lockedZone: [], // 禁答的座號
    buzzesOpen: false
};

// --- 靜態檔案服務 ---
// 讓伺服器可以提供 host.html 和 player.html
app.use(express.static(__dirname));

app.get('/host', (req, res) => {
    res.sendFile(__dirname + '/host.html');
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/player.html');
});

// --- Socket.io 核心邏輯 ---
io.on('connection', (socket) => {
    console.log('一個使用者連線了:', socket.id);

    // --- 老師 (Host) 的事件 ---
    socket.on('host:createGame', (layout) => {
        classLayout = layout;
        players = {}; // 重設玩家
        console.log('遊戲已建立:', classLayout);
        // 可以在這裡廣播給所有玩家，遊戲已重設
    });

    socket.on('host:setMode', (data) => {
        // data = { mode: 'cross', target: 25 }
        const { rows, cols } = classLayout;
        const totalSeats = rows * cols;
        let active = [];
        let locked = [];

        if (data.mode === 'all' || !data.target) {
            active = Array.from({ length: totalSeats }, (_, i) => i + 1);
            locked = [];
        } else if (data.mode === 'cross') {
            active = calculateBigCross(data.target, rows, cols);
        } else if (data.mode === 'square') {
            active = calculateNineSquare(data.target, rows, cols);
        }

        // 計算禁答區
        const activeSet = new Set(active);
        for (let i = 1; i <= totalSeats; i++) {
            if (!activeSet.has(i)) {
                locked.push(i);
            }
        }

        gameState.mode = data.mode;
        gameState.activeZone = active;
        gameState.lockedZone = locked;
        gameState.buzzesOpen = true; // 開放按鈴

        console.log('模式設定:', data.mode, '目標:', data.target);
        console.log('可搶答區:', active);

        // 向所有玩家廣播他們的狀態
        Object.keys(players).forEach(socketId => {
            const seat = players[socketId];
            if (activeSet.has(seat)) {
                io.to(socketId).emit('player:setState', 'active');
            } else {
                io.to(socketId).emit('player:setState', 'locked');
            }
        });

        // 告訴老師更新後的網格
        io.to(socket.id).emit('host:updateGridState', { active, locked });
    });

    socket.on('host:reset', () => {
        gameState.buzzesOpen = false;
        io.emit('player:setState', 'standby'); // 讓所有玩家回到待機
        console.log('回合重設');
    });

    // --- 學生 (Player) 的事件 ---
    socket.on('player:joinGame', (seatNumber) => {
        const seat = parseInt(seatNumber);
        if (seat > 0 && seat <= classLayout.rows * classLayout.cols) {
            players[socket.id] = seat;
            console.log(`玩家 ${socket.id} 以座號 ${seat} 加入`);
            // 告訴老師有人加入了
            io.emit('host:playerJoined', seat);
        } else {
            // 可以在這裡加一個錯誤處理
            io.to(socket.id).emit('player:error', '無效的座號');
        }
    });

    socket.on('player:buzz', () => {
        if (!gameState.buzzesOpen) return; // 尚未開放搶答

        const seat = players[socket.id];
        if (!seat) return; // 尚未加入的玩家

        const time = new Date().getTime();
        let isValid = gameState.activeZone.includes(seat);

        // 這是您要的核心功能：
        // 無論有效或違規，都通知老師
        io.emit('host:logBuzz', {
            seat: seat,
            valid: isValid,
            time: time
        });

        // 搶答後就關閉搶答，防止多人同時
        gameState.buzzesOpen = false; 
    });

    socket.on('disconnect', () => {
        const seat = players[socket.id];
        if (seat) {
            delete players[socket.id];
            io.emit('host:playerLeft', seat); // 告訴老師有人離開
            console.log(`座號 ${seat} 離線`);
        }
    });
});

// --- 核心邏輯函式 ---
function calculateBigCross(target, rows, cols) {
    const active = new Set();
    const targetRow = Math.floor((target - 1) / cols);
    const targetCol = (target - 1) % cols;

    for (let i = 1; i <= rows * cols; i++) {
        // 檢查同一橫排
        if (Math.floor((i - 1) / cols) === targetRow) {
            active.add(i);
        }
        // 檢查同一縱排
        if ((i - 1) % cols === targetCol) {
            active.add(i);
        }
    }
    return Array.from(active);
}

function calculateNineSquare(target, rows, cols) {
    const active = new Set();
    const targetRow = Math.floor((target - 1) / cols);
    const targetCol = (target - 1) % cols;

    for (let r = targetRow - 1; r <= targetRow + 1; r++) {
        for (let c = targetCol - 1; c <= targetCol + 1; c++) {
            // 檢查是否在邊界內
            if (r >= 0 && r < rows && c >= 0 && c < cols) {
                const seatNum = r * cols + c + 1;
                active.add(seatNum);
            }
        }
    }
    return Array.from(active);
}

// --- 啟動伺服器 ---
// (使用 process.env.PORT 以便於部署到 Render 等平台)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器正在 ${PORT} 埠上運行`);
    console.log(`老師請訪問: http://localhost:${PORT}/host`);
    console.log(`學生請訪問: http://localhost:${PORT}`);
});