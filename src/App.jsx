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
import "./App.css";

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
  const chatEndRef = useRef(null);

  // Persist user ID once
  useEffect(() => {
    localStorage.setItem("chat_user_id", userIdRef.current);
  }, []);

  // Auto-scroll to last message smoothly
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
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
      // schedule remove on disconnect
      onDisconnect(pRef).remove();
    } catch (err) {
      // some environments may not support onDisconnect; ignore
    }

    // subscribe to participants
    const unsubParticipants = onValue(participantsRef.current, (snap) => {
      const val = snap.val() || {};
      setParticipants(val);
    });

    // subscribe to last 200 messages
    const recentQuery = query(messagesRef.current, limitToLast(200));
    const unsubMessages = onChildAdded(recentQuery, (snap) => {
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

    // ensure room exists (create if empty)
    const unsubRoom = onValue(
      roomRef.current,
      (snap) => {
        if (!snap.exists()) {
          set(roomRef.current, { createdAt: Date.now() });
        }
      },
      { onlyOnce: true }
    );

    // cleanup function for this join (keeps listeners tidy)
    const cleanup = () => {
      try {
        unsubParticipants && typeof unsubParticipants === "function" && unsubParticipants();
      } catch {}
      try {
        unsubMessages && typeof unsubMessages === "function" && unsubMessages();
      } catch {}
      try {
        unsubRoom && typeof unsubRoom === "function" && unsubRoom();
      } catch {}
    };

    // store cleanup so leaveRoom/unmount can call it
    roomRef.current._cleanup = cleanup;
  }

  // Leave room
  async function leaveRoom() {
    if (!inRoom || !roomId) return;

    try {
      await remove(ref(db, `rooms/${roomId}/participants/${userIdRef.current}`));
    } catch {}

    // run firebase listener cleanup if present
    try {
      roomRef.current && roomRef.current._cleanup && roomRef.current._cleanup();
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
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Small helper: initials
  function initialsFor(n) {
    if (!n) return "?";
    return n
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  return (
    <div className="app">
      <header className="header" role="banner">
        <div className="brand">
          <h1>Chatr</h1>
          <span className="muted">— realtime Firebase chat</span>
        </div>

        <div className="header-controls" aria-hidden={false}>
          <label className="sr-only" htmlFor="displayNameInput">
            Display name
          </label>
          <input
            id="displayNameInput"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your display name"
            className="input name-input"
            aria-label="Display name"
          />

          <button type="button" onClick={createRoom} disabled={inRoom} className="btn">
            Create
          </button>

          <input
            aria-label="Room ID"
            placeholder="room id"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="input room-input"
          />
          <button
            type="button"
            onClick={() => joinRoom(roomId)}
            disabled={inRoom || !roomId}
            className="btn"
          >
            Join
          </button>
          <button type="button" onClick={leaveRoom} disabled={!inRoom} className="btn secondary">
            Leave
          </button>
        </div>
      </header>

      <main className="main" role="main">
        <section className="chat-column" aria-live="polite" aria-label={`Chat room ${roomId || "none"}`}>
          <div className="chat-title">
            <strong>Chat</strong>
            <span className="muted"> room: {roomId || "-"}</span>
          </div>

          <div className="chat-box" role="log" aria-relevant="additions">
            {messages.length === 0 && <div className="empty">No messages yet — say hi 👋</div>}

            {messages.map((m) => {
              const mine = m.fromId === userIdRef.current;
              return (
                <div
                  key={m.id}
                  className={`message-row ${mine ? "message-me" : "message-peer"}`}
                >
                  {!mine && (
                    <div className="avatar" aria-hidden="true">{initialsFor(m.fromName)}</div>
                  )}

                  <div className="message-bubble" aria-label={`${mine ? "You" : m.fromName} message`}>
                    <div className="msg-meta">
                      <span className="msg-sender">{mine ? "You" : m.fromName}</span>
                      <span className="msg-time" aria-hidden="true">{timeStr(m.at)}</span>
                    </div>
                    <div className="msg-text">{m.text}</div>
                  </div>

                  {mine && <div className="spacer-avatar" aria-hidden="true" />}
                </div>
              );
            })}

            <div ref={chatEndRef} />
          </div>

          <div className="composer" role="form" aria-label="Send message">
            <input
              className="input composer-input"
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
              placeholder={inRoom ? "Type a message..." : "Join a room to chat"}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              disabled={!inRoom}
              aria-disabled={!inRoom}
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={!inRoom || !localText.trim()}
              className="btn send-btn"
              aria-label="Send message"
            >
              Send
            </button>
          </div>
        </section>

        <aside className="participants-column" aria-label="Participants">
          <div className="participants-head">
            <strong>Participants</strong>
            <span className="muted">({Object.keys(participants).length})</span>
          </div>

          <div className="participants-box">
            {Object.keys(participants).length === 0 && <div className="empty">No users online</div>}

            <ul className="participants-list">
              {Object.values(participants).map((p) => (
                <li key={p.id} className="participant">
                  <div className="avatar">{initialsFor(p.name)}</div>
                  <div className="participant-info">
                    <div className="participant-name">{p.name}</div>
                    <div className="participant-sub muted">{p.id === userIdRef.current ? "you" : "peer"}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}
