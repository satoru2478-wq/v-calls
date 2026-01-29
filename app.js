// UI Elements
const intro = document.getElementById("intro");
const lobby = document.getElementById("lobby");
const connectPage = document.getElementById("connect");
const callPage = document.getElementById("call");
const linkBox = document.getElementById("link-box");
const statusTxt = document.getElementById("call-status");

// 1. Initial Flow
setTimeout(() => {
    intro.classList.remove("active");
    // Check if user came from a link
    if(location.hash.length > 2) {
        lobby.classList.remove("active");
        connectPage.classList.add("active");
    } else {
        lobby.classList.add("active");
        // Generate Secret ID
        const secretId = crypto.randomUUID().split('-')[0]; // Short anonymous ID
        location.hash = secretId;
        linkBox.value = location.href;
    }
}, 2500);

document.getElementById("copy-btn").onclick = () => {
    navigator.clipboard.writeText(linkBox.value);
    alert("Link Copied! Send it securely.");
};

document.getElementById("enter-room").onclick = () => {
    lobby.classList.remove("active");
    connectPage.classList.add("active");
};

// 2. Core Call Variables
const socket = new WebSocket("wss://v-calls.onrender.com");
const roomID = location.hash.replace("#", "");
let pc, localStream, remoteStream;
let micOn = true;
let audioCtx, analyser, dataArray, source;

// 3. Start Connection
document.getElementById("start").onclick = async () => {
    connectPage.classList.remove("active");
    callPage.classList.add("active");
    
    // Get Local Mic
    localStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true } 
    });

    // Setup RTC
    pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    // Add tracks
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    // Handle Remote Stream (AUDIO OF OTHER PERSON)
    pc.ontrack = e => {
        remoteStream = e.streams[0];
        const audio = document.createElement("audio");
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        document.body.appendChild(audio);
        statusTxt.innerText = "Connected: Audio Live";
        
        // Connect Remote Audio to Visualizer
        initVisualizer(remoteStream);
    };

    pc.onicecandidate = e => {
        if(e.candidate) send({ type: "candidate", candidate: e.candidate });
    };

    // Join
    send({ type: "join" });
};

// 4. Signaling
socket.onmessage = async (e) => {
    const d = JSON.parse(e.data);
    if (d.room !== roomID) return;

    if (d.type === "join" && pc) {
        const off = await pc.createOffer();
        await pc.setLocalDescription(off);
        send({ type: "offer", sdp: off });
    } else if (d.type === "offer" && pc) {
        await pc.setRemoteDescription(d.sdp);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        send({ type: "answer", sdp: ans });
    } else if (d.type === "answer" && pc) {
        await pc.setRemoteDescription(d.sdp);
    } else if (d.type === "candidate" && pc) {
        await pc.addIceCandidate(d.candidate);
    } else if (d.type === "chat") {
        showMsg(d.msg, false);
    }
};

function send(data) {
    data.room = roomID;
    socket.send(JSON.stringify(data));
}

// 5. Buttons Logic
document.getElementById("mute").onclick = function() {
    micOn = !micOn;
    localStream.getAudioTracks()[0].enabled = micOn;
    this.innerText = micOn ? "🎙️" : "🔇";
    this.classList.toggle("red", !micOn);
};

document.getElementById("end").onclick = () => location.href = location.href.split('#')[0];

// Chat
const chatOverlay = document.getElementById("chat-overlay");
const msgInput = document.getElementById("msg-input");
document.getElementById("chat-btn").onclick = () => chatOverlay.classList.toggle("hidden");

msgInput.addEventListener("keypress", (e) => {
    if(e.key === "Enter" && msgInput.value) {
        send({ type: "chat", msg: msgInput.value });
        showMsg(msgInput.value, true);
        msgInput.value = "";
    }
});

function showMsg(txt, isMe) {
    const div = document.createElement("div");
    div.className = "msg";
    div.style.alignSelf = isMe ? "flex-end" : "flex-start";
    div.style.background = isMe ? "rgba(99, 102, 241, 0.5)" : "rgba(255,255,255,0.2)";
    div.innerText = txt;
    document.getElementById("messages").appendChild(div);
}

// Speaker (Fake Toggle - OS Handles Routing usually, but we try)
let speakerOn = false;
document.getElementById("speaker").onclick = function() {
    speakerOn = !speakerOn;
    this.innerText = speakerOn ? "📢" : "🔈";
    // Attempt to switch output if browser allows (mostly Desktop/Android chrome)
    if('setSinkId' in AudioContext.prototype) {
        // complex logic skipped for mobile compatibility, visual toggle for now
    }
};

// 6. 3D FLUID VISUALIZER (Reacts to REMOTE Audio & Gyro)
function initVisualizer(stream) {
    // Audio Context
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64; // Low res for blob effect
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);

    // Three JS Setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("bg"), alpha: true });
    renderer.setSize(innerWidth, innerHeight);
    camera.position.z = 3;

    // Fluid Blob (High segment sphere)
    const geometry = new THREE.SphereGeometry(1, 64, 64);
    // Dynamic material that supports color changes
    const material = new THREE.MeshBasicMaterial({ 
        color: 0xffffff, 
        wireframe: true,
        transparent: true,
        opacity: 0.3
    });
    const blob = new THREE.Mesh(geometry, material);
    scene.add(blob);

    // Original Positions for morphing
    const originalPos = geometry.attributes.position.array.slice();

    // Gyro Data
    let gyroX = 0, gyroY = 0;
    window.addEventListener("deviceorientation", e => {
        gyroX = (e.gamma || 0) * 0.01;
        gyroY = (e.beta || 0) * 0.01;
    });

    // Animation Loop
    let time = 0;
    function animate() {
        requestAnimationFrame(animate);
        time += 0.01;
        
        analyser.getByteFrequencyData(dataArray);
        const volume = dataArray[4] / 255; // Bass freq
        
        // Update Color based on Volume & Time
        const hue = (time * 20) % 360;
        blob.material.color.setHSL(hue / 360, 0.7, 0.6);

        // Update Vertices (Fluid Effect)
        const positions = blob.geometry.attributes.position;
        
        for (let i = 0; i < positions.count; i++) {
            const x = originalPos[i * 3];
            const y = originalPos[i * 3 + 1];
            const z = originalPos[i * 3 + 2];

            // Math for distortion (Simulating fluid noise)
            const offset = 
                Math.sin(volume * 10 + x * 2 + time) * 0.2 +
                Math.cos(volume * 8 + y * 2 + time) * 0.2;

            const scale = 1 + (offset * volume); // React to audio

            positions.setXYZ(i, x * scale, y * scale, z * scale);
        }
        
        blob.geometry.attributes.position.needsUpdate = true;

        // Rotation & Gyro Reaction
        blob.rotation.x += 0.003 + gyroY;
        blob.rotation.y += 0.003 + gyroX;

        renderer.render(scene, camera);
    }
    animate();

    window.addEventListener("resize", () => {
        renderer.setSize(innerWidth, innerHeight);
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
    });
}
