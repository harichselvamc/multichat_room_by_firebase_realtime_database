import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDatabase, ref, set, push, onValue, onChildAdded, remove } from 'firebase/database';
import { v4 as uuidv4 } from 'uuid';
import { initializeApp } from 'firebase/app';

// --- paste your firebase config here (or import from env) ---
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function Room(){
  const { roomId } = useParams();
  const navigate = useNavigate();
  const localId = useRef(uuidv4());
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | creating | joining | connected
  const [log, setLog] = useState([]);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [peersCount, setPeersCount] = useState(1); // min 1 (you)

  useEffect(()=>{
    // when page loads, auto-join the roomId route
    if(!roomId) { navigate('/'); return; }
    setLog(l => [...l, `Room ${roomId}`]);
    // don't auto-create: detect offer presence to decide create/join
    (async ()=>{
      const roomRef = ref(db, `rooms/${roomId}`);
      const snapshot = await new Promise(res => onValue(roomRef, s => { res(s); }, { onlyOnce: true }));
      const val = snapshot.val();
      if(!val || !val.offer) {
        // no offer -> we will be the caller (create room)
        createAndWait();
      } else {
        // offer exists -> join as callee
        joinExisting();
      }
    })();

    return () => {
      leaveCleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  function appendLog(txt){ setLog(l => [...l, txt]); }

  async function createAndWait(){
    setStatus('creating');
    appendLog('Creating room (caller)...');
    const pc = new RTCPeerConnection(STUN);
    pcRef.current = pc;

    // data channel
    const dc = pc.createDataChannel('chat');
    dcRef.current = dc;
    setupDC(dc);

    pc.onicecandidate = async (e) => {
      if(!e.candidate) return;
      await push(ref(db, `rooms/${roomId}/callerCandidates`)).then(r=> set(r, e.candidate.toJSON()));
    };

    pc.onconnectionstatechange = () => {
      appendLog('pc state: ' + pc.connectionState);
      if(pc.connectionState === 'connected') setStatus('connected');
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await set(ref(db, `rooms/${roomId}/offer`), { type: offer.type, sdp: offer.sdp });
    appendLog('Offer posted to firebase. Waiting for answer...');

    // listen answer
    onValue(ref(db, `rooms/${roomId}/answer`), async snap => {
      const val = snap.val();
      if(val && val.sdp){
        await pc.setRemoteDescription({ type: val.type, sdp: val.sdp });
        appendLog('Answer received and applied.');
      }
    });

    // listen callee ICE
    onChildAdded(ref(db, `rooms/${roomId}/calleeCandidates`), snap => {
      const c = snap.val(); if(c) pc.addIceCandidate(new RTCIceCandidate(c));
    });
  }

  async function joinExisting(){
    setStatus('joining');
    appendLog('Joining existing room (callee)...');
    const pc = new RTCPeerConnection(STUN);
    pcRef.current = pc;

    pc.ondatachannel = (e) => { dcRef.current = e.channel; setupDC(e.channel); };
    pc.onicecandidate = async (e) => {
      if(!e.candidate) return;
      await push(ref(db, `rooms/${roomId}/calleeCandidates`)).then(r=> set(r, e.candidate.toJSON()));
    };
    pc.onconnectionstatechange = () => {
      appendLog('pc state: ' + pc.connectionState);
      if(pc.connectionState === 'connected') setStatus('connected');
    };

    // fetch offer once
    onValue(ref(db, `rooms/${roomId}/offer`), async snap => {
      const o = snap.val(); if(!o || !o.sdp) return;
      await pc.setRemoteDescription({ type: o.type, sdp: o.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await set(ref(db, `rooms/${roomId}/answer`), { type: answer.type, sdp: answer.sdp });
      appendLog('Answer created and written.');
    });

    // listen caller ICE
    onChildAdded(ref(db, `rooms/${roomId}/callerCandidates`), snap => {
      const c = snap.val(); if(c) pc.addIceCandidate(new RTCIceCandidate(c));
    });
  }

  function setupDC(dc){
    dc.onopen = () => {
      appendLog('DataChannel open');
      setStatus('connected');
    };
    dc.onmessage = (evt) => {
      setMessages(m => [...m, { from: 'peer', text: evt.data }]);
    };
    dc.onclose = () => appendLog('DataChannel closed');
  }

  function send(){
    if(!dcRef.current || dcRef.current.readyState!=='open'){ appendLog('Datachannel not open'); return; }
    dcRef.current.send(text);
    setMessages(m => [...m, { from: 'me', text }]);
    setText('');
  }

  async function leaveCleanup(){
    try {
      if(pcRef.current) pcRef.current.close();
      // optional: remove room entry to cleanup (careful in public)
      await remove(ref(db, `rooms/${roomId}`));
    } catch(e){}
  }

  function copyLink(){
    navigator.clipboard.writeText(location.href);
    appendLog('Link copied');
  }

  return (
    <div className="room-card card">
      <div className="room-header">
        <div>
          <h2>Room: <span className="room-id">{roomId}</span></h2>
          <div className="meta">
            <span className={`status ${status}`}>{status}</span>
            <span className="peers">participants: {peersCount}</span>
          </div>
        </div>

        <div className="room-actions">
          <button className="btn" onClick={copyLink}>Copy link</button>
          <button className="btn muted" onClick={()=>navigate('/')}>Leave</button>
        </div>
      </div>

      <div className="chat-area">
        <div className="messages">
          {messages.length===0 && <div className="hint">No messages yet. Wait for peer or type and send once connected.</div>}
          {messages.map((m,i)=>(
            <div key={i} className={`msg ${m.from==='me' ? 'me' : 'peer'}`}>
              <small className="from">{m.from}</small>
              <div className="text">{m.text}</div>
            </div>
          ))}
        </div>

        <div className="composer">
          <input value={text} onChange={e=>setText(e.target.value)} placeholder="Type message..." />
          <button className="btn" onClick={send}>Send</button>
        </div>
      </div>

      <div className="logs">
        <h4>Logs</h4>
        <div className="logbox">{log.map((l,i)=><div key={i}>{l}</div>)}</div>
      </div>
    </div>
  );
}
