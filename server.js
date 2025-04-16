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

// 소켓 연결 처리
io.on('connection', (socket) => {
    console.log('a user connected');

    // 새로운 연결 시 현재 접속자 수 전송
    socket.emit('initial user count', userCount);

    socket.on('join room', (data) => {
        const { room, username } = data;
        socket.join(room);
        userCount[room]++;
        
        // 모든 클라이언트에게 접속자 수 업데이트
        io.emit('user count update', userCount);
        
        // 이전 메시지 기록 전송
        socket.emit('message history', messageHistory[room]);
        
        // 시스템 메시지 전송
        io.to(room).emit('chat message', {
            type: 'system',
            username: '시스템',
            text: `${username}님이 입장하셨습니다.`
        });
    });

    socket.on('chat message', (data) => {
        const { room, username, message, image } = data;
        const now = new Date();
        const time = now.toLocaleTimeString('ko-KR', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        });
        
        const messageData = {
            type: 'message',
            username,
            text: message,
            image,
            time: time
        };
        
        messageHistory[room].push(messageData);
        io.to(room).emit('chat message', messageData);
    });

    socket.on('disconnect', () => {
        console.log('user disconnected');
        // 방에서 나갈 때 접속자 수 감소
        const rooms = Array.from(socket.rooms);
        rooms.forEach(room => {
            if (room === 'public' || room === 'private') {
                userCount[room]--;
                // 모든 클라이언트에게 접속자 수 업데이트
                io.emit('user count update', userCount);
            }
        });
    });
});

// 서버 시작
const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});