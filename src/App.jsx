// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import { db } from "./firebase";
import {
  ref,
  push,
  set,
  onChildAdded,
  onValue,
  remove,
  onDisconnect,
  query,
  limitToLast,
} from "firebase/database";
import { v4 as uuidv4 } from "uuid";

export default function App() {
  const [roomId, setRoomId] = useState("");
  const [inRoom, setInRoom] = useState(false);
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState({});
  const [localText, setLocalText] = useState("");
  const [name, setName] = useState(() => "user-" + Math.random().toString(36).slice(2, 7));

  const userIdRef = useRef(localStorage.getItem("chat_user_id") || uuidv4());
  const roomRef = useRef(null);
  const messagesRef = useRef(null);
  const participantsRef = useRef(null);
  const chatBoxRef = useRef(null);

  // Persist user ID
  useEffect(() => {
    localStorage.setItem("chat_user_id", userIdRef.current);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    const box = chatBoxRef.current;
    if (!box) return;
    setTimeout(() => {
      box.scrollTop = box.scrollHeight;
    }, 40);
  }, [messages]);

  // Create new room
  async function createRoom() {
    const id = Math.random().toString(36).slice(2, 9);
    setRoomId(id);

    await set(ref(db, `rooms/${id}`), { createdAt: Date.now() });
    joinRoom(id);
  }

  // Join room
  async function joinRoom(id) {
    if (!id) return alert("Enter room id");

    setRoomId(id);
    setInRoom(true);

    roomRef.current = ref(db, `rooms/${id}`);
    messagesRef.current = ref(db, `rooms/${id}/messages`);
    participantsRef.current = ref(db, `rooms/${id}/participants`);

    // Add presence
    const pRef = ref(db, `rooms/${id}/participants/${userIdRef.current}`);
    await set(pRef, {
      id: userIdRef.current,
      name,
      joinedAt: Date.now(),
    });

    try {
      onDisconnect(pRef).remove();
    } catch {}

    // Watch participants
    onValue(participantsRef.current, (snap) => {
      const val = snap.val() || {};
      setParticipants(val);
    });

    // Watch messages
    const recentQuery = query(messagesRef.current, limitToLast(200));
    onChildAdded(recentQuery, (snap) => {
      const val = snap.val();
      if (!val) return;

      const msg = {
        id: snap.key,
        fromId: val.fromId,
        fromName: val.fromName,
        text: val.text,
        at: val.at,
      };

      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    // Ensure room exists
    onValue(roomRef.current, (snap) => {
      if (!snap.exists()) {
        set(roomRef.current, { createdAt: Date.now() });
      }
    }, { onlyOnce: true });
  }

  // Leave room
  async function leaveRoom() {
    if (!inRoom || !roomId) return;

    try {
      await remove(ref(db, `rooms/${roomId}/participants/${userIdRef.current}`));
    } catch {}

    setInRoom(false);
    setMessages([]);
    setParticipants({});
    roomRef.current = null;
    messagesRef.current = null;
    participantsRef.current = null;
    setRoomId("");
  }

  // Send message
  async function sendMessage() {
    if (!inRoom || !localText.trim()) return;

    const mRef = push(ref(db, `rooms/${roomId}/messages`));
    await set(mRef, {
      fromId: userIdRef.current,
      fromName: name,
      text: localText.trim(),
      at: Date.now(),
    });

    setLocalText("");
  }

  function timeStr(ts) {
    if (!ts) return "-";
    return new Date(ts).toLocaleTimeString();
  }

  const styles = {
    container: { maxWidth: 900, margin: "28px auto", padding: 20 },
    grid: { display: "grid", gridTemplateColumns: "1fr 300px", gap: 12, marginTop: 12 },
    chatBox: { height: 420, overflowY: "auto", border: "1px solid #eee", padding: 12, borderRadius: 10, background: "#fff" },
    bubbleMe: { alignSelf: "flex-end", background: "#1769aa", color: "#fff", padding: "8px 10px", borderRadius: 10, maxWidth: "80%" },
    bubblePeer: { alignSelf: "flex-start", background: "#f1f3f5", color: "#111", padding: "8px 10px", borderRadius: 10, maxWidth: "80%" },
  };

  return (
    <div style={styles.container}>
      <h2>Chatr — Firebase Chatroom</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="your display name"
          style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
        />

        <button onClick={createRoom} disabled={inRoom}>Create room</button>

        <input
          placeholder="room id"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd", width: 150 }}
        />
        <button onClick={() => joinRoom(roomId)} disabled={inRoom || !roomId}>Join</button>
        <button onClick={leaveRoom} disabled={!inRoom}>Leave</button>
      </div>

      <div style={styles.grid}>
        {/* Chat column */}
        <div>
          <b>Chat (room: {roomId || "-"})</b>

          <div ref={chatBoxRef} style={styles.chatBox}>
            {messages.length === 0 && <div>No messages yet...</div>}

            {messages.map((m) => {
              const mine = m.fromId === userIdRef.current;
              return (
                <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", marginBottom: 12 }}>
                  <div style={mine ? styles.bubbleMe : styles.bubblePeer}>
                    <div style={{ fontWeight: 600 }}>{mine ? "You" : m.fromName}</div>
                    <div>{m.text}</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>{timeStr(m.at)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
              placeholder="Type a message..."
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
            <button onClick={sendMessage} disabled={!inRoom || !localText.trim()}>Send</button>
          </div>
        </div>

        {/* Participants column */}
        <div>
          <b>Participants ({Object.keys(participants).length})</b>

          <div style={{ marginTop: 8, border: "1px solid #eee", padding: 12, borderRadius: 8 }}>
            {Object.keys(participants).length === 0 && <div>No users online</div>}

            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {Object.values(participants).map((p) => (
                <li key={p.id} style={{ marginBottom: 8 }}>
                  <b>{p.name}</b> — {p.id === userIdRef.current ? "you" : "peer"}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
