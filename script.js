const uploadStatus = document.getElementById('uploadStatus');
const sqlQueryElem = document.getElementById('sqlQuery');
const queryResultDiv = document.getElementById('queryResult');

let ws;

function connectWebSocket() {
  const wsUrl = window.location.hostname === "localhost"
    ? "ws://localhost:8000/ws"
    : "wss://rowbot-backend.onrender.com/ws";

  ws = new WebSocket(wsUrl);

  ws.onopen = () => console.log('WebSocket connected');

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.error) {
      alert("Error: " + data.error);
      return;
    }

    if (data.sql_query) {
      sqlQueryElem.textContent = "Generated SQL:\n" + data.sql_query;
    }
    if (data.data && data.data.result) {
      renderTable(data.data.result);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket closed, reconnecting in 3s...');
    setTimeout(connectWebSocket, 3000);
  };
}

function uploadFile() {
  const fileInput = document.getElementById('fileInput');
  if (!fileInput.files.length) {
    uploadStatus.textContent = 'Please choose the file first!';
    uploadStatus.style.color = 'red';
    setTimeout(() => {
      uploadStatus.textContent = '';
      uploadStatus.style.color = '';
    }, 3000);
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  fetch('https://rowbot-backend.onrender.com/upload/', {
    method: 'POST',
    body: formData
  })
  .then(resp => resp.json())
  .then((data) => {
    if (data.message) {
      uploadStatus.textContent = data.message;

      // Extract table name if possible
      let match = data.message.match(/'(.+)'/);
      let tableName = match ? match[1] : "Table1";

      // Chain query in natural language so backend converts it
      sendQuery(`Show all rows from ${tableName}`);
    } else if (data.error) {
      uploadStatus.textContent = 'Upload error: ' + data.error;
    }
  })
  .catch(err => {
    console.error(err);
    uploadStatus.textContent = 'Error uploading file';
  });
}

function sendQuery(sqlPrompt) {
  if (ws.readyState !== WebSocket.OPEN) {
    alert('WebSocket not connected');
    return;
  }

  ws.send(JSON.stringify({
    command: 'chat_to_sql',
    message: sqlPrompt
  }));
}

function sendChat() {
  const chatInput = document.getElementById('chatInput');
  const message = chatInput.value.trim();
  if (!message) return;

  sendQuery(message);
  chatInput.value = '';
  sqlQueryElem.textContent = 'Waiting for response...';
  queryResultDiv.innerHTML = '';
}

function renderTable(rows) {
  if (!rows.length) {
    queryResultDiv.textContent = 'No results found.';
    return;
  }

  const table = document.createElement('table');
  const header = document.createElement('tr');
  Object.keys(rows[0]).forEach(col => {
    const th = document.createElement('th');
    th.textContent = col;
    header.appendChild(th);
  });
  table.appendChild(header);

  rows.forEach(row => {
    const tr = document.createElement('tr');
    Object.values(row).forEach(val => {
      const td = document.createElement('td');
      td.textContent = val === null ? '' : val;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  queryResultDiv.innerHTML = '';
  queryResultDiv.appendChild(table);

  // Fade-in animation using Anime.js
  anime({
    targets: 'table',
    opacity: [0, 1],
    translateY: [-20, 0],
    duration: 800,
    easing: 'easeOutQuad'
  });
}

window.onload = () => {
  connectWebSocket();
  document.getElementById('uploadBtn').addEventListener('click', uploadFile);
  document.getElementById('sendBtn').addEventListener('click', sendChat);
};

// Glitch effect
import { VFX } from "https://esm.sh/@vfx-js/core";

class ButtonEffect {
  constructor(button) {
    this.vfx = new VFX();
    button.addEventListener("mouseenter", () => {
      this.vfx.add(button, { shader: "glitch", overflow: 100 });
    });
    button.addEventListener("mouseleave", () => {
      this.vfx.remove(button);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const glitchElements = document.querySelectorAll(".glitch");
  glitchElements.forEach(el => {
    new ButtonEffect(el);
  });
});
