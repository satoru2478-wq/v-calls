// --- DOM ELEMENTS ---
const pages = {
    home: document.getElementById('home'),
    lobby: document.getElementById('lobby'),
    call: document.getElementById('call')
};
const views = {
    creator: document.getElementById('creator-view'),
    joiner: document.getElementById('joiner-view')
};
const els = {
    linkBox: document.getElementById('link-box'),
    status: document.getElementById('status-text'),
    controlBar: document.getElementById('control-bar'),
    chatArea: document.getElementById('chat-area'),
    chatInput: document.getElementById('chat-input'),
    chatMsgs: document.getElementById('chat-msgs')
};

// --- STATE ---
let roomID = null;
let isCreator = false;
let pc = null;
let localStream = null;
let remoteStream = null;
let micOn = true;
let controlTimeout = null;

const socket = new WebSocket("wss://v-calls.onrender.com");
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// --- INITIALIZATION ---
// 1. Check URL to decide Page
function init() {
    initLiquid(); // Start background immediately

    const hash = location.hash.replace("#", "");
    if (hash) {
        // User has a link -> Show Joiner Lobby
        roomID = hash;
        isCreator = false;
        showPage('lobby');
        views.joiner.classList.remove('hidden');
    } else {
        // User has no link -> Show Home
        showPage('home');
    }
}
init();

function showPage(pageName) {
    Object.values(pages).forEach(p => p.classList.remove('active'));
    pages[pageName].classList.add('active');
}

// --- BUTTON LISTENERS ---

// 1. Create Room (Creator)
document.getElementById('create-btn').onclick = () => {
    roomID = crypto.randomUUID().substring(0, 8); // Short ID
    isCreator = true;
    location.hash = roomID;
    
    // UI Update
    showPage('lobby');
    views.creator.classList.remove('hidden');
    els.linkBox.value = location.href;
};

document.getElementById('copy-btn').onclick = () => {
    navigator.clipboard.writeText(els.linkBox.value);
    alert("Link Copied!");
};

// 2. Join Room (Joiner)
document.getElementById('join-btn').onclick = async () => {
    showPage('call');
    await startCall();
    // Signal I am ready
    send({ type: "ready" });
};

// --- WEBRTC LOGIC ---

async function startCall() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        pc = new RTCPeerConnection(rtcConfig);
        
        // Add Local Tracks
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

        // Handle Remote Tracks
        pc.ontrack = (e) => {
            remoteStream = e.streams[0];
            const audio = document.createElement('audio');
            audio.srcObject = remoteStream;
            audio.autoplay = true;
            document.body.appendChild(audio);
            els.status.innerText = "Connected & Live";
            
            // Connect Audio to Liquid
            connectAudioToLiquid(remoteStream);
        };

        // ICE Candidates
        pc.onicecandidate = (e) => {
            if (e.candidate) send({ type: "candidate", candidate: e.candidate });
        };

    } catch (err) {
        alert("Microphone access required!");
        console.error(err);
    }
}

// --- SIGNALING ---

socket.onmessage = async (msg) => {
    const data = JSON.parse(msg.data);
    if (data.room !== roomID) return;

    // 1. If Creator receives "ready", start the offer
    if (data.type === "ready" && isCreator) {
        showPage('call');
        await startCall();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: "offer", sdp: offer });
    }

    // 2. If Joiner receives "offer"
    if (data.type === "offer" && !isCreator) {
        if (!pc) await startCall(); // Ensure PC exists
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ type: "answer", sdp: answer });
    }

    // 3. Handshakes
    if (data.type === "answer" && pc) {
        await pc.setRemoteDescription(data.sdp);
    }
    if (data.type === "candidate" && pc) {
        await pc.addIceCandidate(data.candidate);
    }
    
    // 4. Chat
    if (data.type === "chat") {
        addChatMsg(data.text, false);
    }
};

function send(data) {
    data.room = roomID;
    socket.send(JSON.stringify(data));
}

// --- CONTROLS & UI ---

// Disappearing Controls
document.body.addEventListener('click', () => {
    els.controlBar.classList.add('visible');
    clearTimeout(controlTimeout);
    controlTimeout = setTimeout(() => {
        // Only hide if chat is not open
        if (els.chatArea.classList.contains('hidden')) {
            els.controlBar.classList.remove('visible');
        }
    }, 4000);
});

// Mute
document.getElementById('mute-btn').onclick = function() {
    micOn = !micOn;
    localStream.getAudioTracks()[0].enabled = micOn;
    this.innerText = micOn ? "🎙️" : "🔇";
};

// End
document.getElementById('end-btn').onclick = () => {
    location.href = location.origin + location.pathname; // Reload clear
};

// Chat
document.getElementById('chat-toggle').onclick = () => {
    els.chatArea.classList.toggle('hidden');
};

els.chatInput.onkeypress = (e) => {
    if (e.key === 'Enter' && els.chatInput.value) {
        const txt = els.chatInput.value;
        send({ type: "chat", text: txt });
        addChatMsg(txt, true);
        els.chatInput.value = "";
    }
};

function addChatMsg(txt, isMe) {
    const div = document.createElement('div');
    div.className = isMe ? "msg me" : "msg";
    div.innerText = txt;
    els.chatMsgs.appendChild(div);
    els.chatMsgs.scrollTop = els.chatMsgs.scrollHeight;
}

// --- 3D LIQUID VISUALIZER ---
let analyser, dataArray;

function initLiquid() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('bg'), alpha: true });
    
    renderer.setSize(innerWidth, innerHeight);
    camera.position.z = 2.5;

    // The Blob
    const geo = new THREE.IcosahedronGeometry(1, 10); // High detail
    const mat = new THREE.MeshNormalMaterial({ wireframe: true }); 
    // Using NormalMaterial gives nice rainbow-ish colors automatically
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    // Animation
    const clock = new THREE.Clock();
    
    function animate() {
        requestAnimationFrame(animate);
        const time = clock.getElapsedTime();
        
        // Idle Animation (Always moving)
        let distortion = 0.2; 
        
        // If Audio Connected, increase distortion
        if (analyser) {
            analyser.getByteFrequencyData(dataArray);
            const avg = dataArray[10] / 255;
            distortion = 0.2 + (avg * 0.8); // Scale up with volume
        }

        mesh.rotation.y = time * 0.1;
        mesh.rotation.z = time * 0.05;
        
        // Liquid Morphing Effect
        const pos = mesh.geometry.attributes.position;
        const v = new THREE.Vector3();
        
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            // Noise calculation
            const noise = Math.sin(v.x * 2 + time) + Math.cos(v.y * 2 + time);
            const scale = 1 + (noise * 0.1 * distortion); 
            
            // Normalize and scale
            v.normalize().multiplyScalar(scale);
            pos.setXYZ(i, v.x, v.y, v.z);
        }
        pos.needsUpdate = true;

        renderer.render(scene, camera);
    }
    animate();

    window.onresize = () => {
        camera.aspect = innerWidth/innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
    };
}

function connectAudioToLiquid(stream) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
}
