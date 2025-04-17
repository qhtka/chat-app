const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

// 이미지 저장 설정
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'public/uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB 제한
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('이미지 파일만 업로드 가능합니다.'));
    }
});

// 메시지 기록을 저장할 객체 (방별로 저장)
const messageHistory = {
    public: [],
    private: []
};

// 접속자 수 관리
const userCount = {
    public: 0,
    private: 0
};

// 매일 자정에 공개방 채팅 초기화
function scheduleDailyReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const timeUntilMidnight = tomorrow - now;
    
    setTimeout(() => {
        messageHistory.public = [];
        io.to('public').emit('chat message', {
            type: 'system',
            username: '시스템',
            text: '공개방의 채팅이 초기화되었습니다.'
        });
        scheduleDailyReset(); // 다음 자정을 위해 다시 설정
    }, timeUntilMidnight);
}

// 자정 초기화 스케줄링 시작
scheduleDailyReset();

// 정적 파일 제공
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// 이미지 업로드 라우트
app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '이미지 업로드에 실패했습니다.' });
    }
    res.json({ 
        url: `/uploads/${req.file.filename}`,
        filename: req.file.filename
    });
});

// 로그인 페이지
app.get('/login.html', (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
});

// 루트 경로
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// 방 정보 저장
const rooms = new Map();

// QR 코드 생성
app.post('/generate-qr', async (req, res) => {
    const { roomId } = req.body;
    try {
        const url = `http://${req.headers.host}/join.html?room=${roomId}`;
        const qrCode = await QRCode.toDataURL(url);
        res.json({ qrCode });
    } catch (error) {
        res.status(500).json({ error: 'QR 코드 생성 실패' });
    }
});

// 방 생성
app.post('/create-room', (req, res) => {
    const roomId = Math.random().toString(36).substring(2, 8);
    const room = {
        id: roomId,
        createdAt: Date.now(),
        expiresAt: Date.now() + (3 * 60 * 60 * 1000), // 3시간 후
        users: new Set()
    };
    rooms.set(roomId, room);
    
    // 3시간 후 방 자동 폭파
    setTimeout(() => {
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.users.forEach(user => {
                io.to(user).emit('room expired');
            });
            rooms.delete(roomId);
        }
    }, 3 * 60 * 60 * 1000);
    
    res.json({ roomId });
});

// 방 정보 조회
app.get('/room/:roomId', (req, res) => {
    const room = rooms.get(req.params.roomId);
    if (!room) {
        return res.status(404).json({ error: '방을 찾을 수 없습니다' });
    }
    res.json(room);
});

// 소켓 연결 처리
io.on('connection', (socket) => {
    console.log('a user connected');

    // 새로운 연결 시 현재 접속자 수 전송
    socket.emit('initial user count', userCount);

    socket.on('join', (data) => {
        const { username, roomId } = data;
        const room = rooms.get(roomId);
        
        if (!room) {
            socket.emit('error', '방을 찾을 수 없습니다');
            return;
        }
        
        if (room.expiresAt < Date.now()) {
            socket.emit('error', '방이 만료되었습니다');
            return;
        }
        
        socket.join(roomId);
        room.users.add(socket.id);
        
        io.to(roomId).emit('user joined', {
            username,
            userCount: room.users.size
        });
    });

    socket.on('chat message', (data) => {
        const { text, username, roomId } = data;
        const room = rooms.get(roomId);
        
        if (!room || room.expiresAt < Date.now()) {
            socket.emit('error', '방이 만료되었습니다');
            return;
        }
        
        io.to(roomId).emit('chat message', {
            text,
            username,
            time: new Date().toLocaleTimeString()
        });
    });

    socket.on('disconnect', () => {
        console.log('user disconnected');
        rooms.forEach((room, roomId) => {
            if (room.users.has(socket.id)) {
                room.users.delete(socket.id);
                io.to(roomId).emit('user left', {
                    userCount: room.users.size
                });
                
                if (room.users.size === 0) {
                    rooms.delete(roomId);
                }
            }
        });
    });
});

// 서버 시작
const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});