const uploadStatus = document.getElementById('uploadStatus');
const sqlQueryElem = document.getElementById('sqlQuery');
const queryResultDiv = document.getElementById('queryResult');

let ws;

function connectWebSocket() {
  ws = new WebSocket('wss://rowbot-backend.onrender.com/ws');
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
  const tableName = 'Table';
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
  formData.append('table_name', tableName);

  fetch('https://rowbot-backend.onrender.com/upload/', {
    method: 'POST',
    body: formData
  })
  .then(resp => resp.json())
  .then((data) => {
    if (data.message) {
      uploadStatus.textContent = data.message;
      // Auto fetch table after upload
      sendQuery(`SELECT * FROM ${tableName}`);
    } else if (data.error) {
      uploadStatus.textContent = 'Upload error: ' + data.error;
    }
  })

    // uploadStatus.textContent = 'File Uploaded Successfully'
  uploadStatus.textContent = 'File Uploaded Successfully';
  setTimeout(() => uploadStatus.textContent = '', 3000);

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

  // Fade in animation using Anime.js
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

const uploadBtn = document.getElementById('uploadBtn');
// const uploadStatus = document.getElementById('uploadStatus');

uploadBtn.addEventListener('click', () => {
  // Clear any old timers so they don't overlap

  // Show the message
  uploadStatus.textContent = "Successfully Uploaded!!";

  // Remove it after 3 seconds
  setTimeout(() => {
    uploadStatus.textContent = "";
  }, 3000);
});



// Glitch logic

import { VFX } from "https://esm.sh/@vfx-js/core";

class ButtonEffect {
  constructor(button) {
    this.vfx = new VFX();
    button.addEventListener("mouseenter", (e) => {
      this.vfx.add(button, { shader: "glitch", overflow: 100 });
    });
    console.log("glitch")
    button.addEventListener("mouseleave", (e) => {
      this.vfx.remove(button);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const glitchElements = document.querySelectorAll(".glitch"); // select all with class "glitch"
  glitchElements.forEach(el => {
    new ButtonEffect(el);
  });
});


