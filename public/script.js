let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let recordingStartTime;
let timerInterval;
let currentAudioBlob;
let socket = null;

// Variables d'authentification
let authToken = localStorage.getItem('authToken') || null;
let currentUsername = localStorage.getItem('currentUsername') || null;

// Initialisation
document.addEventListener('DOMContentLoaded', function() {
    if (authToken && currentUsername) {
        showMainSection();
    } else {
        document.getElementById('auth-section').classList.add('active');
        document.getElementById('main-section').classList.remove('active');
    }
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('recipient').addEventListener('input', checkRecipient);
});

// Fonctions d'authentification
function showRegister() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
    clearAuthError();
}

function showLogin() {
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
    clearAuthError();
}

function clearAuthError() {
    const errorDiv = document.getElementById('auth-error');
    errorDiv.style.display = 'none';
    errorDiv.style.color = '#721c24';
    errorDiv.style.backgroundColor = '#f8d7da';
    errorDiv.style.border = '1px solid #f5c6cb';
}

function showAuthError(message, type = 'error') {
    const errorDiv = document.getElementById('auth-error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    if (type === 'success') {
        errorDiv.style.color = '#28a745';
        errorDiv.style.backgroundColor = '#d4edda';
        errorDiv.style.border = '1px solid #c3e6cb';
    } else {
        errorDiv.style.color = '#721c24';
        errorDiv.style.backgroundColor = '#f8d7da';
        errorDiv.style.border = '1px solid #f5c6cb';
        errorDiv.style.animation = 'shake 0.5s';
        setTimeout(() => errorDiv.style.animation = '', 500);
    }
}

async function register() {
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;

    if (!username || !email || !password) {
        showAuthError('Tous les champs sont requis');
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();

        if (response.ok) {
            showAuthError('Inscription réussie! Veuillez vous connecter', 'success');
            showLogin();
            document.getElementById('login-username').value = username;
            document.getElementById('login-password').focus();
        } else {
            showAuthError(data.error);
        }
    } catch (error) {
        showAuthError('Erreur de connexion au serveur');
    }
}

async function login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
        showAuthError('Nom d\'utilisateur et mot de passe requis');
        return;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            authToken = data.token;
            currentUsername = data.username;
            
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('currentUsername', currentUsername);
            
            showMainSection();
        } else {
            showAuthError(data.error);
        }
    } catch (error) {
        showAuthError('Erreur de connexion au serveur');
    }
}

function logout() {
    authToken = null;
    currentUsername = null;
    
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUsername');
    
    if (socket) {
        socket.close();
        socket = null;
    }
    
    document.getElementById('auth-section').classList.add('active');
    document.getElementById('main-section').classList.remove('active');
    document.querySelectorAll('input').forEach(input => input.value = '');
    showLogin();
}

function showMainSection() {
    document.getElementById('auth-section').classList.remove('active');
    document.getElementById('main-section').classList.add('active');
    document.getElementById('current-username').textContent = currentUsername;
    initWebSocket();
    loadReceivedNotes();
    loadSentNotes();
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        socket.send(JSON.stringify({
            type: 'auth',
            token: authToken,
            username: currentUsername
        }));
    };
    
    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        if (message.type === 'newVoiceNote') {
            showNotification(`Nouvelle note vocale de ${message.note.from}`);
            
            const activeTab = document.querySelector('.tab-button.active');
            if (activeTab && activeTab.textContent.includes('Reçues')) {
                loadReceivedNotes();
            }
        }
    };
    
    socket.onclose = () => {
        setTimeout(initWebSocket, 5000);
    };
}

function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 500);
    }, 3000);
}

// Fonctions d'onglets
function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.style.display = 'none';
    });
    
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    document.getElementById(tabName + '-tab').style.display = 'block';
    
    const buttons = document.querySelectorAll('.tab-button');
    buttons.forEach(btn => {
        if ((tabName === 'send' && btn.textContent.includes('Envoyer')) ||
            (tabName === 'received' && btn.textContent.includes('Reçues')) ||
            (tabName === 'sent' && btn.textContent.includes('Envoyées'))) {
            btn.classList.add('active');
        }
    });
    
    if (tabName === 'received') {
        loadReceivedNotes();
    } else if (tabName === 'sent') {
        loadSentNotes();
    }
}

