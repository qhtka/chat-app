const socket = io();

const nickname = prompt('닉네임을 입력하세요:');
socket.emit('join', nickname);

const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const userList = document.getElementById('user-list');

let myId = null;

socket.on('connect', () => {
  myId = socket.id;
});

form.addEventListener('submit', function(e) {
  e.preventDefault();
  if (input.value) {
    socket.emit('chat message', input.value);
    input.value = '';
  }
});

socket.on('chat message', function({ id, msg, type }) {
  const item = document.createElement('li');
  item.textContent = msg;
  if (type === 'system') {
    item.className = 'system-message';
  } else {
    item.className = id === myId ? 'my-message' : 'other-message';
  }
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
});

socket.on('user list', function(users) {
  userList.innerHTML = '';
  users.forEach(user => {
    const li = document.createElement('li');
    li.textContent = user;
    userList.appendChild(li);
  });
});