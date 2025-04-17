require('dotenv').config();
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
const OpenAI = require('openai');

// OpenAI 설정
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// JSON 파싱 미들웨어
app.use(express.json());

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
const messageHistory = {};

// 접속자 수 관리
const userCount = {};

// 서버 시작 시 공개방 채팅 기록 초기화
messageHistory.public = [];

// 매일 자정에 공개방 채팅 초기화
function scheduleDailyReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const timeUntilMidnight = tomorrow - now;
    
    setTimeout(() => {
        messageHistory.public = [];
        io.to('public').emit('system message', '공개방의 채팅이 초기화되었습니다.');
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

    socket.on('join room', (data) => {
        const { room, nickname } = data;
        
        // 방에 입장
        socket.join(room);
        
        // 사용자 수 증가
        userCount[room] = (userCount[room] || 0) + 1;
        
        // 모든 클라이언트에게 사용자 수 업데이트
        io.emit('user count', userCount[room]);
        
        // 시스템 메시지 전송
        io.to(room).emit('system message', `${nickname}님이 입장하셨습니다.`);
        
        // 이전 메시지 기록 전송
        if (messageHistory[room]) {
            socket.emit('message history', messageHistory[room]);
        }
    });

    socket.on('chat message', (data) => {
        const { room, message, nickname, fileData, noteData } = data;
        const timestamp = new Date();
        
        // 메시지 기록에 추가
        if (!messageHistory[room]) {
            messageHistory[room] = [];
        }
        
        // 파일 또는 노트 데이터가 있는 경우 포함
        const messageData = {
            nickname,
            timestamp
        };
        
        if (fileData) {
            messageData.fileData = fileData;
        } else if (noteData) {
            messageData.message = message;
            messageData.noteData = noteData;
        } else {
            messageData.message = message;
        }
        
        // 큰 파일 데이터는 메시지 히스토리에 저장하지 않음
        if (!fileData) {
            messageHistory[room].push(messageData);
        }
        
        // 방의 모든 클라이언트에게 메시지 전송
        io.to(room).emit('chat message', messageData);
    });

    socket.on('disconnect', () => {
        console.log('user disconnected');
        // 모든 방에서 사용자 수 감소
        Object.keys(userCount).forEach(room => {
            if (userCount[room] > 0) {
                userCount[room]--;
                io.emit('user count', userCount[room]);
            }
        });
    });
});

// GPT 헬퍼 API 라우트
app.post('/ask-helper', async (req, res) => {
    try {
        const { question } = req.body;
        
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "너는 대학생 전용 웹앱에 내장된 AI 도우미야. 사용자 질문이 사이트 기능 관련이면 사이트 도움말을 제공하고, 일반 질문이면 친절한 AI처럼 답변해줘."
                },
                {
                    role: "user",
                    content: question
                }
            ],
            temperature: 0.7,
            max_tokens: 1000
        });

        res.json({ 
            answer: completion.choices[0].message.content 
        });
    } catch (error) {
        console.error('GPT API 오류:', error);
        res.status(500).json({ 
            error: '죄송합니다. 답변을 생성하는 중에 오류가 발생했습니다.' 
        });
    }
});

// 서버 시작
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});