// Vérification du destinataire
async function checkRecipient() {
    const recipient = document.getElementById('recipient').value.trim();
    const statusDiv = document.getElementById('recipient-status');
    
    if (!recipient) {
        statusDiv.textContent = '';
        return;
    }

    if (recipient === currentUsername) {
        statusDiv.innerHTML = '<span style="color: #dc3545;">❌ Vous ne pouvez pas vous envoyer une note à vous-même</span>';
        return;
    }

    try {
        const response = await fetch(`/api/users/search/${encodeURIComponent(recipient)}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const data = await response.json();
        
        if (data.exists) {
            statusDiv.innerHTML = '<span style="color: #28a745;">✓ Utilisateur trouvé</span>';
        } else {
            statusDiv.innerHTML = '<span style="color: #dc3545;">❌ Utilisateur introuvable</span>';
        }
    } catch (error) {
        statusDiv.innerHTML = '<span style="color: #6c757d;">Erreur de vérification</span>';
    }
}

// Fonctions d'enregistrement vocal
async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm;codecs=opus'
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'audio/webm' });
            currentAudioBlob = blob;
            
            const audioUrl = URL.createObjectURL(blob);
            const audioPreview = document.getElementById('audio-preview');
            audioPreview.src = audioUrl;
            audioPreview.style.display = 'block';
            
            document.getElementById('audio-controls').style.display = 'block';
            
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        isRecording = true;
        recordingStartTime = Date.now();
        
        updateRecordingUI();
        startTimer();

        setTimeout(() => {
            if (isRecording) {
                stopRecording();
                showSendError('Enregistrement arrêté automatiquement (limite de 60 secondes)');
            }
        }, 60000);

    } catch (error) {
        console.error('Erreur accès microphone:', error);
        showSendError('Erreur d\'accès au microphone. Vérifiez les permissions.');
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        updateRecordingUI();
        stopTimer();
    }
}

function updateRecordingUI() {
    const recordButton = document.getElementById('record-button');
    const status = document.getElementById('recording-status');
    
    if (isRecording) {
        recordButton.classList.add('recording');
        recordButton.textContent = '⏹️';
        status.textContent = 'ENREGISTREMENT EN COURS';
        status.classList.add('recording');
    } else {
        recordButton.classList.remove('recording');
        recordButton.textContent = '🎤';
        status.textContent = 'Cliquez pour commencer l\'enregistrement';
        status.classList.remove('recording');
    }
}

function startTimer() {
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        document.getElementById('timer').textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 100);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function resetRecording() {
    if (isRecording) {
        stopRecording();
    }
    
    recordedChunks = [];
    currentAudioBlob = null;
    document.getElementById('timer').textContent = '00:00';
    document.getElementById('audio-preview').style.display = 'none';
    document.getElementById('audio-controls').style.display = 'none';
    document.getElementById('recording-status').textContent = 'Cliquez pour commencer l\'enregistrement';
    
    clearSendMessages();
}

async function sendVoiceNote() {
    const recipient = document.getElementById('recipient').value.trim();
    
    if (!recipient) {
        showSendError('Veuillez saisir un destinataire');
        return;
    }

    if (!currentAudioBlob) {
        showSendError('Aucun enregistrement disponible');
        return;
    }

    if (recipient === currentUsername) {
        showSendError('Vous ne pouvez pas vous envoyer une note à vous-même');
        return;
    }

    const formData = new FormData();
    formData.append('audio', currentAudioBlob, 'voice_note.webm');
    formData.append('to', recipient);
    
    const duration = recordingStartTime ? Math.floor((Date.now() - recordingStartTime) / 1000) : 0;
    formData.append('duration', duration.toString());

    try {
        const response = await fetch('/api/voice-notes', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            showSendSuccess('Note vocale envoyée avec succès! 🎉');
            resetRecording();
            document.getElementById('recipient').value = '';
            document.getElementById('recipient-status').textContent = '';
            loadSentNotes();
        } else {
            showSendError(data.error);
        }
    } catch (error) {
        console.error('Erreur envoi:', error);
        showSendError('Erreur lors de l\'envoi de la note vocale');
    }
}

function showSendError(message) {
    const errorDiv = document.getElementById('send-error');
    errorDiv.innerHTML = `❌ ${message}`;
    errorDiv.style.display = 'block';
    errorDiv.style.animation = 'shake 0.5s';
    document.getElementById('send-success').style.display = 'none';
    setTimeout(() => errorDiv.style.animation = '', 500);
}

function showSendSuccess(message) {
    const successDiv = document.getElementById('send-success');
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    document.getElementById('send-error').style.display = 'none';
}

function clearSendMessages() {
    document.getElementById('send-error').style.display = 'none';
    document.getElementById('send-success').style.display = 'none';
}

// Chargement des notes reçues
async function loadReceivedNotes() {
    try {
        const response = await fetch('/api/voice-notes/received', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const notes = await response.json();
        const container = document.getElementById('received-notes');

        if (notes.length === 0) {
            container.innerHTML = '<p>Aucune note vocale reçue 📭</p>';
            return;
        }

        container.innerHTML = notes.map(note => `
            <div class="note-item">
                <div class="note-info">
                    <div class="note-from">👤 De: ${note.from}</div>
                    <div class="note-date">📅 ${new Date(note.createdAt).toLocaleString('fr-FR')}</div>
                </div>
                <div>
                    <span class="note-duration">${note.duration}s</span>
                    <button class="btn btn-success" onclick="playVoiceNote('${note._id}')">
                        🎧 Écouter (1 seule fois)
                    </button>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Erreur chargement notes reçues:', error);
        if (document.getElementById('received-notes')) {
            document.getElementById('received-notes').innerHTML = '<p>Erreur lors du chargement des notes</p>';
        }
    }
}

// Chargement des notes envoyées
async function loadSentNotes() {
    try {
        const response = await fetch('/api/voice-notes/sent', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const notes = await response.json();
        const container = document.getElementById('sent-notes');

        if (notes.length === 0) {
            container.innerHTML = '<p>Aucune note vocale envoyée 📤</p>';
            return;
        }

        container.innerHTML = notes.map(note => {
            let statusClass = 'status-sent';
            let statusText = '📤 Envoyée';
            
            if (note.status === 'read') {
                statusClass = 'status-read';
                statusText = '👁️ Lue';
            } else if (note.status === 'deleted') {
                statusClass = 'status-read';
                statusText = '🗑️ Supprimée';
            }

            return `
                <div class="note-item">
                    <div class="note-info">
                        <div class="note-from">👤 À: ${note.to}</div>
                        <div class="note-date">📅 ${new Date(note.createdAt).toLocaleString('fr-FR')}</div>
                    </div>
                    <div>
                        <span class="note-duration">${note.duration}s</span>
                        <span class="status-indicator ${statusClass}">${statusText}</span>
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Erreur chargement notes envoyées:', error);
        if (document.getElementById('sent-notes')) {
            document.getElementById('sent-notes').innerHTML = '<p>Erreur lors du chargement des notes</p>';
        }
    }
}

// Lecture d'une note vocale
async function playVoiceNote(noteId) {
    if (!confirm("⚠️ Attention: Cette note sera supprimée définitivement après lecture. Continuer?")) {
        return;
    }

    try {
        const audioElement = new Audio();
        audioElement.src = `/api/voice-notes/${noteId}/audio?token=${authToken}`;
        audioElement.controls = true;
        audioElement.autoplay = true;

        const noteButtons = document.querySelectorAll(
            `button[onclick="playVoiceNote('${noteId}')"]`
        );
        if (noteButtons.length > 0) {
            const noteItem = noteButtons[0].closest(".note-item");
            const buttonContainer = noteItem.querySelector("div:last-child");
            buttonContainer.innerHTML = "";
            buttonContainer.appendChild(audioElement);

            audioElement.onerror = () => {
                buttonContainer.innerHTML = '<p style="color: #dc3545;">Erreur de lecture</p>';
            };

            audioElement.onended = () => {
                buttonContainer.innerHTML =
                    '<p style="color: #dc3545;">Note supprimée après lecture</p>';
                setTimeout(() => loadReceivedNotes(), 2000);
            };
        }
    } catch (error) {
        console.error("Erreur lecture note:", error);
        alert("Erreur lors de la lecture de la note vocale");
    }
}
