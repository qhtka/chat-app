const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// 정적 파일 제공
app.use(express.static('public'));

// 루트 경로
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// 소켓 연결 처리
io.on('connection', (socket) => {
    console.log('사용자가 연결되었습니다.');

    // 채팅 메시지 처리
    socket.on('chat message', (data) => {
        const message = `${data.username}: ${data.message}`;
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