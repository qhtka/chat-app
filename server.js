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

// 매일 자정에 공개방 채팅 초기화
function scheduleDailyReset() {
    const now = new Date();
    const night = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1, // 다음 날
        0, 0, 0 // 자정
    );
    const msToMidnight = night.getTime() - now.getTime();

    setTimeout(() => {
        // 공개방 채팅 초기화
        messageHistory.public = [];
        // 시스템 메시지 전송
        io.to('public').emit('chat message', {
            username: '시스템',
            text: '공개방의 채팅이 초기화되었습니다.',
            type: 'system'
        });
        // 다음 자정을 위해 다시 스케줄링
        scheduleDailyReset();
    }, msToMidnight);
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
    console.log('사용자가 연결되었습니다.');

    // 방 입장 처리
    socket.on('join room', (data) => {
        const { room, username } = data;
        socket.join(room);
        console.log(`${username}님이 ${room}방에 입장했습니다.`);
        
        // 해당 방의 이전 메시지 기록 전송
        socket.emit('message history', messageHistory[room]);
        
        // 입장 메시지 전송
        const message = {
            username: '시스템',
            text: `${username}님이 입장했습니다.`,
            type: 'system'
        };
        messageHistory[room].push(message);
        io.to(room).emit('chat message', message);
    });

    // 채팅 메시지 처리
    socket.on('chat message', (data) => {
        const { room, username, message, image } = data;
        const chatMessage = {
            username: username,
            text: message,
            image: image,
            type: 'user'
        };
        
        // 메시지를 해당 방의 기록에 추가
        messageHistory[room].push(chatMessage);
        
        // 해당 방의 모든 클라이언트에게 메시지 전송
        io.to(room).emit('chat message', chatMessage);
    });

    // 연결 해제
    socket.on('disconnect', () => {
        console.log('사용자가 연결을 해제했습니다.');
    });
});

// 서버 시작
const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});