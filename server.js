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

// 메시지 기록을 저장할 배열
const messageHistory = [];

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

    // 연결 시 이전 메시지 기록 전송
    socket.emit('message history', messageHistory);

    // 채팅 메시지 처리
    socket.on('chat message', (data) => {
        const message = {
            username: data.username,
            text: data.message,
            image: data.image
        };
        // 메시지를 기록에 추가
        messageHistory.push(message);
        // 모든 클라이언트에게 메시지 전송
        io.emit('chat message', message);
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