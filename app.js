window.onload = function() {
    
    // --- DOM REFERENCES ---
    const ui = {
        views: {
            start: document.getElementById('start-screen'),
            dashboard: document.getElementById('dashboard'),
            lobby: document.getElementById('lobby'),
            call: document.getElementById('call')
        },
        buttons: {
            enter: document.getElementById('enter-btn'),
            create: document.getElementById('create-btn'),
            copy: document.getElementById('copy-btn'),
            join: document.getElementById('join-btn'),
            mute: document.getElementById('mute-btn'),
            chat: document.getElementById('chat-toggle'),
            end: document.getElementById('end-btn')
        },
        elements: {
            creatorUI: document.getElementById('creator-ui'),
            joinerUI: document.getElementById('joiner-ui'),
            linkTxt: document.getElementById('link-txt'),
            statusDot: document.getElementById('connection-dot'),
            chatPanel: document.getElementById('chat-panel'),
            chatFeed: document.getElementById('chat-feed'),
            chatInput: document.getElementById('chat-input'),
            toast: document.getElementById('toast')
        }
    };

    // --- STATE ---
    const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
    let socket, pc, localStream;
    let roomID, isCreator = false, micOn = true;
    let candidateQueue = [];

    // --- 1. INITIALIZATION & VISUALS ---
    initProfessionalVisualizer(); // Start the 3D Background

    // ENTER BUTTON
    ui.buttons.enter.onclick = async () => {
        // Try Fullscreen
        try {
            if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
            else if (document.documentElement.webkitRequestFullscreen) await document.documentElement.webkitRequestFullscreen();
        } catch(e) {}

        // Routing
        const params = new URLSearchParams(window.location.search);
        if (params.has('room')) {
            roomID = params.get('room');
            isCreator = false;
            switchView('lobby');
            ui.elements.creatorUI.classList.add('hidden');
            ui.elements.joinerUI.classList.remove('hidden');
        } else {
            switchView('dashboard');
        }

        // Connect Socket
        initSocket();
    };

    function switchView(name) {
        Object.values(ui.views).forEach(v => v.classList.remove('active'));
        ui.views[name].classList.add('active');
    }

    // --- 2. USER ACTIONS ---
    ui.buttons.create.onclick = () => {
        roomID = Math.random().toString(36).substr(2, 9);
        isCreator = true;
        const url = `${location.origin}${location.pathname}?room=${roomID}`;
        history.pushState(null, '', url);
        ui.elements.linkTxt.innerText = url;
        
        switchView('lobby');
        ui.elements.creatorUI.classList.remove('hidden');
        ui.elements.joinerUI.classList.add('hidden');
    };

    ui.buttons.copy.onclick = () => {
        navigator.clipboard.writeText(ui.elements.linkTxt.innerText);
        showToast();
    };

    ui.buttons.join.onclick = async () => {
        switchView('call');
        await startAudio();
        createPeerConnection();
        send({ type: 'ready' });
    };

    // --- 3. CHAT LOGIC ---
    ui.buttons.chat.onclick = () => ui.elements.chatPanel.classList.toggle('hidden');
    
    ui.elements.chatInput.onkeypress = (e) => {
        if(e.key === 'Enter' && ui.elements.chatInput.value.trim()) {
            const txt = ui.elements.chatInput.value;
            send({ type: 'chat', text: txt });
            addMessage(txt, true);
            ui.elements.chatInput.value = '';
        }
    };

    function addMessage(txt, isMe) {
        const div = document.createElement('div');
        div.className = isMe ? 'msg me' : 'msg them';
        div.innerText = txt;
        ui.elements.chatFeed.appendChild(div);
        ui.elements.chatFeed.scrollTop = ui.elements.chatFeed.scrollHeight;
    }

    // --- 4. WEBRTC ENGINE ---
    async function startAudio() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
            });
        } catch(e) { console.error("Mic denied"); }
    }

    function createPeerConnection() {
        pc = new RTCPeerConnection(rtcConfig);
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

        pc.ontrack = e => {
            const aud = document.createElement('audio');
            aud.srcObject = e.streams[0];
            aud.autoplay = true;
            document.body.appendChild(aud);
            
            ui.elements.statusDot.classList.add('active'); // Green light
            
            // Connect to Visualizer
            updateVisualizerSource(e.streams[0]);
        };

        pc.onicecandidate = e => {
            if (e.candidate) send({ type: 'candidate', candidate: e.candidate });
        };
    }

    // --- 5. SIGNALING ---
    function initSocket() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(`${protocol}//${location.host}`);

        socket.onmessage = async (e) => {
            const msg = JSON.parse(e.data);
            if (msg.room !== roomID) return;

            if (msg.type === 'ready' && isCreator) {
                switchView('call');
                await startAudio();
                createPeerConnection();
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                send({ type: 'offer', sdp: offer });
            }
            else if (msg.type === 'offer' && !isCreator) {
                if(!pc) createPeerConnection();
                await pc.setRemoteDescription(msg.sdp);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                send({ type: 'answer', sdp: answer });
                processQueue();
            }
            else if (msg.type === 'answer' && isCreator) {
                await pc.setRemoteDescription(msg.sdp);
                processQueue();
            }
            else if (msg.type === 'candidate') {
                if (pc && pc.remoteDescription) await pc.addIceCandidate(msg.candidate);
                else candidateQueue.push(msg.candidate);
            }
            else if (msg.type === 'chat') {
                addMessage(msg.text, false);
                ui.elements.chatPanel.classList.remove('hidden');
            }
        };
    }

    async function processQueue() {
        while(candidateQueue.length) await pc.addIceCandidate(candidateQueue.shift());
    }

    function send(d) { d.room = roomID; socket.send(JSON.stringify(d)); }

    // --- 6. UTILS ---
    ui.buttons.mute.onclick = () => {
        let t = localStream.getAudioTracks()[0];
        t.enabled = !t.enabled;
        ui.buttons.mute.style.opacity = t.enabled ? '1' : '0.5';
    };
    ui.buttons.end.onclick = () => location.href = '/';

    function showToast() {
        ui.elements.toast.classList.add('show');
        setTimeout(() => ui.elements.toast.classList.remove('show'), 2000);
    }

    // --- 7. STUDIO QUALITY 3D VISUALIZER ---
    let analyser, dataArray;
    
    function initProfessionalVisualizer() {
        const canvas = document.getElementById('webgl');
        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // Use Tone Mapping for realistic lighting falloff
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;

        const scene = new THREE.Scene();
        // Fog for depth (Black void)
        scene.fog = new THREE.FogExp2(0x050505, 0.02);

        const camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
        camera.position.z = 8;

        // --- STUDIO LIGHTING SETUP ---
        // 1. Ambient - very subtle
        scene.add(new THREE.AmbientLight(0x222222));

        // 2. Key Light (Soft White)
        const keyLight = new THREE.DirectionalLight(0xffffff, 2);
        keyLight.position.set(5, 5, 5);
        scene.add(keyLight);

        // 3. Rim Light (Cool Blue/Cyan hint) - Backlight for glass effect
        const rimLight = new THREE.SpotLight(0x44aaff, 5);
        rimLight.position.set(-5, 5, -5);
        rimLight.lookAt(0,0,0);
        scene.add(rimLight);

        // 4. Fill Light (Warm)
        const fillLight = new THREE.PointLight(0xffaa00, 0.5);
        fillLight.position.set(0, -5, 2);
        scene.add(fillLight);

        // --- MATERIAL: LIQUID MERCURY/GLASS ---
        const material = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            metalness: 0.1,
            roughness: 0.05,
            transmission: 0.95, // Glass-like transparency
            thickness: 1.5,
            ior: 1.45,
            clearcoat: 1.0,
            clearcoatRoughness: 0,
            attenuationColor: new THREE.Color(0xccffff), // Slight tint inside
            attenuationDistance: 1
        });

        const geometry = new THREE.IcosahedronGeometry(1.5, 40); // High detail
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        // Animation Loop
        const clock = new THREE.Clock();
        
        function animate() {
            requestAnimationFrame(animate);
            const time = clock.getElapsedTime();

            // Audio Reaction Logic
            let distortion = 0;
            if (analyser) {
                analyser.getByteFrequencyData(dataArray);
                // Calculate average volume
                let sum = 0;
                for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
                const avg = sum / dataArray.length;
                distortion = avg / 255; // 0 to 1
            }

            // Morphing Math
            const pos = geometry.attributes.position;
            const originalPos = geometry.parameters.radius; // Simplify reference
            const v = new THREE.Vector3();

            // Rotate slowly
            mesh.rotation.y = time * 0.1;
            mesh.rotation.z = time * 0.05;

            for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i);
                v.normalize();
                
                // Perlin-like noise movement
                const wave1 = Math.sin(v.x * 2.0 + time * 0.5);
                const wave2 = Math.cos(v.y * 2.0 + time * 0.5);
                const wave3 = Math.sin(v.z * 2.0 + time * 0.5);
                
                // Add Audio Impact
                const audioWave = (distortion * 0.8) * Math.sin(v.y * 10 + time * 5);

                const scale = 1.5 + (wave1 + wave2 + wave3) * 0.1 + audioWave;
                
                v.multiplyScalar(scale);
                pos.setXYZ(i, v.x, v.y, v.z);
            }
            
            pos.needsUpdate = true;
            geometry.computeVertexNormals();

            renderer.render(scene, camera);
        }
        animate();

        window.onresize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        };
    }

    function updateVisualizerSource(stream) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 128; // Smooth data
        src.connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
    }
};
